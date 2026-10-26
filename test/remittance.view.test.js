import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../server.js';
import Remittance from '../models/RemittanceModel.js';
import { seedRemittanceClub } from './fixtures/remittanceFixture.js';
import {
  visibleTo,
  serializeRemittance,
} from '../utils/remittanceView.js';

const REMITTANCE = {
  _id: 'r1',
  collection: 'c1',
  club: 'k1',
  amount: 4500,
  remittedOn: '2026-10-24',
  recipientType: 'external',
  member: 'm1',
  recipientUser: 'u9',
  recipientName: 'Casa Verde Events',
  recipientAccount: 'GCash 0917 000 0000',
  note: 'Venue',
  visibility: 'public',
  proofUrl: 'https://res.cloudinary.com/x/remittances/p.jpg',
  proofPublicId: 'remittances/p',
  recordedBy: { _id: 'u1', username: 'admin1' },
  status: 'voided',
  voidedBy: { _id: 'u2', username: 'admin2' },
  voidedAt: '2026-10-25T01:00:00.000Z',
  voidReason: 'Wrong amount',
  createdAt: '2026-10-24T03:10:00.000Z',
  updatedAt: '2026-10-25T01:00:00.000Z',
};

const PRIVATE = [
  'recipientAccount',
  'proofUrl',
  'recordedBy',
  'voidedBy',
  'voidedAt',
  'voidReason',
];
const INTERNAL = ['member', 'recipientUser', 'proofPublicId'];

// Spec 009 D3, D4, D6 / research R4.
describe('utils/remittanceView', () => {
  describe('visibleTo', () => {
    it('lets club admins see every record, voided ones included', () => {
      expect(visibleTo({ isAdmin: true, isMember: true })).to.deep.equal({});
    });

    it('shows members the active Members and Public records', () => {
      expect(visibleTo({ isAdmin: false, isMember: true })).to.deep.equal({
        status: 'active',
        visibility: { $in: ['members', 'public'] },
      });
    });

    it('shows everyone else only active Public records', () => {
      expect(visibleTo({ isAdmin: false, isMember: false })).to.deep.equal({
        status: 'active',
        visibility: 'public',
      });
    });
  });

  describe('serializeRemittance', () => {
    it('gives admins the private details', () => {
      const out = serializeRemittance(REMITTANCE, { isAdmin: true });

      expect(out.detailsVisible).to.equal(true);
      for (const field of PRIVATE) {
        expect(out[field]).to.deep.equal(REMITTANCE[field]);
      }
    });

    it('gives everyone else name, amount, date and note only', () => {
      const out = serializeRemittance(REMITTANCE, { isAdmin: false });

      expect(out.detailsVisible).to.equal(false);
      expect(out).to.include({
        recipientName: 'Casa Verde Events',
        amount: 4500,
        remittedOn: '2026-10-24',
        note: 'Venue',
        visibility: 'public',
      });
      for (const field of PRIVATE) expect(out).not.to.have.property(field);
    });

    it('never sends internal fields, even to admins', () => {
      for (const isAdmin of [true, false]) {
        const out = serializeRemittance(REMITTANCE, { isAdmin });
        for (const field of INTERNAL) expect(out).not.to.have.property(field);
      }
    });

    it('accepts a Mongoose document', () => {
      const doc = { toObject: () => ({ ...REMITTANCE }) };

      expect(serializeRemittance(doc, { isAdmin: false }).recipientName).to.equal(
        'Casa Verde Events'
      );
    });
  });
});

// Spec 009 Story 1 / Story 3 (contracts: GET /api/remittance/collection/:id).
describe('GET /api/remittance/collection/:collectionId', function () {
  this.timeout(20000);
  let seed;

  const list = (user, collectionId = seed.collection._id) => {
    const req = request(app).get(`/api/remittance/collection/${collectionId}`);
    if (user) req.set('Authorization', `Bearer ${seed.tokenFor(user)}`);
    return req;
  };

  const remit = (fields) =>
    Remittance.create({
      collection: seed.collection._id,
      club: seed.clubId,
      recipientType: 'external',
      recipientName: 'Casa Verde Events',
      recordedBy: seed.users.admin._id,
      visibility: 'members',
      remittedOn: '2026-10-24',
      ...fields,
    });

  afterEach(async () => {
    await seed.cleanup();
  });

  describe('on a public collection', () => {
    beforeEach(async () => {
      seed = await seedRemittanceClub();
    });

    it('returns the summary and an empty list when nothing was remitted', async () => {
      const res = await list(seed.users.admin);

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({
        summary: {
          verifiedTotal: 12000,
          remittedTotal: 0,
          availableToRemit: 12000,
          hasHidden: false,
        },
        remittances: [],
      });
    });

    it('lists newest date first, then newest recorded first', async () => {
      const older = await remit({ amount: 100, remittedOn: '2026-10-01' });
      const first = await remit({ amount: 200, remittedOn: '2026-10-20' });
      const second = await remit({ amount: 300, remittedOn: '2026-10-20' });

      const res = await list(seed.users.admin);

      expect(res.body.remittances.map((r) => r._id)).to.deep.equal(
        [second, first, older].map((r) => r._id.toString())
      );
      expect(res.body.summary.remittedTotal).to.equal(600);
    });

    it('is 404 for an unknown or malformed collection id', async () => {
      expect((await list(seed.users.admin, new mongoose.Types.ObjectId())).status).to.equal(404);
      expect((await list(seed.users.admin, 'nope')).status).to.equal(404);
    });
  });

  describe('on a members-only collection', () => {
    beforeEach(async () => {
      seed = await seedRemittanceClub({ visibility: 'members_only' });
    });

    it('refuses non-members and signed-out visitors', async () => {
      for (const user of [seed.users.outsider, null]) {
        const res = await list(user);
        expect(res.status).to.equal(403);
        expect(res.body.message).to.equal('Access restricted to club members');
      }
    });

    it('lets members in', async () => {
      expect((await list(seed.users.member)).status).to.equal(200);
    });
  });
  describe('private details (Story 2)', () => {
    beforeEach(async () => {
      seed = await seedRemittanceClub();
      await remit({
        amount: 4500,
        visibility: 'public',
        recipientAccount: 'GCash 0917 000 0000',
        proofUrl: 'https://res.cloudinary.com/demo/remittances/p.jpg',
        proofPublicId: 'remittances/p',
      });
    });

    it('sends account details and the proof to admins only (D6)', async () => {
      const admin = (await list(seed.users.admin)).body.remittances[0];
      expect(admin.recipientAccount).to.equal('GCash 0917 000 0000');
      expect(admin.proofUrl).to.equal('https://res.cloudinary.com/demo/remittances/p.jpg');

      for (const user of [seed.users.member, seed.users.outsider, null]) {
        const res = await list(user);
        expect(res.status, JSON.stringify(res.body)).to.equal(200);
        const [record] = res.body.remittances;
        expect(record.recipientName).to.equal('Casa Verde Events');
        expect(record).not.to.have.property('recipientAccount');
        expect(record).not.to.have.property('proofUrl');
        expect(JSON.stringify(res.body)).not.to.contain('0917');
        expect(JSON.stringify(res.body)).not.to.contain('remittances/p');
      }
    });
  });
  describe('who sees which records (Story 3)', () => {
    const names = (res) => res.body.remittances.map((r) => r.recipientName).sort();

    async function seedThree(visibility) {
      seed = await seedRemittanceClub({ visibility });
      await remit({ amount: 100, visibility: 'admins', recipientName: 'Admins record' });
      await remit({ amount: 200, visibility: 'members', recipientName: 'Members record' });
      await remit({ amount: 300, visibility: 'public', recipientName: 'Public record' });
      await remit({ amount: 400, visibility: 'public', recipientName: 'Voided record', status: 'voided', voidReason: 'Wrong amount' });
    }

    it('shows each viewer exactly what the record visibility allows (S3 AC1)', async () => {
      await seedThree('public');

      expect(names(await list(seed.users.admin))).to.deep.equal(
        ['Admins record', 'Members record', 'Public record', 'Voided record']
      );
      expect(names(await list(seed.users.member))).to.deep.equal(['Members record', 'Public record']);
      expect(names(await list(seed.users.outsider))).to.deep.equal(['Public record']);
      expect(names(await list(null))).to.deep.equal(['Public record']);
    });

    it('counts hidden active records in Remitted and says some are hidden (D7, S3 AC3)', async () => {
      await seedThree('public');

      const admin = await list(seed.users.admin);
      const member = await list(seed.users.member);
      const visitor = await list(null);

      for (const res of [admin, member, visitor]) {
        expect(res.body.summary).to.include({ verifiedTotal: 12000, remittedTotal: 600, availableToRemit: 11400 });
      }
      expect(admin.body.summary.hasHidden).to.equal(false);
      expect(member.body.summary.hasHidden).to.equal(true);
      expect(visitor.body.summary.hasHidden).to.equal(true);
    });

    it('says nothing is hidden when the viewer sees every active record', async () => {
      seed = await seedRemittanceClub();
      await remit({ amount: 300, visibility: 'public' });

      expect((await list(null)).body.summary.hasHidden).to.equal(false);
    });

    it('treats Public as Members on a members-only collection (D3, S3 AC2)', async () => {
      await seedThree('members_only');

      expect(names(await list(seed.users.member))).to.deep.equal(['Members record', 'Public record']);
      expect((await list(null)).status).to.equal(403);
    });

    it('never sends hidden records or private fields to non-admins (SC-003)', async () => {
      await seedThree('public');

      for (const user of [seed.users.member, seed.users.outsider, null]) {
        const body = JSON.stringify((await list(user)).body);
        expect(body).not.to.contain('Admins record');
        expect(body).not.to.contain('Voided record');
        expect(body).not.to.contain('Wrong amount');
        expect(body).not.to.contain('recordedBy');
      }
    });

    it("keeps a recipient's name after they leave the club (D12, S3 AC5)", async () => {
      seed = await seedRemittanceClub();
      const res = await request(app)
        .post('/api/remittance/create')
        .set('Authorization', `Bearer ${seed.tokenFor(seed.users.admin)}`)
        .field('collection', String(seed.collection._id))
        .field('amount', '100')
        .field('recipientType', 'member')
        .field('memberId', String(seed.memberDoc._id))
        .expect(201);
      await seed.memberDoc.deleteOne();

      const [record] = (await list(seed.users.admin)).body.remittances;
      expect(record._id).to.equal(res.body.remittance._id);
      expect(record.recipientName).to.equal(seed.users.member.username);
    });
  });
});
