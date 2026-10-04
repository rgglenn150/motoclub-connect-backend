import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../server.js';
import Collection from '../models/CollectionModel.js';
import Member from '../models/MemberModel.js';
import Payment from '../models/PaymentModel.js';

// Spec 003 US5 / FR-013–FR-014 (contracts §1): a payer's private details go only
// to the club's admins and to the signed-in member who submitted the payment.
// Viewer matrix per red-team F2. DB calls are stubbed.

const CLUB_ID = '507f1f77bcf86cd799439011';
const OTHER_CLUB_ID = '507f1f77bcf86cd799439012';
const COLLECTION_ID = '507f191e810c19729de860ea';
const ADMIN = '507f1f77bcf86cd7994390a1';
const OTHER_CLUB_ADMIN = '507f1f77bcf86cd7994390a2';
const PAYER = '507f1f77bcf86cd7994390b1';
const MEMBER = '507f1f77bcf86cd7994390c1';
const SOMEONE_ELSE = '507f1f77bcf86cd7994390d1';

const PUBLIC_FIELDS = [
  '_id',
  'collection',
  'club',
  'name',
  'amount',
  'status',
  'transactionDate',
  'createdAt',
  'updatedAt',
  'detailsVisible',
];
const PRIVATE_FIELDS = [
  'accountName',
  'referenceNumber',
  'phoneNumber',
  'description',
  'receiptUrl',
  'createdBy',
];

function stored(id, createdBy) {
  return {
    _id: id,
    collection: COLLECTION_ID,
    club: CLUB_ID,
    name: 'Demo Payer',
    accountName: 'D. PAYER',
    amount: 1200,
    referenceNumber: `REF-${id}`,
    phoneNumber: '09171234567',
    description: 'June dues',
    transactionDate: '2026-10-01T00:00:00.000Z',
    receiptUrl: `https://res.cloudinary.com/demo/image/upload/v1/payments/${id}.jpg`,
    receiptPublicId: `payments/${id}`,
    createdBy,
    status: 'pending',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const PAYMENTS = [
  stored('p-populated', {
    _id: new mongoose.Types.ObjectId(PAYER),
    username: 'payer',
  }),
  stored('p-bare', new mongoose.Types.ObjectId(PAYER)),
  stored('p-anonymous', null),
  stored('p-other', {
    _id: new mongoose.Types.ObjectId(SOMEONE_ELSE),
    username: 'someone',
  }),
];

const token = (userId) => jwt.sign({ _id: userId }, process.env.JWT_SECRET);

function stubDb() {
  sinon
    .stub(Collection, 'findById')
    .resolves({ _id: COLLECTION_ID, club: CLUB_ID, visibility: 'public' });
  sinon.stub(Payment, 'find').returns({
    populate: () => ({
      sort: () => Promise.resolve(PAYMENTS.map((p) => ({ ...p }))),
    }),
  });
  // Only ADMIN is an admin of CLUB_ID; OTHER_CLUB_ADMIN administers another club.
  sinon.stub(Member, 'findOne').callsFake(async (query) => {
    const user = String(query.user);
    if (query.roles === 'admin') {
      if (String(query.club) === CLUB_ID && user === ADMIN)
        return { roles: ['member', 'admin'] };
      if (String(query.club) === OTHER_CLUB_ID && user === OTHER_CLUB_ADMIN)
        return { roles: ['admin'] };
      return null;
    }
    return [ADMIN, PAYER, MEMBER].includes(user) ? { roles: ['member'] } : null;
  });
}

async function listAs(userId) {
  const req = request(app).get(`/api/payment/collection/${COLLECTION_ID}`);
  if (userId) req.set('Authorization', `Bearer ${token(userId)}`);
  const res = await req;
  expect(res.status).to.equal(200);
  return Object.fromEntries(res.body.payments.map((p) => [p._id, p]));
}

function expectPublicOnly(payment) {
  expect(payment.detailsVisible).to.equal(false);
  expect(Object.keys(payment)).to.have.members(PUBLIC_FIELDS);
}

function expectFull(payment) {
  expect(payment.detailsVisible).to.equal(true);
  for (const field of PRIVATE_FIELDS) expect(payment).to.have.property(field);
  expect(payment).to.not.have.property('receiptPublicId');
}

describe('payments list privacy (spec 003, US5)', () => {
  beforeEach(stubDb);
  afterEach(() => sinon.restore());

  it('signed-out visitors get public fields only', async () => {
    const byId = await listAs(null);
    Object.values(byId).forEach(expectPublicOnly);
  });

  it('a member who is not the payer gets public fields only', async () => {
    const byId = await listAs(MEMBER);
    Object.values(byId).forEach(expectPublicOnly);
  });

  it('the payer gets full details of their own payments only (populated or bare createdBy)', async () => {
    const byId = await listAs(PAYER);

    expectFull(byId['p-populated']);
    expectFull(byId['p-bare']);
    expectPublicOnly(byId['p-anonymous']);
    expectPublicOnly(byId['p-other']);
  });

  it('a club admin gets full details of every payment', async () => {
    const byId = await listAs(ADMIN);
    Object.values(byId).forEach(expectFull);
    expect(byId['p-anonymous'].createdBy).to.equal(null);
  });

  it('an admin of a different club gets public fields only', async () => {
    const byId = await listAs(OTHER_CLUB_ADMIN);
    Object.values(byId).forEach(expectPublicOnly);
  });

  it('never sends the receipt storage id to anyone', async () => {
    for (const viewer of [null, MEMBER, PAYER, ADMIN]) {
      const byId = await listAs(viewer);
      for (const payment of Object.values(byId)) {
        expect(payment).to.not.have.property('receiptPublicId');
      }
    }
  });
});

describe('payment create response privacy (spec 003, US5 AC6)', () => {
  afterEach(() => sinon.restore());

  it('returns what the submitter entered, flagged visible, without the storage id', async () => {
    sinon
      .stub(Collection, 'findById')
      .resolves({ _id: COLLECTION_ID, club: CLUB_ID, visibility: 'public' });
    sinon.stub(Payment, 'findOne').resolves(null);
    sinon.stub(Payment.prototype, 'save').resolves();

    const res = await request(app)
      .post('/api/payment/create')
      .send({
        collection: COLLECTION_ID,
        name: 'Demo Payer',
        amount: 500,
        referenceNumber: 'RNEW1',
        phoneNumber: '0917',
      });

    expect(res.status).to.equal(201);
    expect(res.body.payment).to.include({
      detailsVisible: true,
      referenceNumber: 'RNEW1',
      phoneNumber: '0917',
    });
    expect(res.body.payment).to.not.have.property('receiptPublicId');
  });
});
