import { expect } from 'chai';
import sinon from 'sinon';
import mongoose from 'mongoose';
import { ensureConnection } from './setup.js';
import CollectionLock from '../models/CollectionLockModel.js';
import { withCollectionLock, LedgerBusyError } from '../utils/collectionLock.js';

// Spec 009, research R1: a per-collection lease lock that works on standalone
// MongoDB. These run against the test database, because the point is how
// MongoDB itself resolves the race.
describe('utils/collectionLock', () => {
  let collectionId;

  before(async () => {
    await ensureConnection();
  });

  beforeEach(() => {
    collectionId = new mongoose.Types.ObjectId();
  });

  afterEach(async () => {
    sinon.restore();
    await CollectionLock.deleteMany({ _id: collectionId });
  });

  it('runs the section while holding the lock, then releases it', async () => {
    const result = await withCollectionLock(collectionId, async () => {
      const held = await CollectionLock.findById(collectionId);
      expect(held.until.getTime()).to.be.greaterThan(Date.now());
      return 'done';
    });

    expect(result).to.equal('done');
    expect(await CollectionLock.findById(collectionId)).to.equal(null);
  });

  it('releases the lock when the section throws', async () => {
    let error;
    try {
      await withCollectionLock(collectionId, async () => {
        throw new Error('boom');
      });
    } catch (err) {
      error = err;
    }

    expect(error.message).to.equal('boom');
    expect(await CollectionLock.findById(collectionId)).to.equal(null);
  });

  it('makes a second caller wait until the first releases', async () => {
    const order = [];
    const first = withCollectionLock(collectionId, async () => {
      order.push('first start');
      await new Promise((resolve) => setTimeout(resolve, 250));
      order.push('first end');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = withCollectionLock(collectionId, async () => {
      order.push('second');
    });

    await Promise.all([first, second]);

    expect(order).to.deep.equal(['first start', 'first end', 'second']);
  });

  it('gives up with LEDGER_BUSY when the lock stays held', async () => {
    await CollectionLock.create({
      _id: collectionId,
      until: new Date(Date.now() + 60_000),
    });
    const section = sinon.spy();

    let error;
    try {
      await withCollectionLock(collectionId, section, { maxWaitMs: 300 });
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(LedgerBusyError);
    expect(error.code).to.equal('LEDGER_BUSY');
    expect(section.called).to.equal(false);
  });

  it('takes over a lock whose lease has expired', async () => {
    await CollectionLock.create({
      _id: collectionId,
      until: new Date(Date.now() - 1000),
    });

    const result = await withCollectionLock(collectionId, async () => 'ran');

    expect(result).to.equal('ran');
  });

  it('only removes its own lease on release', async () => {
    let foreignUntil;
    await withCollectionLock(collectionId, async () => {
      // Our lease ran out and someone else took the lock meanwhile.
      foreignUntil = new Date(Date.now() + 60_000);
      await CollectionLock.updateOne(
        { _id: collectionId },
        { until: foreignUntil }
      );
    });

    const lock = await CollectionLock.findById(collectionId);
    expect(lock.until.getTime()).to.equal(foreignUntil.getTime());
  });

  it('confirmLease extends a lease that is still ours', async () => {
    await withCollectionLock(collectionId, async ({ confirmLease }) => {
      const before = (await CollectionLock.findById(collectionId)).until;
      await new Promise((resolve) => setTimeout(resolve, 10));
      await confirmLease();
      const after = (await CollectionLock.findById(collectionId)).until;
      expect(after.getTime()).to.be.greaterThan(before.getTime());
    });
  });

  it('confirmLease throws LEDGER_BUSY when the lease was lost', async () => {
    let error;
    try {
      await withCollectionLock(collectionId, async ({ confirmLease }) => {
        await CollectionLock.updateOne(
          { _id: collectionId },
          { until: new Date(Date.now() + 60_000) }
        );
        await confirmLease();
      });
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(LedgerBusyError);
  });

  it('logs a section that holds the lock for over a second', async () => {
    const warn = sinon.stub(console, 'warn');
    const clock = sinon.stub(Date, 'now');
    clock.callThrough();

    await withCollectionLock(collectionId, async () => {
      const start = Date.now.wrappedMethod();
      clock.callsFake(() => start + 1500);
    });

    expect(
      warn.calledWithMatch(sinon.match(/^Locked section took \d+ms/))
    ).to.equal(true);
  });
});
