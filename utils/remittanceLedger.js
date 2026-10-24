import mongoose from 'mongoose';
import Remittance from '../models/RemittanceModel.js';
import { getProgressByCollection } from './collectionProgress.js';

/**
 * The one rule for how much of a collection can be handed over (spec 009 D1,
 * FR-008, research R2): verified (confirmed payments, the same figure as the
 * progress bar) minus remitted (active remittances). Worked out in whole
 * centavos so float sums like 0.1 + 0.2 can't block an exact amount. The app
 * shows these figures as sent and never recomputes them.
 */

const toCentavos = (amount) => Math.round((Number(amount) || 0) * 100);
const toPesos = (centavos) => centavos / 100;

/**
 * @returns {Promise<{ verifiedTotal: number, remittedTotal: number,
 *   availableToRemit: number, activeCount: number }>}
 */
export async function getLedger(collectionId) {
  const id = new mongoose.Types.ObjectId(collectionId.toString());
  const [progress, rows] = await Promise.all([
    getProgressByCollection([id]),
    Remittance.aggregate([
      { $match: { collection: id, status: 'active' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const verified = toCentavos(progress.get(id.toString()).confirmedTotal);
  const remitted = toCentavos(rows[0]?.total);
  return {
    verifiedTotal: toPesos(verified),
    remittedTotal: toPesos(remitted),
    availableToRemit: toPesos(verified - remitted),
    activeCount: rows[0]?.count ?? 0,
  };
}

/** Whether `amount` can be remitted without exceeding what is available. */
export function fitsAvailable(amount, { availableToRemit }) {
  return toCentavos(amount) <= toCentavos(availableToRemit);
}

/**
 * How far remitted would exceed verified if `amount` of verified money went
 * away (deleting a verified payment, spec 009 D5). 0 when it stays covered.
 */
export function shortfallIfRemoved(amount, { verifiedTotal, remittedTotal }) {
  const over =
    toCentavos(remittedTotal) - (toCentavos(verifiedTotal) - toCentavos(amount));
  return toPesos(Math.max(0, over));
}
