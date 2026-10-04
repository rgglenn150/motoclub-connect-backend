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
  const confirmedPct = Math.min(100, (confirmedTotal / targetAmount) * 100);
  const pendingPct = Math.min(
    100 - confirmedPct,
    (pendingTotal / targetAmount) * 100
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

/** e.g. "₱4,500 confirmed + ₱1,200 pending of ₱10,000." */
export function formatProgressText(
  { confirmedTotal, pendingTotal },
  targetAmount
) {
  const pending =
    pendingTotal > 0 ? ` + ${formatPeso(pendingTotal)} pending` : '';
  const tail =
    targetAmount > 0 ? ` of ${formatPeso(targetAmount)}.` : ' so far.';
  return `${formatPeso(confirmedTotal)} confirmed${pending}${tail}`;
}

/** Cache-buster for the share card URL: changes when totals or the collection change. */
export function progressVersion({ confirmedTotal, pendingTotal }, updatedAt) {
  const stamp = updatedAt ? new Date(updatedAt).getTime() : 0;
  return `${confirmedTotal}-${pendingTotal}-${stamp}`;
}
