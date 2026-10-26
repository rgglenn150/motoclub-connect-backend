import mongoose from 'mongoose';
import Remittance from '../models/RemittanceModel.js';
import Collection from '../models/CollectionModel.js';
import Member from '../models/MemberModel.js';
import cloudinary from '../utils/cloudinary.js';
import { formatPeso } from '../utils/collectionProgress.js';
import { getLedger, fitsAvailable } from '../utils/remittanceLedger.js';
import { withCollectionLock, LedgerBusyError } from '../utils/collectionLock.js';
import { checkRemittance } from '../utils/remittanceInput.js';
import { visibleTo, serializeRemittance } from '../utils/remittanceView.js';
import {
  createRemittanceRecordedNotification,
  createRemittanceVoidedNotification,
} from '../utils/notificationService.js';

/**
 * Remittances from collections (spec 009). Contract:
 * specs/009-collection-remittances/contracts/README.md
 */

const ADMIN_FIELDS = 'recordedBy voidedBy';

class ExceedsAvailableError extends Error {
  constructor(availableToRemit) {
    super(`Only ${formatPeso(availableToRemit)} is available to remit.`);
    this.code = 'EXCEEDS_AVAILABLE';
    this.availableToRemit = availableToRemit;
  }
}

function sendExceeds(res, err) {
  return res.status(409).json({
    code: err.code,
    message: err.message,
    availableToRemit: err.availableToRemit,
  });
}

/** Summary as sent: hasHidden is whether active records were withheld from this viewer. */
function summaryFor(ledger, sentActiveCount) {
  const { verifiedTotal, remittedTotal, availableToRemit, activeCount } = ledger;
  return {
    verifiedTotal,
    remittedTotal,
    availableToRemit,
    hasHidden: activeCount > sentActiveCount,
  };
}

/** Store the proof photo; it runs before the lock so a slow upload can't outlast the lease. */
async function uploadProof(file) {
  const base64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  const { secure_url, public_id } = await cloudinary.uploader.upload(base64, {
    folder: 'remittances',
    resource_type: 'image',
  });
  return { proofUrl: secure_url, proofPublicId: public_id };
}

/** A proof whose remittance was refused or failed: remove it, or log it for manual cleanup (plan risk 4). */
async function discardProof(proofPublicId) {
  try {
    await cloudinary.uploader.destroy(proofPublicId);
  } catch (err) {
    console.error(`Orphaned remittance proof: ${proofPublicId}`, err.message);
  }
}

/** A failed notification is logged and never fails the request (spec 009 R7). */
async function notifyRecipient(create, remittance, collection, senderId) {
  try {
    await create(remittance, collection, senderId);
  } catch (err) {
    console.error('Error creating remittance notification:', err.message);
  }
}

async function isClubAdmin(clubId, userId) {
  return !!(await Member.findOne({ club: clubId, user: userId, roles: 'admin' }));
}

export async function getRemittancesByCollection(req, res) {
  try {
    const { collectionId } = req.params;
    const collection = mongoose.isValidObjectId(collectionId)
      ? await Collection.findById(collectionId)
      : null;
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    const membership = req.user
      ? await Member.findOne({ club: collection.club, user: req.user._id })
      : null;
    if (collection.visibility === 'members_only' && !membership) {
      return res
        .status(403)
        .json({ message: 'Access restricted to club members' });
    }
    const viewer = {
      isMember: !!membership,
      isAdmin: !!membership?.roles?.includes('admin'),
    };

    const query = Remittance.find({
      collection: collection._id,
      ...visibleTo(viewer),
    }).sort({ remittedOn: -1, createdAt: -1, _id: -1 });
    // Who recorded or voided a record is admin-only (D6).
    if (viewer.isAdmin) query.populate(ADMIN_FIELDS, 'username');
    const [remittances, ledger] = await Promise.all([
      query,
      getLedger(collection._id),
    ]);

    const sentActive = remittances.filter((r) => r.status === 'active').length;
    return res.status(200).json({
      summary: summaryFor(ledger, sentActive),
      remittances: remittances.map((r) =>
        serializeRemittance(r, { isAdmin: viewer.isAdmin })
      ),
    });
  } catch (err) {
    console.error('Error fetching remittances:', err.message);
    return res
      .status(500)
      .json({ message: 'Server Error', error: err.message });
  }
}

const VOID_REASON_MAX = 200;

/**
 * Void an active remittance with a reason (D4, FR-009). A conditional update
 * on `status: 'active'`, so a remittance is voided once and never reopened.
 * Voiding only frees money, so it needs no collection lock (research R1).
 */
export async function voidRemittance(req, res) {
  try {
    const { remittanceId } = req.params;
    const remittance = mongoose.isValidObjectId(remittanceId)
      ? await Remittance.findById(remittanceId)
      : null;
    if (!remittance) {
      return res.status(404).json({ message: 'Remittance not found' });
    }

    if (!(await isClubAdmin(remittance.club, req.user._id))) {
      return res
        .status(403)
        .json({ message: 'Only club admins can void remittances' });
    }

    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length > VOID_REASON_MAX) {
      return res.status(400).json({
        code: 'INVALID_REMITTANCE',
        message: 'Please fix the highlighted fields.',
        errors: {
          reason: reason
            ? `Keep the reason under ${VOID_REASON_MAX} characters.`
            : 'Give a reason for voiding.',
        },
      });
    }

    const voided = await Remittance.findOneAndUpdate(
      { _id: remittance._id, status: 'active' },
      {
        status: 'voided',
        voidedBy: req.user._id,
        voidedAt: new Date(),
        voidReason: reason,
      },
      { new: true }
    );
    if (!voided) {
      return res.status(409).json({
        code: 'ALREADY_VOIDED',
        message: 'This remittance is already voided.',
      });
    }

    const collection = await Collection.findById(voided.collection, 'name');
    if (collection) {
      await notifyRecipient(createRemittanceVoidedNotification, voided, collection, req.user._id);
    }

    await voided.populate(ADMIN_FIELDS, 'username');
    const ledger = await getLedger(voided.collection);
    return res.status(200).json({
      remittance: serializeRemittance(voided, { isAdmin: true }),
      summary: summaryFor(ledger, ledger.activeCount),
    });
  } catch (err) {
    console.error('Error voiding remittance:', err.message);
    return res
      .status(500)
      .json({ message: 'Server Error', error: err.message });
  }
}

export async function createRemittance(req, res) {
  try {
    const collectionId = req.body.collection;
    const collection = mongoose.isValidObjectId(collectionId)
      ? await Collection.findById(collectionId)
      : null;
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    if (!(await isClubAdmin(collection.club, req.user._id))) {
      return res
        .status(403)
        .json({ message: 'Only club admins can record remittances' });
    }

    const { errors, values } = await checkRemittance(req.body, collection);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        code: 'INVALID_REMITTANCE',
        message: 'Please fix the highlighted fields.',
        errors,
      });
    }

    // Unlocked pre-check, so an obviously over-cap request does no more work.
    const before = await getLedger(collection._id);
    if (!fitsAvailable(values.amount, before)) {
      return sendExceeds(res, new ExceedsAvailableError(before.availableToRemit));
    }

    const proof = req.file ? await uploadProof(req.file) : {};

    // The authoritative check: re-read the totals and write while holding the
    // collection's lock, so two admins can't both spend the same money (D1).
    let remittance;
    try {
      remittance = await withCollectionLock(
        collection._id,
        async ({ confirmLease }) => {
          const ledger = await getLedger(collection._id);
          if (!fitsAvailable(values.amount, ledger)) {
            throw new ExceedsAvailableError(ledger.availableToRemit);
          }
          await confirmLease();
          return Remittance.create({
            ...values,
            ...proof,
            collection: collection._id,
            club: collection.club,
            recordedBy: req.user._id,
          });
        }
      );
    } catch (err) {
      if (proof.proofPublicId) await discardProof(proof.proofPublicId);
      throw err;
    }

    await notifyRecipient(createRemittanceRecordedNotification, remittance, collection, req.user._id);

    await remittance.populate(ADMIN_FIELDS, 'username');
    const after = await getLedger(collection._id);
    return res.status(201).json({
      remittance: serializeRemittance(remittance, { isAdmin: true }),
      summary: summaryFor(after, after.activeCount),
    });
  } catch (err) {
    if (err instanceof ExceedsAvailableError) return sendExceeds(res, err);
    if (err instanceof LedgerBusyError) {
      return res.status(409).json({ code: err.code, message: err.message });
    }
    console.error('Error creating remittance:', err.message);
    return res
      .status(500)
      .json({ message: 'Server Error', error: err.message });
  }
}
