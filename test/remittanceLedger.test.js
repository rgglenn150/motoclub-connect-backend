import { expect } from 'chai';
import sinon from 'sinon';
import mongoose from 'mongoose';
import Payment from '../models/PaymentModel.js';
import Remittance from '../models/RemittanceModel.js';
import {
  getLedger,
  fitsAvailable,
  shortfallIfRemoved,
} from '../utils/remittanceLedger.js';

const COLLECTION = new mongoose.Types.ObjectId('507f191e810c19729de86101');

// Spec 009 D1 / research R2: verified (confirmed payments) − remitted (active
// remittances), worked out in whole centavos.
describe('utils/remittanceLedger', () => {
  afterEach(() => sinon.restore());

  function stubTotals({ confirmed = 0, pending = 0, remitted = null, count = 0 }) {
    const rows = [];
    if (confirmed) rows.push({ _id: { collection: COLLECTION, status: 'confirmed' }, total: confirmed });
    if (pending) rows.push({ _id: { collection: COLLECTION, status: 'pending' }, total: pending });
    sinon.stub(Payment, 'aggregate').resolves(rows);
    return sinon
      .stub(Remittance, 'aggregate')
      .resolves(remitted === null ? [] : [{ _id: null, total: remitted, count }]);
  }

  describe('getLedger', () => {
    it('counts confirmed payments as verified and leaves pending out', async () => {
      stubTotals({ confirmed: 12000, pending: 1000, remitted: 10000, count: 1 });

      const ledger = await getLedger(COLLECTION);

      expect(ledger).to.deep.equal({
        verifiedTotal: 12000,
        remittedTotal: 10000,
        availableToRemit: 2000,
        activeCount: 1,
      });
    });

    it('sums only active remittances', async () => {
      const aggregate = stubTotals({ confirmed: 500 });

      await getLedger(COLLECTION);

      const [{ $match }] = aggregate.firstCall.args[0];
      expect($match.status).to.equal('active');
      expect(String($match.collection)).to.equal(String(COLLECTION));
    });

    it('is zero across the board for an empty collection', async () => {
      stubTotals({});

      expect(await getLedger(COLLECTION.toString())).to.deep.equal({
        verifiedTotal: 0,
        remittedTotal: 0,
        availableToRemit: 0,
        activeCount: 0,
      });
    });

    it('rounds float sums to whole centavos', async () => {
      // 0.1 + 0.2 in floating point is 0.30000000000000004.
      stubTotals({ confirmed: 0.1 + 0.2, remitted: 0.1, count: 1 });

      const ledger = await getLedger(COLLECTION);

      expect(ledger.verifiedTotal).to.equal(0.3);
      expect(ledger.availableToRemit).to.equal(0.2);
    });
  });

  describe('fitsAvailable', () => {
    const ledger = { verifiedTotal: 0.3, remittedTotal: 0, availableToRemit: 0.3 };

    it('allows remitting exactly the available amount', () => {
      expect(fitsAvailable(0.3, ledger)).to.equal(true);
      expect(fitsAvailable('2000', { availableToRemit: 2000 })).to.equal(true);
    });

    it('refuses a centavo more than available', () => {
      expect(fitsAvailable(0.31, ledger)).to.equal(false);
    });
  });

  describe('shortfallIfRemoved', () => {
    it('is 0 when the verified amount still covers what was remitted', () => {
      expect(
        shortfallIfRemoved(500, { verifiedTotal: 5000, remittedTotal: 4500 })
      ).to.equal(0);
    });

    it('is how far remitted would exceed verified', () => {
      expect(
        shortfallIfRemoved(500, { verifiedTotal: 5000, remittedTotal: 5000 })
      ).to.equal(500);
      expect(
        shortfallIfRemoved(0.3, { verifiedTotal: 0.5, remittedTotal: 0.4 })
      ).to.equal(0.2);
    });
  });
});
