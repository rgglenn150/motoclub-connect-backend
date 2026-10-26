import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../server.js';
import Remittance from '../models/RemittanceModel.js';
import cloudinary from '../utils/cloudinary.js';
import Notification from '../models/NotificationModel.js';
import { seedRemittanceClub } from './fixtures/remittanceFixture.js';

// Spec 009 Story 1 (contracts: POST /api/remittance/create). Runs against the
// test database so the concurrency case is a real race in MongoDB.
describe('POST /api/remittance/create', function () {
  this.timeout(20000);
  let seed;

  const create = (user, fields, proof) => {
    const req = request(app).post('/api/remittance/create');
    if (user) req.set('Authorization', `Bearer ${seed.tokenFor(user)}`);
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) req.field(key, String(value));
    }
    if (proof) req.attach('proof', proof.buffer, proof);
    return req;
  };

  const JPEG = {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
    filename: 'proof.jpg',
    contentType: 'image/jpeg',
  };

  const toMember = (extra = {}) => ({
    collection: seed.collection._id,
    amount: 10000,
    recipientType: 'member',
    memberId: seed.memberDoc._id,
    note: 'Venue deposit',
    ...extra,
  });

  beforeEach(async () => {
    seed = await seedRemittanceClub();
  });

  afterEach(async () => {
    sinon.restore();
    await seed.cleanup();
  });

  it('records a remittance to a club member and returns the new summary', async () => {
    const res = await create(seed.users.admin, toMember());

    expect(res.status).to.equal(201);
    expect(res.body.remittance).to.include({
      amount: 10000,
      recipientType: 'member',
      recipientName: seed.users.member.username,
      note: 'Venue deposit',
      visibility: 'members',
      status: 'active',
      detailsVisible: true,
    });
    expect(res.body.remittance.remittedOn).to.match(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.remittance.recordedBy).to.deep.equal({
      _id: seed.users.admin._id.toString(),
      username: seed.users.admin.username,
    });
    expect(res.body.remittance).not.to.have.property('member');
    expect(res.body.remittance).not.to.have.property('recipientUser');
    expect(res.body.summary).to.deep.equal({
      verifiedTotal: 12000,
      remittedTotal: 10000,
      availableToRemit: 2000,
      hasHidden: false,
    });

    const stored = await Remittance.findById(res.body.remittance._id);
    expect(String(stored.club)).to.equal(String(seed.clubId));
    expect(String(stored.member)).to.equal(String(seed.memberDoc._id));
    expect(String(stored.recipientUser)).to.equal(String(seed.users.member._id));
  });

  it('allows remitting exactly the available amount', async () => {
    const res = await create(seed.users.admin, toMember({ amount: 12000 }));

    expect(res.status).to.equal(201);
    expect(res.body.summary.availableToRemit).to.equal(0);
  });

  it('refuses more than is available, naming the amount', async () => {
    await create(seed.users.admin, toMember()).expect(201);

    const res = await create(seed.users.admin, toMember({ amount: 3000 }));

    expect(res.status).to.equal(409);
    expect(res.body).to.deep.equal({
      code: 'EXCEEDS_AVAILABLE',
      message: 'Only ₱2,000 is available to remit.',
      availableToRemit: 2000,
    });
    expect(await Remittance.countDocuments({ club: seed.clubId })).to.equal(1);
  });

  it('lets exactly one of two simultaneous remittances through', async () => {
    await create(seed.users.admin, toMember()).expect(201);

    const [a, b] = await Promise.all([
      create(seed.users.admin, toMember({ amount: 1500 })),
      create(seed.users.admin2, toMember({ amount: 1500 })),
    ]);

    expect([a.status, b.status].sort()).to.deep.equal([201, 409]);
    const refused = a.status === 409 ? a : b;
    expect(refused.body.code).to.equal('EXCEEDS_AVAILABLE');
    expect(await Remittance.countDocuments({ club: seed.clubId })).to.equal(2);
  });

  it('requires sign-in', async () => {
    const res = await create(null, toMember());
    expect(res.status).to.equal(401);
  });

  it('refuses a member who is not an admin', async () => {
    const res = await create(seed.users.member, toMember());

    expect(res.status).to.equal(403);
    expect(res.body.message).to.equal('Only club admins can record remittances');
  });

  it('refuses an admin of another club', async () => {
    const res = await create(seed.users.outsider, toMember());
    expect(res.status).to.equal(403);
  });

  it('is 404 for an unknown collection', async () => {
    const res = await create(
      seed.users.admin,
      toMember({ collection: new mongoose.Types.ObjectId() })
    );
    expect(res.status).to.equal(404);
  });

  describe('validation', () => {
    const invalid = async (fields, field) => {
      const res = await create(seed.users.admin, toMember(fields));
      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal('INVALID_REMITTANCE');
      expect(res.body.errors).to.have.property(field);
      expect(await Remittance.countDocuments({ club: seed.clubId })).to.equal(0);
    };

    it('rejects a zero, negative or over-precise amount', async () => {
      await invalid({ amount: 0 }, 'amount');
      await invalid({ amount: -5 }, 'amount');
      await invalid({ amount: '10.005' }, 'amount');
    });

    it('rejects a missing or unknown recipient type', async () => {
      await invalid({ recipientType: '' }, 'recipientType');
      await invalid({ recipientType: 'treasurer' }, 'recipientType');
    });

    it('requires a member of this club', async () => {
      await invalid({ memberId: '' }, 'memberId');
      await invalid({ memberId: 'nope' }, 'memberId');
      await invalid({ memberId: seed.otherMemberDoc._id }, 'memberId');
    });

    it('rejects a future, malformed or impossible date', async () => {
      await invalid({ remittedOn: '2999-01-01' }, 'remittedOn');
      await invalid({ remittedOn: '24/10/2026' }, 'remittedOn');
      await invalid({ remittedOn: '2026-02-30' }, 'remittedOn');
    });

    it('accepts an earlier date', async () => {
      const res = await create(seed.users.admin, toMember({ remittedOn: '2026-01-15' }));
      expect(res.status).to.equal(201);
      expect(res.body.remittance.remittedOn).to.equal('2026-01-15');
    });

    it('rejects an unknown visibility and a note over 500 characters', async () => {
      await invalid({ visibility: 'everyone' }, 'visibility');
      await invalid({ note: 'x'.repeat(501) }, 'note');
    });

    it('names every failing field at once', async () => {
      const res = await create(
        seed.users.admin,
        toMember({ amount: 0, memberId: '', visibility: 'nope' })
      );
      expect(Object.keys(res.body.errors)).to.have.members([
        'amount',
        'memberId',
        'visibility',
      ]);
    });
  });
  describe('external recipients and proof photos (Story 2)', () => {
    const toExternal = (extra = {}) => ({
      collection: seed.collection._id,
      amount: 4500,
      recipientType: 'external',
      recipientName: 'Casa Verde Events',
      recipientAccount: 'GCash 0917 000 0000',
      visibility: 'public',
      ...extra,
    });

    const stubUpload = () =>
      sinon.stub(cloudinary.uploader, 'upload').resolves({
        secure_url: 'https://res.cloudinary.com/demo/remittances/p.jpg',
        public_id: 'remittances/p',
      });

    it('records an external recipient with account details', async () => {
      const res = await create(seed.users.admin, toExternal());

      expect(res.status).to.equal(201);
      expect(res.body.remittance).to.include({
        recipientType: 'external',
        recipientName: 'Casa Verde Events',
        recipientAccount: 'GCash 0917 000 0000',
        visibility: 'public',
      });
      const stored = await Remittance.findById(res.body.remittance._id);
      expect(stored.member).to.equal(undefined);
      expect(stored.recipientUser).to.equal(undefined);
    });

    it('requires the external name, and keeps it under 100 characters', async () => {
      for (const recipientName of ['', '   ', 'x'.repeat(101)]) {
        const res = await create(seed.users.admin, toExternal({ recipientName }));
        expect(res.status).to.equal(400);
        expect(res.body.errors).to.have.property('recipientName');
      }
    });

    it('takes account details only for external recipients, up to 200 characters', async () => {
      const tooLong = await create(seed.users.admin, toExternal({ recipientAccount: 'x'.repeat(201) }));
      expect(tooLong.body.errors).to.have.property('recipientAccount');

      const onMember = await create(
        seed.users.admin,
        toMember({ recipientAccount: 'GCash 0917' })
      );
      expect(onMember.status).to.equal(400);
      expect(onMember.body.errors).to.have.property('recipientAccount');
    });

    it('stores a proof photo in the remittances folder', async () => {
      const upload = stubUpload();

      const res = await create(seed.users.admin, toExternal(), JPEG);

      expect(res.status).to.equal(201);
      expect(upload.calledOnce).to.equal(true);
      expect(upload.firstCall.args[1]).to.deep.include({ folder: 'remittances' });
      expect(res.body.remittance.proofUrl).to.equal(
        'https://res.cloudinary.com/demo/remittances/p.jpg'
      );
      expect(res.body.remittance).not.to.have.property('proofPublicId');
      const stored = await Remittance.findById(res.body.remittance._id);
      expect(stored.proofPublicId).to.equal('remittances/p');
    });

    it('refuses a proof that is not an image, before uploading', async () => {
      const upload = stubUpload();

      const res = await create(seed.users.admin, toExternal(), {
        buffer: Buffer.from('%PDF-1.4'),
        filename: 'proof.pdf',
        contentType: 'application/pdf',
      });

      expect(res.status).to.equal(415);
      expect(res.body.code).to.equal('UNSUPPORTED_FORMAT');
      expect(upload.called).to.equal(false);
    });

    it('uploads nothing when the amount is obviously over the cap', async () => {
      const upload = stubUpload();

      const res = await create(seed.users.admin, toExternal({ amount: 13000 }), JPEG);

      expect(res.status).to.equal(409);
      expect(upload.called).to.equal(false);
    });

    it('destroys the uploaded proof when the locked re-check refuses', async () => {
      // Another admin takes the money while this request's photo is uploading.
      sinon.stub(cloudinary.uploader, 'upload').callsFake(async () => {
        await Remittance.create({
          collection: seed.collection._id,
          club: seed.clubId,
          amount: 12000,
          remittedOn: '2026-10-24',
          recipientType: 'external',
          recipientName: 'Someone else',
          recordedBy: seed.users.admin2._id,
        });
        return { secure_url: 'https://res.cloudinary.com/demo/remittances/p.jpg', public_id: 'remittances/p' };
      });
      const destroy = sinon.stub(cloudinary.uploader, 'destroy').resolves({ result: 'ok' });

      const res = await create(seed.users.admin, toExternal(), JPEG);

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal('EXCEEDS_AVAILABLE');
      expect(destroy.calledOnceWith('remittances/p')).to.equal(true);
    });

    it('logs the proof as orphaned when destroying it fails', async () => {
      sinon.stub(cloudinary.uploader, 'upload').callsFake(async () => {
        await Remittance.create({
          collection: seed.collection._id,
          club: seed.clubId,
          amount: 12000,
          remittedOn: '2026-10-24',
          recipientType: 'external',
          recipientName: 'Someone else',
          recordedBy: seed.users.admin2._id,
        });
        return { secure_url: 'https://res.cloudinary.com/demo/remittances/p.jpg', public_id: 'remittances/p' };
      });
      sinon.stub(cloudinary.uploader, 'destroy').rejects(new Error('cloudinary down'));
      const error = sinon.stub(console, 'error');

      const res = await create(seed.users.admin, toExternal(), JPEG);

      expect(res.status).to.equal(409);
      expect(error.calledWithMatch('Orphaned remittance proof: remittances/p')).to.equal(true);
    });
  });
  describe('telling the recipient (Story 6)', () => {
    it('notifies a member recipient, naming the amount and collection (S6 AC1)', async () => {
      const res = await create(seed.users.admin, toMember());

      const notes = await Notification.find({ recipient: seed.users.member._id });
      expect(notes).to.have.length(1);
      expect(notes[0].type).to.equal('remittance_recorded');
      expect(String(notes[0].club)).to.equal(String(seed.clubId));
      expect(String(notes[0].sender)).to.equal(String(seed.users.admin._id));
      expect(notes[0].message).to.equal(`₱10,000 from ${seed.collection.name} was remitted to you.`);
      expect(notes[0].data).to.deep.equal({
        collectionId: String(seed.collection._id),
        remittanceId: res.body.remittance._id,
      });
    });

    it('sends nothing for an external recipient (S6 AC3)', async () => {
      await create(seed.users.admin, {
        collection: seed.collection._id,
        amount: 100,
        recipientType: 'external',
        recipientName: 'Casa Verde Events',
      }).expect(201);

      expect(await Notification.countDocuments({ club: seed.clubId })).to.equal(0);
    });

    it('still records the remittance when the notification fails', async () => {
      sinon.stub(Notification, 'createNotification').rejects(new Error('down'));
      sinon.stub(console, 'error');

      const res = await create(seed.users.admin, toMember());

      expect(res.status).to.equal(201);
    });
  });
});
