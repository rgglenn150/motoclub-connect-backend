import mongoose from 'mongoose';
import Collection from '../models/CollectionModel.js';
import Payment from '../models/PaymentModel.js';
import Member from '../models/MemberModel.js';
import Club from '../models/ClubModel.js';
import cloudinary from '../utils/cloudinary.js';
import { getProgressByCollection } from '../utils/collectionProgress.js';
import { isValidAmount } from '../utils/amount.js';

async function isClubAdmin(clubId, userId) {
  const membership = await Member.findOne({ club: clubId, user: userId, roles: 'admin' });
  return !!membership;
}

export async function getCollectionsByClub(req, res) {
  try {
    const { clubId } = req.params;

    const membership = req.user ? await Member.findOne({ club: clubId, user: req.user._id }) : null;
    const isMember = !!membership;

    const query = isMember ? { club: clubId } : { club: clubId, visibility: 'public' };

    const [collections, clubDoc] = await Promise.all([
      Collection.find(query).sort({ createdAt: -1 }).lean(),
      Club.findById(clubId, 'clubName').lean(),
    ]);

    const clubName = clubDoc?.clubName ?? '';

    // Confirmed and pending totals come from the same helper as the share
    // preview, so the numbers always match (spec 001, FR-009). totalCollected
    // is kept for cached app builds and now equals confirmedTotal (research R7).
    const [progressById, paymentCounts] = await Promise.all([
      getProgressByCollection(collections.map((col) => col._id)),
      Promise.all(collections.map((col) => Payment.countDocuments({ collection: col._id }))),
    ]);

    const enriched = collections.map((col, i) => {
      const { confirmedTotal, pendingTotal } = progressById.get(col._id.toString());
      return {
        ...col,
        clubName,
        paymentCount: paymentCounts[i],
        confirmedTotal,
        pendingTotal,
        totalCollected: confirmedTotal,
      };
    });

    return res.status(200).json({ collections: enriched });
  } catch (err) {
    console.error('Error fetching collections:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

export async function createCollection(req, res) {
  try {
    const { club, name, description, targetAmount, visibility } = req.body;

    if (!club || !name) {
      return res.status(400).json({ message: 'club and name are required' });
    }

    if (!(await isClubAdmin(club, req.user._id))) {
      return res.status(403).json({ message: 'Only club admins can create collections' });
    }

    const collection = new Collection({
      club,
      name,
      ...(description && { description }),
      ...(targetAmount !== undefined && { targetAmount }),
      ...(visibility !== undefined && { visibility }),
      createdBy: req.user._id,
    });

    await collection.save();

    // Return with computed fields
    const result = {
      ...collection.toObject(),
      paymentCount: 0,
      confirmedTotal: 0,
      pendingTotal: 0,
      totalCollected: 0,
    };
    return res.status(201).json({ collection: result });
  } catch (err) {
    console.error('Error creating collection:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

/**
 * Checks an edit of name, description, target and visibility (spec 006
 * FR-006, contracts §1). Returns trimmed values to apply, or every failing
 * field with its message. Fields that can't be edited are ignored.
 */
function validateCollectionEdit(body = {}) {
  const errors = {};
  const values = {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) errors.name = 'Name is required.';
  else if (name.length > NAME_MAX)
    errors.name = `Name must be ${NAME_MAX} characters or fewer.`;
  else values.name = name;

  if (body.description !== undefined) {
    const description =
      typeof body.description === 'string' ? body.description.trim() : null;
    if (description === null || description.length > DESCRIPTION_MAX)
      errors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
    else values.description = description || undefined;
  }

  if (body.targetAmount === null) values.targetAmount = undefined;
  else if (body.targetAmount !== undefined && isValidAmount(body.targetAmount))
    values.targetAmount = Number(body.targetAmount);
  else if (body.targetAmount !== undefined)
    errors.targetAmount =
      'Target must be a positive amount up to ₱10,000,000 with at most 2 decimals.';

  if (['public', 'members_only'].includes(body.visibility))
    values.visibility = body.visibility;
  else errors.visibility = 'Visibility must be public or members only.';

  if (body.status !== undefined) {
    if (['open', 'closed'].includes(body.status)) values.status = body.status;
    else errors.status = 'Status must be open or closed.';
  }

  return { values, errors };
}

export async function updateCollection(req, res) {
  try {
    const { collectionId } = req.params;

    const collection = mongoose.isValidObjectId(collectionId)
      ? await Collection.findById(collectionId)
      : null;
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    if (!(await isClubAdmin(collection.club, req.user._id))) {
      return res.status(403).json({ message: 'Only club admins can update collections' });
    }

    const { values, errors } = validateCollectionEdit(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({
        code: 'INVALID_COLLECTION',
        message: 'Please fix the highlighted fields.',
        errors,
      });
    }

    // `undefined` unsets an optional field (cleared target or description).
    for (const [field, value] of Object.entries(values)) {
      collection[field] = value;
    }

    await collection.save();
    return res.status(200).json({ collection });
  } catch (err) {
    console.error('Error updating collection:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

export async function deleteCollection(req, res) {
  try {
    const { collectionId } = req.params;

    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    if (!(await isClubAdmin(collection.club, req.user._id))) {
      return res.status(403).json({ message: 'Only club admins can delete collections' });
    }

    // Cascade: delete all payments and their Cloudinary receipts
    const payments = await Payment.find({ collection: collectionId });
    await Promise.all(
      payments.map(async (p) => {
        if (p.receiptPublicId) {
          try {
            await cloudinary.uploader.destroy(p.receiptPublicId);
          } catch (e) {
            console.warn('Failed to delete receipt from Cloudinary:', e);
          }
        }
      })
    );
    await Payment.deleteMany({ collection: collectionId });
    await collection.deleteOne();

    return res.status(200).json({ message: 'Collection deleted' });
  } catch (err) {
    console.error('Error deleting collection:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}
