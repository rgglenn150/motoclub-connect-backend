import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../server.js';
import Collection from '../models/CollectionModel.js';
import Member from '../models/MemberModel.js';

const COLLECTION_ID = '507f191e810c19729de860c1';
const CLUB_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439099';

const VALID = {
  name: 'Redcross Donations',
  description: 'Typhoon relief',
  targetAmount: 5000,
  visibility: 'public',
};

// Spec 006 US1, contracts §1: admins edit name, description, target and
// visibility; every edit is validated (constitution III). DB calls are stubbed.
describe('PUT /api/collection/:collectionId', () => {
  let token;
  let doc;

  const put = (body, id = COLLECTION_ID) =>
    request(app)
      .put(`/api/collection/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  function stubCollection(found = true) {
    doc = found
      ? {
          _id: COLLECTION_ID,
          club: CLUB_ID,
          name: 'Old name',
          description: 'Old description',
          targetAmount: 1000,
          visibility: 'members_only',
          status: 'open',
          createdBy: USER_ID,
          save: sinon.stub().callsFake(async () => doc),
        }
      : null;
    return sinon.stub(Collection, 'findById').resolves(doc);
  }

  const stubAdmin = (isAdmin = true) =>
    sinon.stub(Member, 'findOne').resolves(isAdmin ? { roles: ['admin'] } : null);

  beforeEach(() => {
    token = jwt.sign({ _id: USER_ID }, process.env.JWT_SECRET);
  });

  afterEach(() => sinon.restore());

  it('saves trimmed values and returns the collection (US1 AC2)', async () => {
    stubCollection();
    stubAdmin();

    const res = await put({ ...VALID, name: '  Redcross Donations  ', description: '  Typhoon relief ' });

    expect(res.status).to.equal(200);
    expect(doc.save.calledOnce).to.equal(true);
    expect(doc).to.include({
      name: 'Redcross Donations',
      description: 'Typhoon relief',
      targetAmount: 5000,
      visibility: 'public',
    });
    expect(res.body.collection).to.include({ name: 'Redcross Donations', visibility: 'public' });
  });

  it('clears the target with null (US1 AC5)', async () => {
    stubCollection();
    stubAdmin();

    const res = await put({ ...VALID, targetAmount: null });

    expect(res.status).to.equal(200);
    expect(doc.targetAmount).to.equal(undefined);
  });

  it('clears the description with an empty string', async () => {
    stubCollection();
    stubAdmin();

    await put({ ...VALID, description: '   ' });

    expect(doc.description).to.equal(undefined);
  });

  it('accepts a valid status but never needs one', async () => {
    stubCollection();
    stubAdmin();

    const res = await put({ ...VALID, status: 'closed' });

    expect(res.status).to.equal(200);
    expect(doc.status).to.equal('closed');
  });

  it('ignores fields that cannot be edited', async () => {
    stubCollection();
    stubAdmin();

    await put({ ...VALID, club: '507f1f77bcf86cd799439012', createdBy: '507f1f77bcf86cd799439013' });

    expect(doc.club).to.equal(CLUB_ID);
    expect(doc.createdBy).to.equal(USER_ID);
  });

  it('lists every invalid field at once (US1 AC4, FR-006)', async () => {
    stubCollection();
    stubAdmin();

    const res = await put({
      name: '   ',
      description: 'x'.repeat(501),
      targetAmount: 1.234,
      visibility: 'everyone',
      status: 'archived',
    });

    expect(res.status).to.equal(400);
    expect(res.body).to.deep.equal({
      code: 'INVALID_COLLECTION',
      message: 'Please fix the highlighted fields.',
      errors: {
        name: 'Name is required.',
        description: 'Description must be 500 characters or fewer.',
        targetAmount: 'Target must be a positive amount up to ₱10,000,000 with at most 2 decimals.',
        visibility: 'Visibility must be public or members only.',
        status: 'Status must be open or closed.',
      },
    });
    expect(doc.save.called).to.equal(false);
  });

  const invalid = [
    ['a missing name', { ...VALID, name: undefined }, 'name', 'Name is required.'],
    ['a non-string name', { ...VALID, name: 42 }, 'name', 'Name is required.'],
    ['a 101-character name', { ...VALID, name: 'x'.repeat(101) }, 'name', 'Name must be 100 characters or fewer.'],
    ['a non-string description', { ...VALID, description: 5 }, 'description', 'Description must be 500 characters or fewer.'],
    ['a zero target', { ...VALID, targetAmount: 0 }, 'targetAmount', null],
    ['a negative target', { ...VALID, targetAmount: -5 }, 'targetAmount', null],
    ['a target over ₱10M', { ...VALID, targetAmount: 10_000_000.01 }, 'targetAmount', null],
    ['a string target', { ...VALID, targetAmount: 'lots' }, 'targetAmount', null],
    ['a missing visibility', { ...VALID, visibility: undefined }, 'visibility', null],
  ];
  for (const [label, body, field, message] of invalid) {
    it(`refuses ${label}`, async () => {
      stubCollection();
      stubAdmin();

      const res = await put(body);

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal('INVALID_COLLECTION');
      expect(Object.keys(res.body.errors)).to.deep.equal([field]);
      if (message) expect(res.body.errors[field]).to.equal(message);
      expect(doc.save.called).to.equal(false);
    });
  }

  it('accepts the boundaries: a 100-character name, 500-character description, ₱10M target', async () => {
    stubCollection();
    stubAdmin();

    const res = await put({ ...VALID, name: 'x'.repeat(100), description: 'y'.repeat(500), targetAmount: 10_000_000 });

    expect(res.status).to.equal(200);
  });

  it('forbids members who are not club admins (US1 AC7, FR-007)', async () => {
    stubCollection();
    const member = stubAdmin(false);

    const res = await put(VALID);

    expect(res.status).to.equal(403);
    expect(member.firstCall.args[0]).to.deep.equal({ club: CLUB_ID, user: USER_ID, roles: 'admin' });
    expect(doc.save.called).to.equal(false);
  });

  it('does not let a platform admin skip the club check (constitution VI)', async () => {
    token = jwt.sign({ _id: USER_ID, role: 'admin' }, process.env.JWT_SECRET);
    stubCollection();
    stubAdmin(false);

    const res = await put(VALID);

    expect(res.status).to.equal(403);
  });

  it('returns 404 for an unknown collection', async () => {
    stubCollection(false);
    const res = await put(VALID);
    expect(res.status).to.equal(404);
  });

  it('returns 404, not a server error, for a malformed id', async () => {
    const find = sinon.stub(Collection, 'findById').rejects(new Error('CastError'));
    const res = await put(VALID, 'not-an-id');
    expect(res.status).to.equal(404);
    expect(find.called).to.equal(false);
  });

  it('requires a token', async () => {
    const res = await request(app).put(`/api/collection/${COLLECTION_ID}`).send(VALID);
    expect(res.status).to.equal(401);
  });
});
