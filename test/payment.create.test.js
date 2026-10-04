import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import { app } from '../server.js';
import Collection from '../models/CollectionModel.js';
import Payment from '../models/PaymentModel.js';

const COLLECTION_ID = '507f191e810c19729de860ea';
const CLUB_ID = '507f1f77bcf86cd799439011';

// Spec 001, FR-020: pending amounts are shown publicly for public collections,
// so anonymous submissions must carry a sane amount (contracts/payment.md).
describe('POST /api/payment/create amount validation', () => {
  afterEach(() => sinon.restore());

  const submit = (amount) =>
    request(app)
      .post('/api/payment/create')
      .send({
        collection: COLLECTION_ID,
        name: 'Demo Payer',
        referenceNumber: `R-${Math.random()}`,
        ...(amount !== undefined && { amount }),
      });

  for (const amount of [
    'abc',
    0,
    -500,
    '-1',
    10000000.01,
    20000000,
    '1.234',
    '1e3',
    '',
    null,
  ]) {
    it(`rejects ${JSON.stringify(amount)}`, async () => {
      const find = sinon.stub(Collection, 'findById');
      const save = sinon.stub(Payment.prototype, 'save');

      const res = await submit(amount);

      expect(res.status).to.equal(400);
      expect(find.called).to.equal(false);
      expect(save.called).to.equal(false);
    });
  }

  for (const amount of [1500, '1500', 1234.56, '0.5', 10000000]) {
    it(`accepts ${JSON.stringify(amount)}`, async () => {
      sinon
        .stub(Collection, 'findById')
        .resolves({ _id: COLLECTION_ID, club: CLUB_ID, visibility: 'public' });
      sinon.stub(Payment, 'findOne').resolves(null);
      sinon.stub(Payment.prototype, 'save').resolves();

      const res = await submit(amount);

      expect(res.status).to.equal(201);
      expect(res.body.payment.amount).to.equal(Number(amount));
      expect(res.body.payment.status).to.equal('pending');
    });
  }
});
