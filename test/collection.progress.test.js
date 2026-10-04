import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../server.js';
import Collection from '../models/CollectionModel.js';
import Club from '../models/ClubModel.js';
import Member from '../models/MemberModel.js';
import Payment from '../models/PaymentModel.js';

const CLUB_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439099';
const A = new mongoose.Types.ObjectId('507f191e810c19729de860ea');
const B = new mongoose.Types.ObjectId('507f191e810c19729de860eb');

// Spec 001, Story 4: collections report confirmed and pending totals from the
// same helper as the share preview (contracts/collection.md). DB calls are
// stubbed, like test/share.test.js.
describe('Collection progress in the collection API', () => {
  afterEach(() => sinon.restore());

  it('adds confirmed and pending totals to every collection in one aggregate', async () => {
    sinon.stub(Collection, 'find').returns({
      sort: () => ({
        lean: () =>
          Promise.resolve([
            {
              _id: A,
              club: CLUB_ID,
              name: 'Demo Fund',
              visibility: 'public',
              targetAmount: 10000,
            },
            { _id: B, club: CLUB_ID, name: 'Demo Drive', visibility: 'public' },
          ]),
      }),
    });
    sinon
      .stub(Club, 'findById')
      .returns({ lean: () => Promise.resolve({ clubName: 'Demo Riders' }) });
    sinon.stub(Payment, 'countDocuments').resolves(3);
    const aggregate = sinon.stub(Payment, 'aggregate').resolves([
      { _id: { collection: A, status: 'confirmed' }, total: 4500 },
      { _id: { collection: A, status: 'pending' }, total: 1200 },
    ]);

    const res = await request(app).get(`/api/collection/club/${CLUB_ID}`);

    expect(res.status).to.equal(200);
    const [first, second] = res.body.collections;
    expect(first).to.include({
      confirmedTotal: 4500,
      pendingTotal: 1200,
      totalCollected: 4500,
      paymentCount: 3,
    });
    expect(first.clubName).to.equal('Demo Riders');
    expect(second).to.include({
      confirmedTotal: 0,
      pendingTotal: 0,
      totalCollected: 0,
    });
    expect(aggregate.calledOnce).to.equal(true);
    expect(aggregate.firstCall.args[0][0].$match.status).to.deep.equal({
      $in: ['confirmed', 'pending'],
    });
  });

  it('returns zero totals for a newly created collection', async () => {
    sinon.stub(Member, 'findOne').resolves({ roles: ['admin'] });
    sinon.stub(Collection.prototype, 'save').resolves();
    const token = jwt.sign({ _id: USER_ID }, process.env.JWT_SECRET);

    const res = await request(app)
      .post('/api/collection/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        club: CLUB_ID,
        name: 'New Fund',
        targetAmount: 5000,
        visibility: 'public',
      });

    expect(res.status).to.equal(201);
    expect(res.body.collection).to.include({
      name: 'New Fund',
      paymentCount: 0,
      confirmedTotal: 0,
      pendingTotal: 0,
      totalCollected: 0,
    });
  });
});
