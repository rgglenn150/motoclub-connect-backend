import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { app } from '../server.js';
import { ensureConnection } from './setup.js';
import User from '../models/UserModel.js';
import Member from '../models/MemberModel.js';
import Event from '../models/EventModel.js';

// Spec 010: GET /api/event/club/:clubId (US1–US3) and the My Clubs / Global
// feeds (US4). Times are hours relative to when the suite seeds.
const HOUR = 3600 * 1000;

describe('Club event list (spec 010)', () => {
  const tag = new mongoose.Types.ObjectId().toString().slice(-8);
  const clubId = new mongoose.Types.ObjectId();
  const emptyClubId = new mongoose.Types.ObjectId();
  let admin;
  let member;
  let outsider;
  let platformAdmin;
  let tokens;
  const ids = {};

  const get = (path, user = 'member') =>
    request(app).get(path).set('Authorization', `Bearer ${tokens[user]}`);
  const listNames = (res) => res.body.map((e) => e.name);

  before(async () => {
    await ensureConnection();
    const makeUser = (name, extra = {}) =>
      User.create({
        email: `${name}-${tag}@events010.test`,
        username: `${name}-${tag}`,
        password: 'x',
        ...extra,
      });
    [admin, member, outsider, platformAdmin] = await Promise.all([
      makeUser('admin'),
      makeUser('member'),
      makeUser('outsider'),
      makeUser('platformadmin', { role: 'admin' }),
    ]);
    await Member.create([
      { user: admin._id, club: clubId, roles: ['member', 'admin'] },
      { user: member._id, club: clubId, roles: ['member'] },
    ]);
    const sign = (u) => jwt.sign({ _id: u._id.toString() }, process.env.JWT_SECRET);
    tokens = {
      admin: sign(admin),
      member: sign(member),
      outsider: sign(outsider),
      platformAdmin: jwt.sign(
        { _id: platformAdmin._id.toString(), role: 'admin' },
        process.env.JWT_SECRET
      ),
    };

    const now = Date.now();
    const at = (h) => new Date(now + h * HOUR);
    const event = (name, times, extra = {}) => ({
      name: `${name}-${tag}`,
      description: 'spec 010',
      club: clubId,
      createdBy: admin._id,
      ...times,
      ...extra,
    });
    const docs = await Event.insertMany([
      event('pastRide', { startTime: at(-30), endTime: at(-26) }, { isPrivate: false }),
      event('inProgress', { startTime: at(-1), endTime: at(2) }),
      event('startedNoEnd', { startTime: at(-0.1) }, { isPrivate: false }),
      event('badEnd', { startTime: at(-3), endTime: at(-5) }),
      event('nextRide', { startTime: at(20) }),
      event('publicMeetup', { startTime: at(72) }, { isPrivate: false }),
    ]);
    for (const d of docs) ids[d.name.replace(`-${tag}`, '')] = d._id.toString();
    // An event saved before isPrivate existed: no field at all.
    await Event.collection.insertOne({
      name: `legacy-${tag}`,
      description: 'spec 010',
      club: clubId,
      createdBy: admin._id,
      startTime: at(48),
      scope: 'club',
    });
  });

  after(async () => {
    await Promise.all([
      Event.deleteMany({ club: clubId }),
      Member.deleteMany({ club: clubId }),
      User.deleteMany({
        _id: { $in: [admin._id, member._id, outsider._id, platformAdmin._id] },
      }),
    ]);
  });

  const n = (...names) => names.map((x) => `${x}-${tag}`);

  describe('US1 — upcoming by default', () => {
    it('returns upcoming events only, soonest first, when no filter is given', async () => {
      const res = await get(`/api/event/club/${clubId}`);
      expect(res.status).to.equal(200);
      expect(listNames(res)).to.deep.equal(
        n('inProgress', 'nextRide', 'legacy', 'publicMeetup')
      );
    });

    it('treats an unknown filter as upcoming', async () => {
      const res = await get(`/api/event/club/${clubId}?filter=bogus`);
      expect(res.status).to.equal(200);
      expect(listNames(res)).to.deep.equal(
        n('inProgress', 'nextRide', 'legacy', 'publicMeetup')
      );
    });

    it('keeps the plain array shape with createdBy populated', async () => {
      const res = await get(`/api/event/club/${clubId}`);
      expect(res.body).to.be.an('array');
      expect(res.body[0].createdBy).to.include({ username: `admin-${tag}` });
      expect(res.body[0].createdBy._id).to.equal(admin._id.toString());
    });

    it('returns 400 for a club id that is not a valid id', async () => {
      const res = await get('/api/event/club/not-an-id');
      expect(res.status).to.equal(400);
      expect(res.body).to.deep.equal({ message: 'Invalid club id' });
    });

    it('returns an empty array for a club with no events', async () => {
      const res = await get(`/api/event/club/${emptyClubId}`);
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal([]);
    });
  });

  describe('US2 — past and all', () => {
    it('past holds ended events, most recent start first', async () => {
      const res = await get(`/api/event/club/${clubId}?filter=past`);
      expect(res.status).to.equal(200);
      expect(listNames(res)).to.deep.equal(n('startedNoEnd', 'badEnd', 'pastRide'));
    });

    it('all holds every event, oldest start first', async () => {
      const res = await get(`/api/event/club/${clubId}?filter=all`);
      expect(res.status).to.equal(200);
      expect(listNames(res)).to.deep.equal(
        n('pastRide', 'badEnd', 'inProgress', 'startedNoEnd', 'nextRide', 'legacy', 'publicMeetup')
      );
    });
  });

  describe('US3 — Private events only for members', () => {
    const publicOnly = {
      upcoming: n('publicMeetup'),
      past: n('startedNoEnd', 'pastRide'),
      all: n('pastRide', 'startedNoEnd', 'publicMeetup'),
    };

    for (const filter of ['upcoming', 'past', 'all']) {
      it(`a non-member sees only Public events (${filter})`, async () => {
        const res = await get(`/api/event/club/${clubId}?filter=${filter}`, 'outsider');
        expect(res.status).to.equal(200);
        expect(listNames(res)).to.deep.equal(publicOnly[filter]);
      });
    }

    it('hides an event with no isPrivate field from non-members', async () => {
      const res = await get(`/api/event/club/${clubId}?filter=all`, 'outsider');
      expect(listNames(res)).to.not.include(`legacy-${tag}`);
    });

    it('members and admins see Private events too', async () => {
      for (const user of ['member', 'admin']) {
        const res = await get(`/api/event/club/${clubId}?filter=all`, user);
        expect(listNames(res), user).to.include.members(n('inProgress', 'nextRide', 'legacy'));
      }
    });

    it('gives a platform admin who is not a member no shortcut', async () => {
      const res = await get(`/api/event/club/${clubId}?filter=all`, 'platformAdmin');
      expect(listNames(res)).to.deep.equal(publicOnly.all);
    });
  });

  describe('US4 — My Clubs and Global feeds use the same rule', () => {
    const globalTag = `g010-${tag}`;

    before(async () => {
      const now = Date.now();
      const at = (h) => new Date(now + h * HOUR);
      const globalEvent = (name, times) => ({
        name: `${globalTag}-${name}`,
        description: 'spec 010',
        scope: 'global',
        isPrivate: false,
        createdBy: admin._id,
        ...times,
      });
      await Event.insertMany([
        globalEvent('inProgress', { startTime: at(-1), endTime: at(2) }),
        globalEvent('startedNoEnd', { startTime: at(-0.1) }),
        globalEvent('future', { startTime: at(30) }),
      ]);
    });

    after(async () => {
      await Event.deleteMany({ name: new RegExp(`^${globalTag}-`) });
    });

    const feedNames = (res) => res.body.events.map((e) => e.name);

    it('My Clubs lists an in-progress event under upcoming, not past', async () => {
      const up = await get(`/api/event/my-clubs?filter=upcoming&q=${tag}&limit=50`);
      const past = await get(`/api/event/my-clubs?filter=past&q=${tag}&limit=50`);
      expect(up.status).to.equal(200);
      expect(feedNames(up)).to.deep.equal(
        n('inProgress', 'nextRide', 'legacy', 'publicMeetup')
      );
      expect(feedNames(past)).to.deep.equal(n('startedNoEnd', 'badEnd', 'pastRide'));
    });

    it('Global lists an in-progress event under upcoming, not past', async () => {
      const up = await get(`/api/event/global?filter=upcoming&q=${globalTag}&limit=50`);
      const past = await get(`/api/event/global?filter=past&q=${globalTag}&limit=50`);
      expect(up.status).to.equal(200);
      expect(feedNames(up)).to.deep.equal([`${globalTag}-inProgress`, `${globalTag}-future`]);
      expect(feedNames(past)).to.deep.equal([`${globalTag}-startedNoEnd`]);
    });

    it('search still narrows each filter, and total / hasMore stay right', async () => {
      const res = await get(`/api/event/global?filter=upcoming&q=${globalTag}-future&limit=1`);
      expect(feedNames(res)).to.deep.equal([`${globalTag}-future`]);
      expect(res.body.total).to.equal(1);
      expect(res.body.hasMore).to.equal(false);

      const paged = await get(`/api/event/global?filter=upcoming&q=${globalTag}&limit=1`);
      expect(paged.body.total).to.equal(2);
      expect(paged.body.hasMore).to.equal(true);
      expect(feedNames(paged)).to.deep.equal([`${globalTag}-inProgress`]);
    });
  });
});
