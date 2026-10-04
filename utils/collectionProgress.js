import mongoose from 'mongoose';
import Payment from '../models/PaymentModel.js';

/**
 * Collection progress is the single rule for "how much has come in" (spec 001,
 * FR-009): confirmed and pending payments are totalled separately and rejected
 * payments never count. The share preview, the collection API and the app all
 * read these figures, so they always agree.
 */

const COUNTED_STATUSES = ['confirmed', 'pending'];

/**
 * How payment statuses are worded for people (spec 003). Stored values stay
 * pending / confirmed / rejected; only the words change.
 */
export const STATUS_LABEL = Object.freeze({
  confirmed: Object.freeze({ title: 'Verified', lower: 'verified' }),
  pending: Object.freeze({
    title: 'Awaiting Verification',
    lower: 'awaiting verification',
  }),
  rejected: Object.freeze({ title: 'Rejected', lower: 'rejected' }),
});

/**
 * Totals per collection in one aggregate.
 * @param {Array<string|mongoose.Types.ObjectId>} collectionIds
 * @returns {Promise<Map<string, { confirmedTotal: number, pendingTotal: number }>>}
 */
export async function getProgressByCollection(collectionIds) {
  const progress = new Map(
    collectionIds.map((id) => [
      id.toString(),
      { confirmedTotal: 0, pendingTotal: 0 },
    ])
  );
  if (progress.size === 0) return progress;

  const rows = await Payment.aggregate([
    {
      $match: {
        collection: {
          $in: collectionIds.map(
            (id) => new mongoose.Types.ObjectId(id.toString())
          ),
        },
        status: { $in: COUNTED_STATUSES },
      },
    },
    {
      $group: {
        _id: { collection: '$collection', status: '$status' },
        total: { $sum: '$amount' },
      },
    },
  ]);

  for (const { _id, total } of rows) {
    const entry = progress.get(_id.collection.toString());
    if (!entry) continue;
    if (_id.status === 'confirmed') entry.confirmedTotal = total;
    else if (_id.status === 'pending') entry.pendingTotal = total;
  }

  return progress;
}

/**
 * Bar segments as percentages of the target, capped at 100% with confirmed
 * filled first. Returns null when there is no positive target (no bar).
 */
export function progressPercents(
  { confirmedTotal, pendingTotal },
  targetAmount
) {
  if (!(targetAmount > 0)) return null;
  // Clamped at 0 too: a bad stored amount must never draw a negative segment.
  const confirmedPct = Math.max(
    0,
    Math.min(100, (confirmedTotal / targetAmount) * 100)
  );
  const pendingPct = Math.max(
    0,
    Math.min(100 - confirmedPct, (pendingTotal / targetAmount) * 100)
  );
  return { confirmedPct, pendingPct };
}

/** ₱ with en-PH grouping; centavos only when the amount has them. */
export function formatPeso(amount) {
  const value = Number(amount || 0);
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return `₱${value.toLocaleString('en-PH', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

/**
 * e.g. "₱1,200 awaiting verification + ₱4,500 verified of ₱12,000."
 * The awaiting amount comes first and is dropped at 0; the verified amount is
 * always shown (spec 003 FR-003, FR-004).
 */
export function formatProgressText(
  { confirmedTotal, pendingTotal },
  targetAmount
) {
  const awaiting =
    pendingTotal > 0
      ? `${formatPeso(pendingTotal)} ${STATUS_LABEL.pending.lower} + `
      : '';
  const tail =
    targetAmount > 0 ? ` of ${formatPeso(targetAmount)}.` : ' so far.';
  return `${awaiting}${formatPeso(confirmedTotal)} ${STATUS_LABEL.confirmed.lower}${tail}`;
}

/** Cache-buster for the share card URL: changes when totals or the collection change. */
export function progressVersion({ confirmedTotal, pendingTotal }, updatedAt) {
  const stamp = updatedAt ? new Date(updatedAt).getTime() : 0;
  return `${confirmedTotal}-${pendingTotal}-${stamp}`;
}
