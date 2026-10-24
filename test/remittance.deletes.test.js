import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import { app } from '../server.js';
import Payment from '../models/PaymentModel.js';
import Collection from '../models/CollectionModel.js';
import Remittance from '../models/RemittanceModel.js';
import CollectionLock from '../models/CollectionLockModel.js';
import cloudinary from '../utils/cloudinary.js';
import { seedRemittanceClub } from './fixtures/remittanceFixture.js';

// Spec 009 Story 5: deletes that would break remitted ≤ verified (D5), or wipe
// active remittances (D9), are refused under the collection lock.
describe('deletes guarded by remittances', function () {
  this.timeout(20000);
  let seed;

  const asAdmin = (req) => req.set('Authorization', `Bearer ${seed.tokenFor(seed.users.admin)}`);
  const remit = (fields) =>
    Remittance.create({
      collection: seed.collection._id,
      club: seed.clubId,
      remittedOn: '2026-10-24',
      recipientType: 'external',
      recipientName: 'Casa Verde Events',
      recordedBy: seed.users.admin._id,
      ...fields,
    });
  const paymentWith = (amount, status) =>
    seed.payments.find((p) => p.amount === amount && p.status === status);

  beforeEach(async () => {
    seed = await seedRemittanceClub();
  });

  afterEach(async () => {
    sinon.restore();
    await seed.cleanup();
  });

  describe('DELETE /api/payment/:paymentId', () => {
    const del = (payment) => asAdmin(request(app).delete(`/api/payment/${payment._id}`));

    it('refuses to delete a verified payment that is already remitted, naming the shortfall (S5 AC1)', async () => {
      await remit({ amount: 12000 });

      const res = await del(paymentWith(2000, 'confirmed'));

      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal({
        code: 'REMITTED_EXCEEDS_VERIFIED',
        message: '₱2,000 of this payment has already been remitted. Void a remittance first.',
        shortfall: 2000,
      });
      expect(await Payment.countDocuments({ club: seed.clubId })).to.equal(4);
    });

    it('names only the part that is remitted', async () => {
      await remit({ amount: 10500 });

      const res = await del(paymentWith(2000, 'confirmed'));

      expect(res.status).to.equal(409);
      expect(res.body.shortfall).to.equal(500);
      expect(res.body.message).to.match(/^₱500 of this payment/);
    });

    it('deletes a verified payment while verified still covers what was remitted (S5 AC2)', async () => {
      await remit({ amount: 10000 });

      const res = await del(paymentWith(2000, 'confirmed'));

      expect(res.status).to.equal(200);
      expect(await Payment.countDocuments({ club: seed.clubId })).to.equal(3);
    });

    it('ignores voided remittances', async () => {
      await remit({ amount: 12000, status: 'voided', voidReason: 'Wrong amount' });

      expect((await del(paymentWith(2000, 'confirmed'))).status).to.equal(200);
    });

    it('deletes pending payments as before, whatever was remitted (S5 AC3)', async () => {
      await remit({ amount: 12000 });

      expect((await del(paymentWith(1000, 'pending'))).status).to.equal(200);
    });

    it('is LEDGER_BUSY while another change holds the lock', async () => {
      await CollectionLock.create({ _id: seed.collection._id, until: new Date(Date.now() + 60_000) });

      const res = await del(paymentWith(2000, 'confirmed'));

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal('LEDGER_BUSY');
      expect(await Payment.countDocuments({ club: seed.clubId })).to.equal(4);
    });
  });

  describe('DELETE /api/collection/:collectionId', () => {
    const del = () => asAdmin(request(app).delete(`/api/collection/${seed.collection._id}`));

    it('refuses while the collection has active remittances (S5 AC4)', async () => {
      await remit({ amount: 100 });

      const res = await del();

      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal({
        code: 'ACTIVE_REMITTANCES',
        message: 'This collection has remittances. Void them before deleting it.',
      });
      expect(await Collection.countDocuments({ _id: seed.collection._id })).to.equal(1);
      expect(await Payment.countDocuments({ club: seed.clubId })).to.equal(4);
    });

    it('deletes voided remittances and their proof photos with the collection', async () => {
      await remit({ amount: 100, status: 'voided', voidReason: 'x', proofPublicId: 'remittances/p1' });
      await remit({ amount: 200, status: 'voided', voidReason: 'y' });
      const destroy = sinon.stub(cloudinary.uploader, 'destroy').resolves({ result: 'ok' });

      const res = await del();

      expect(res.status).to.equal(200);
      expect(await Remittance.countDocuments({ collection: seed.collection._id })).to.equal(0);
      expect(destroy.calledWith('remittances/p1')).to.equal(true);
    });

    it('is LEDGER_BUSY while another change holds the lock', async () => {
      await CollectionLock.create({ _id: seed.collection._id, until: new Date(Date.now() + 60_000) });

      const res = await del();

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal('LEDGER_BUSY');
    });
  });
});
