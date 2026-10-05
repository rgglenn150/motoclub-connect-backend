import { expect } from 'chai';
import sinon from 'sinon';
import mongoose from 'mongoose';
import Payment from '../models/PaymentModel.js';
import {
  getProgressByCollection,
  progressPercents,
  formatProgressText,
  progressVersion,
  STATUS_LABEL,
  progressSplit,
  progressBar,
} from '../utils/collectionProgress.js';

const A = new mongoose.Types.ObjectId('507f191e810c19729de860ea');
const B = new mongoose.Types.ObjectId('507f191e810c19729de860eb');
const C = new mongoose.Types.ObjectId('507f191e810c19729de860ec');

describe('utils/collectionProgress', () => {
  afterEach(() => sinon.restore());

  describe('getProgressByCollection', () => {
    it('sums confirmed and pending separately in a single aggregate, ignoring rejected', async () => {
      const aggregate = sinon.stub(Payment, 'aggregate').resolves([
        { _id: { collection: A, status: 'confirmed' }, total: 4500 },
        { _id: { collection: A, status: 'pending' }, total: 1200 },
        { _id: { collection: B, status: 'pending' }, total: 300 },
      ]);

      const progress = await getProgressByCollection([A, B.toString(), C]);

      expect(aggregate.calledOnce).to.equal(true);
      const [match] = aggregate.firstCall.args[0];
      expect(match.$match.status).to.deep.equal({
        $in: ['confirmed', 'pending'],
      });
      expect(match.$match.collection.$in.map(String)).to.deep.equal(
        [A, B, C].map(String)
      );

      expect(progress.get(A.toString())).to.deep.equal({
        confirmedTotal: 4500,
        pendingTotal: 1200,
      });
      expect(progress.get(B.toString())).to.deep.equal({
        confirmedTotal: 0,
        pendingTotal: 300,
      });
      expect(progress.get(C.toString())).to.deep.equal({
        confirmedTotal: 0,
        pendingTotal: 0,
      });
    });

    it('skips the query when there are no collections', async () => {
      const aggregate = sinon.stub(Payment, 'aggregate').resolves([]);

      const progress = await getProgressByCollection([]);

      expect(aggregate.called).to.equal(false);
      expect(progress.size).to.equal(0);
    });
  });

  describe('progressPercents', () => {
    it('splits the bar into confirmed and pending shares of the target', () => {
      expect(
        progressPercents({ confirmedTotal: 4500, pendingTotal: 1200 }, 10000)
      ).to.deep.equal({
        confirmedPct: 45,
        pendingPct: 12,
      });
    });

    it('caps the bar at 100%, confirmed first', () => {
      expect(
        progressPercents({ confirmedTotal: 8000, pendingTotal: 5000 }, 10000)
      ).to.deep.equal({
        confirmedPct: 80,
        pendingPct: 20,
      });
      expect(
        progressPercents({ confirmedTotal: 12000, pendingTotal: 500 }, 10000)
      ).to.deep.equal({
        confirmedPct: 100,
        pendingPct: 0,
      });
    });

    it('never draws negative segments', () => {
      expect(
        progressPercents({ confirmedTotal: -500, pendingTotal: -200 }, 10000)
      ).to.deep.equal({ confirmedPct: 0, pendingPct: 0 });
      expect(
        progressPercents({ confirmedTotal: 1000, pendingTotal: -200 }, 10000)
      ).to.deep.equal({ confirmedPct: 10, pendingPct: 0 });
    });

    it('returns null without a positive target', () => {
      expect(
        progressPercents({ confirmedTotal: 500, pendingTotal: 0 }, undefined)
      ).to.equal(null);
      expect(
        progressPercents({ confirmedTotal: 500, pendingTotal: 0 }, 0)
      ).to.equal(null);
    });
  });

  describe('STATUS_LABEL (specs 003 + 006)', () => {
    it('names statuses the way people see them', () => {
      expect(STATUS_LABEL.confirmed).to.deep.equal({
        title: 'Verified',
        lower: 'verified',
      });
      // Spec 006 D6: "Pending" replaces "Awaiting Verification".
      expect(STATUS_LABEL.pending).to.deep.equal({
        title: 'Pending',
        lower: 'pending',
      });
      expect(STATUS_LABEL.rejected).to.deep.equal({
        title: 'Rejected',
        lower: 'rejected',
      });
    });
  });

  describe('formatProgressText', () => {
    it('lists the pending amount before the verified amount', () => {
      expect(
        formatProgressText({ confirmedTotal: 4500, pendingTotal: 1200 }, 12000)
      ).to.equal('₱1,200 pending + ₱4,500 verified of ₱12,000.');
    });

    it('drops the pending part when nothing is pending', () => {
      expect(
        formatProgressText({ confirmedTotal: 4500, pendingTotal: 0 }, 12000)
      ).to.equal('₱4,500 verified of ₱12,000.');
    });

    it('always shows the verified amount, even at ₱0', () => {
      expect(
        formatProgressText({ confirmedTotal: 0, pendingTotal: 1200 }, 12000)
      ).to.equal('₱1,200 pending + ₱0 verified of ₱12,000.');
    });

    it('says "so far" without a target', () => {
      expect(
        formatProgressText({ confirmedTotal: 500, pendingTotal: 0 })
      ).to.equal('₱500 verified so far.');
      expect(
        formatProgressText({ confirmedTotal: 500, pendingTotal: 250 })
      ).to.equal('₱250 pending + ₱500 verified so far.');
    });

    it('keeps centavos only when the amount has them', () => {
      expect(
        formatProgressText({ confirmedTotal: 1234.5, pendingTotal: 0 })
      ).to.equal('₱1,234.50 verified so far.');
    });
  });

  describe('progressVersion', () => {
    it('changes whenever the totals or the collection change', () => {
      const updatedAt = new Date('2026-10-04T00:00:00Z');
      expect(
        progressVersion({ confirmedTotal: 4500, pendingTotal: 1200 }, updatedAt)
      ).to.equal(`4500-1200-${updatedAt.getTime()}`);
      expect(progressVersion({ confirmedTotal: 0, pendingTotal: 0 })).to.equal(
        '0-0-0'
      );
    });
  });
});

// Spec 007 research R2. COPY — keep identical to
// motoclub-connect-ionic/src/app/components/collection-progress/collection-progress.component.spec.ts
// [verified, pending, confirmedPct, pendingPct, confirmedShare, pendingShare]
const SPLIT_CASES = [
  [4500, 1200, 78.94736842105263, 21.052631578947366, '79%', '21%'],
  [100, 0, 100, 0, '100%', '0%'],
  [0, 0, 0, 0, null, null],
  [0, 1200, 0, 100, '0%', '100%'],
  [1, 2, 33.33333333333333, 66.66666666666667, '33%', '67%'],
  [2, 1, 66.66666666666666, 33.33333333333334, '67%', '33%'],
  [100000, 1, 99.99900000999989, 0.0009999900001063771, '99%', '<1%'],
  [-50, 100, 0, 100, '0%', '100%'],
  [1000.5, 0.5, 99.95004995004995, 0.04995004995005235, '99%', '<1%'],
];

describe('progressSplit (spec 007)', () => {
  for (const [c, p, cPct, pPct, cShare, pShare] of SPLIT_CASES) {
    it(`splits ${c} verified / ${p} pending`, () => {
      const split = progressSplit({ confirmedTotal: c, pendingTotal: p });
      expect(split.confirmedPct).to.be.closeTo(cPct, 1e-9);
      expect(split.pendingPct).to.be.closeTo(pPct, 1e-9);
      expect(split.confirmedShare).to.equal(cShare);
      expect(split.pendingShare).to.equal(pShare);
      expect(split.confirmedPct + split.pendingPct).to.be.at.most(100 + 1e-9);
    });
  }
});

describe('progressBar (spec 007)', () => {
  it('measures toward a positive target exactly as progressPercents does', () => {
    const progress = { confirmedTotal: 4500, pendingTotal: 1200 };
    expect(progressBar(progress, 10000)).to.deep.equal({
      mode: 'target',
      ...progressPercents(progress, 10000),
    });
  });

  for (const target of [undefined, null, 0, -5]) {
    it(`splits collected money without a positive target (${target})`, () => {
      const bar = progressBar({ confirmedTotal: 4500, pendingTotal: 1200 }, target);
      expect(bar.mode).to.equal('split');
      expect(bar.confirmedShare).to.equal('79%');
    });
  }

  it('leaves progressPercents unchanged: null without a target', () => {
    expect(progressPercents({ confirmedTotal: 1, pendingTotal: 1 })).to.equal(null);
  });
});
