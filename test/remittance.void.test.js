import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../server.js';
import Remittance from '../models/RemittanceModel.js';
import Notification from '../models/NotificationModel.js';
import sinon from 'sinon';
import { seedRemittanceClub } from './fixtures/remittanceFixture.js';

// Spec 009 Story 4 (contracts: PATCH /api/remittance/:id/void). A void only
// moves active → voided, with a reason, and is never undone (D4, FR-009).
describe('PATCH /api/remittance/:remittanceId/void', function () {
  this.timeout(20000);
  let seed;
  let remittance;

  const voidIt = (user, reason, id = remittance._id) => {
    const req = request(app).patch(`/api/remittance/${id}/void`);
    if (user) req.set('Authorization', `Bearer ${seed.tokenFor(user)}`);
    return req.send(reason === undefined ? {} : { reason });
  };

  const list = (user) => {
    const req = request(app).get(`/api/remittance/collection/${seed.collection._id}`);
    if (user) req.set('Authorization', `Bearer ${seed.tokenFor(user)}`);
    return req;
  };

  beforeEach(async () => {
    seed = await seedRemittanceClub();
    const res = await request(app)
      .post('/api/remittance/create')
      .set('Authorization', `Bearer ${seed.tokenFor(seed.users.admin)}`)
      .field('collection', String(seed.collection._id))
      .field('amount', '10000')
      .field('recipientType', 'member')
      .field('memberId', String(seed.memberDoc._id));
    remittance = res.body.remittance;
  });

  afterEach(async () => {
    sinon.restore();
    await seed.cleanup();
  });

  it('voids with a reason, frees the amount and records who, when and why (S4 AC1)', async () => {
    const res = await voidIt(seed.users.admin2, '  Wrong amount  ');

    expect(res.status).to.equal(200);
    expect(res.body.remittance).to.include({ status: 'voided', voidReason: 'Wrong amount' });
    expect(res.body.remittance.voidedBy).to.deep.equal({
      _id: seed.users.admin2._id.toString(),
      username: seed.users.admin2.username,
    });
    expect(Date.parse(res.body.remittance.voidedAt)).to.be.closeTo(Date.now(), 60_000);
    expect(res.body.summary).to.deep.equal({
      verifiedTotal: 12000,
      remittedTotal: 0,
      availableToRemit: 12000,
      hasHidden: false,
    });
  });

  it('frees the amount to be remitted again', async () => {
    await voidIt(seed.users.admin, 'Wrong amount').expect(200);

    await request(app)
      .post('/api/remittance/create')
      .set('Authorization', `Bearer ${seed.tokenFor(seed.users.admin)}`)
      .field('collection', String(seed.collection._id))
      .field('amount', '12000')
      .field('recipientType', 'member')
      .field('memberId', String(seed.memberDoc._id))
      .expect(201);
  });

  it('requires a reason of at most 200 characters (S4 AC3)', async () => {
    for (const reason of [undefined, '', '   ', 'x'.repeat(201)]) {
      const res = await voidIt(seed.users.admin, reason);
      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal('INVALID_REMITTANCE');
      expect(res.body.errors).to.have.property('reason');
    }
    expect((await Remittance.findById(remittance._id)).status).to.equal('active');
  });

  it('requires sign-in, and an admin of this club', async () => {
    expect((await voidIt(null, 'x')).status).to.equal(401);

    for (const user of [seed.users.member, seed.users.outsider]) {
      const res = await voidIt(user, 'x');
      expect(res.status).to.equal(403);
      expect(res.body.message).to.equal('Only club admins can void remittances');
    }
  });

  it('is 404 for an unknown or malformed id', async () => {
    expect((await voidIt(seed.users.admin, 'x', new mongoose.Types.ObjectId())).status).to.equal(404);
    expect((await voidIt(seed.users.admin, 'x', 'nope')).status).to.equal(404);
  });

  it('cannot void twice, so it is never reopened (S4 AC4)', async () => {
    await voidIt(seed.users.admin, 'Wrong amount').expect(200);

    const res = await voidIt(seed.users.admin, 'Again');

    expect(res.status).to.equal(409);
    expect(res.body).to.deep.equal({
      code: 'ALREADY_VOIDED',
      message: 'This remittance is already voided.',
    });
    expect((await Remittance.findById(remittance._id)).voidReason).to.equal('Wrong amount');
  });

  it('lets exactly one of two simultaneous voids through', async () => {
    const [a, b] = await Promise.all([
      voidIt(seed.users.admin, 'First'),
      voidIt(seed.users.admin2, 'Second'),
    ]);

    expect([a.status, b.status].sort()).to.deep.equal([200, 409]);
  });

  it('hides a voided record from everyone but admins (S4 AC2)', async () => {
    await voidIt(seed.users.admin, 'Wrong amount').expect(200);

    expect((await list(seed.users.admin)).body.remittances).to.have.length(1);
    expect((await list(seed.users.member)).body.remittances).to.have.length(0);
    expect((await list(seed.users.member)).body.summary.hasHidden).to.equal(false);
  });
  describe('telling the recipient (Story 6)', () => {
    it('notifies the member recipient that it was voided (S6 AC2)', async () => {
      await voidIt(seed.users.admin, 'Wrong amount').expect(200);

      const note = await Notification.findOne({ recipient: seed.users.member._id, type: 'remittance_voided' });
      expect(note.message).to.equal(`The ₱10,000 remittance to you from ${seed.collection.name} was voided.`);
      expect(note.data).to.deep.equal({
        collectionId: String(seed.collection._id),
        remittanceId: remittance._id,
      });
    });

    it('still voids when the notification fails', async () => {
      sinon.stub(Notification, 'createNotification').rejects(new Error('down'));
      sinon.stub(console, 'error');

      expect((await voidIt(seed.users.admin, 'Wrong amount')).status).to.equal(200);
    });
  });
});
