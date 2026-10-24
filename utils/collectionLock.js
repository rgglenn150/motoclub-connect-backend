import CollectionLock from '../models/CollectionLockModel.js';

/**
 * Per-collection lease lock (spec 009, research R1). Recording a remittance,
 * deleting a verified payment and deleting a collection run inside it, so the
 * "remitted ≤ verified" check and the write that depends on it can't interleave
 * with another admin's. Works on standalone MongoDB (no transactions needed).
 */

const LEASE_MS = 5000;
const RETRY_MS = 100;
const MAX_WAIT_MS = 2000;
const SLOW_SECTION_MS = 1000;

export const LEDGER_BUSY_MESSAGE =
  'Another change to this collection is in progress. Please try again.';

export class LedgerBusyError extends Error {
  constructor() {
    super(LEDGER_BUSY_MESSAGE);
    this.code = 'LEDGER_BUSY';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One atomic attempt. A free or expired lock is taken; a live one makes the
 * upsert collide on `_id` (E11000), which means busy.
 * @returns {Promise<Date|null>} our lease end, or null when busy
 */
async function acquire(collectionId) {
  const until = new Date(Date.now() + LEASE_MS);
  try {
    await CollectionLock.findOneAndUpdate(
      { _id: collectionId, until: { $lt: new Date() } },
      { until },
      { upsert: true }
    );
    return until;
  } catch (err) {
    if (err.code === 11000) return null;
    throw err;
  }
}

/**
 * Run `section` while holding the collection's lock. `section` receives
 * `confirmLease()`, to call right before its write: it extends the lease, or
 * throws LedgerBusyError if the lease ran out and someone else took it.
 * @throws {LedgerBusyError} when the lock stays busy for `maxWaitMs`
 */
export async function withCollectionLock(
  collectionId,
  section,
  { maxWaitMs = MAX_WAIT_MS } = {}
) {
  const deadline = Date.now() + maxWaitMs;
  let until = await acquire(collectionId);
  while (!until) {
    if (Date.now() >= deadline) throw new LedgerBusyError();
    await sleep(RETRY_MS);
    until = await acquire(collectionId);
  }

  const started = Date.now();
  const confirmLease = async () => {
    const next = new Date(Date.now() + LEASE_MS);
    const extended = await CollectionLock.findOneAndUpdate(
      { _id: collectionId, until },
      { until: next }
    );
    if (!extended) throw new LedgerBusyError();
    until = next;
  };

  try {
    return await section({ confirmLease });
  } finally {
    const elapsed = Date.now() - started;
    if (elapsed > SLOW_SECTION_MS) {
      console.warn(`Locked section took ${elapsed}ms (collection ${collectionId})`);
    }
    try {
      // Only our own lease: if it expired and was taken over, leave it alone.
      await CollectionLock.deleteOne({ _id: collectionId, until });
    } catch (err) {
      console.error('Failed to release collection lock:', err.message);
    }
  }
}
