import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../server.js';
import Payment from '../models/PaymentModel.js';
import Collection from '../models/CollectionModel.js';
import Member from '../models/MemberModel.js';

const COLLECTION_ID = '507f191e810c19729de860c1';
const CLUB_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439099';
const P1 = '507f191e810c19729de860d1';
const P2 = '507f191e810c19729de860d2';
const P3 = '507f191e810c19729de860d3';

// Spec 004 US2, contracts §2: pending → confirmed only, race-safe, per payment.
describe('POST /api/payment/collection/:collectionId/bulk-verify', () => {
  let token;

  const post = (body) =>
    request(app)
      .post(`/api/payment/collection/${COLLECTION_ID}/bulk-verify`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  function stubCollection(found = true) {
    sinon
      .stub(Collection, 'findById')
      .resolves(found ? { _id: COLLECTION_ID, club: CLUB_ID } : null);
  }

  const stubAdmin = (isAdmin = true) =>
    sinon.stub(Member, 'findOne').resolves(isAdmin ? { roles: ['admin'] } : null);

  const confirmed = (id) => ({
    _id: id,
    collection: COLLECTION_ID,
    club: CLUB_ID,
    name: 'Payer',
    amount: 500,
    referenceNumber: '9000000000001',
    status: 'confirmed',
  });

  beforeEach(() => {
    token = jwt.sign({ _id: USER_ID }, process.env.JWT_SECRET);
  });

  afterEach(() => sinon.restore());

  it('verifies each payment with a conditional update and returns them (US2 AC2)', async () => {
    stubCollection();
    stubAdmin();
    const update = sinon.stub(Payment, 'findOneAndUpdate').callsFake(async (filter) => confirmed(filter._id));

    const res = await post({ paymentIds: [P1, P2] });

    expect(res.status).to.equal(200);
    expect(res.body.skipped).to.deep.equal([]);
    expect(res.body.verified.map((p) => p._id)).to.deep.equal([P1, P2]);
    expect(res.body.verified[0]).to.include({ status: 'confirmed', detailsVisible: true });
    expect(update.callCount).to.equal(2);
    for (const [i, id] of [P1, P2].entries()) {
      const [filter, change] = update.getCall(i).args;
      expect(filter).to.deep.equal({ _id: id, collection: COLLECTION_ID, status: 'pending' });
      expect(change).to.deep.equal({ status: 'confirmed' });
    }
  });

  it('skips payments another admin already reviewed, and verifies the rest (US2 AC3)', async () => {
    stubCollection();
    stubAdmin();
    sinon.stub(Payment, 'findOneAndUpdate').callsFake(async (filter) =>
      filter._id === P2 ? null : confirmed(filter._id)
    );
    sinon.stub(Payment, 'findOne').resolves({ _id: P2, status: 'rejected' });

    const res = await post({ paymentIds: [P1, P2] });

    expect(res.status).to.equal(200);
    expect(res.body.verified.map((p) => p._id)).to.deep.equal([P1]);
    expect(res.body.skipped).to.deep.equal([{ paymentId: P2, reason: 'ALREADY_REVIEWED', status: 'rejected' }]);
  });

  it('reports unknown ids and payments from another collection as NOT_FOUND', async () => {
    stubCollection();
    stubAdmin();
    sinon.stub(Payment, 'findOneAndUpdate').resolves(null);
    const lookup = sinon.stub(Payment, 'findOne').resolves(null);

    const res = await post({ paymentIds: [P3] });

    expect(res.body.skipped).to.deep.equal([{ paymentId: P3, reason: 'NOT_FOUND' }]);
    expect(lookup.firstCall.args[0]).to.deep.equal({ _id: P3, collection: COLLECTION_ID });
  });

  for (const [label, paymentIds] of [
    ['a missing list', undefined],
    ['an empty list', []],
    ['more than 200 ids', Array.from({ length: 201 }, (_, i) => `507f191e810c19729de8${String(i).padStart(4, '0')}`)],
    ['duplicate ids', [P1, P1]],
    ['a malformed id', [P1, 'not-an-id']],
    ['a non-string id', [P1, 42]],
  ]) {
    it(`rejects ${label} with INVALID_PAYMENT_IDS`, async () => {
      stubCollection();
      stubAdmin();
      const update = sinon.stub(Payment, 'findOneAndUpdate');

      const res = await post(paymentIds === undefined ? {} : { paymentIds });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal('INVALID_PAYMENT_IDS');
      expect(update.called).to.equal(false);
    });
  }

  it('requires a token', async () => {
    const res = await request(app)
      .post(`/api/payment/collection/${COLLECTION_ID}/bulk-verify`)
      .send({ paymentIds: [P1] });
    expect(res.status).to.equal(401);
  });

  it('forbids non-admins, platform admins included (FR-001, constitution VI)', async () => {
    token = jwt.sign({ _id: USER_ID, role: 'admin' }, process.env.JWT_SECRET);
    stubCollection();
    stubAdmin(false);
    const update = sinon.stub(Payment, 'findOneAndUpdate');

    const res = await post({ paymentIds: [P1] });

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal('NOT_CLUB_ADMIN');
    expect(update.called).to.equal(false);
  });

  it('returns 404 for an unknown collection', async () => {
    stubCollection(false);
    const res = await post({ paymentIds: [P1] });
    expect(res.status).to.equal(404);
    expect(res.body.code).to.equal('COLLECTION_NOT_FOUND');
  });

  it('never rejects, deletes or edits (FR-011)', async () => {
    stubCollection();
    stubAdmin();
    const update = sinon.stub(Payment, 'findOneAndUpdate').callsFake(async (filter) => confirmed(filter._id));
    const others = ['updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findByIdAndDelete', 'findOneAndDelete'].map(
      (m) => sinon.stub(Payment, m)
    );

    await post({ paymentIds: [P1], status: 'rejected', amount: 1 });

    expect(update.firstCall.args[1]).to.deep.equal({ status: 'confirmed' });
    for (const other of others) expect(other.called).to.equal(false);
  });
});
