import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import { ensureConnection } from './setup.js';
import Club from '../models/ClubModel.js';
import Member from '../models/MemberModel.js';
import User from '../models/UserModel.js';
import assert from 'assert';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

describe('Member Role Management', () => {
  let adminUser, memberUser, club, adminMembership, memberMembership, adminToken, memberToken;

  before(async () => {
    await ensureConnection();
    
    // Clean up test data
    await Club.deleteMany({ clubName: /^Test Club/ });
    await User.deleteMany({ email: /test-member-role/ });
    await Member.deleteMany({});

    // Create test users
    adminUser = new User({
      username: 'admin-test-user',
      email: 'test-member-role-admin@example.com',
      password: 'hashedpassword123',
      firstName: 'Admin',
      lastName: 'User',
    });
    await adminUser.save();

    memberUser = new User({
      username: 'member-test-user',
      email: 'test-member-role-member@example.com',
      password: 'hashedpassword123',
      firstName: 'Member',
      lastName: 'User',
    });
    await memberUser.save();

    // Create test club
    club = new Club({
      clubName: 'Test Club Role Management',
      description: 'Test club for role management',
      location: 'Test Location',
      isPrivate: false,
      createdBy: adminUser._id,
      members: [],
    });
    await club.save();

    // Create admin membership
    adminMembership = new Member({
      user: adminUser._id,
      club: club._id,
      roles: ['member', 'admin'],
    });
    await adminMembership.save();

    // Create regular membership
    memberMembership = new Member({
      user: memberUser._id,
      club: club._id,
      roles: ['member'],
    });
    await memberMembership.save();

    // Update club with members
    club.members = [adminMembership._id, memberMembership._id];
    await club.save();

    // Create JWT tokens
    adminToken = jwt.sign(
      { _id: adminUser._id, email: adminUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    memberToken = jwt.sign(
      { _id: memberUser._id, email: memberUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  after(async () => {
    // Clean up test data
    if (club) await Club.findByIdAndDelete(club._id);
    if (adminUser) await User.findByIdAndDelete(adminUser._id);
    if (memberUser) await User.findByIdAndDelete(memberUser._id);
    if (adminMembership) await Member.findByIdAndDelete(adminMembership._id);
    if (memberMembership) await Member.findByIdAndDelete(memberMembership._id);
    
    if (server) {
      server.close();
    }
  });

  describe('POST /api/club/:clubId/members/:memberId/promote', () => {
    it('should promote a member to admin when requested by admin', async () => {
      const res = await request(app)
        .post(`/api/club/${club._id}/members/${memberMembership._id}/promote`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.message, 'Member promoted to admin successfully');
      assert.strictEqual(res.body.member.role, 'admin');
      assert.strictEqual(res.body.member._id, memberMembership._id.toString());

      // Verify in database
      const updatedMember = await Member.findById(memberMembership._id);
      assert(updatedMember.roles.includes('admin'));
    });

    it('should return 403 when non-admin tries to promote', async () => {
      // First reset the member back to regular member role (in case previous test promoted them)
      await Member.findByIdAndUpdate(memberMembership._id, {
        roles: ['member']
      });

      const res = await request(app)
        .post(`/api/club/${club._id}/members/${memberMembership._id}/promote`)
        .set('Authorization', `Bearer ${memberToken}`);

      assert.strictEqual(res.statusCode, 403);
    });

    it('should return 400 when trying to promote already admin member', async () => {
      const res = await request(app)
        .post(`/api/club/${club._id}/members/${adminMembership._id}/promote`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.message, 'Member is already an admin');
    });

    it('should return 404 for non-existent member', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .post(`/api/club/${club._id}/members/${fakeId}/promote`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.statusCode, 404);
    });
  });

  describe('POST /api/club/:clubId/members/:memberId/demote', () => {
    it('should return 400 when trying to demote yourself', async () => {
      const res = await request(app)
        .post(`/api/club/${club._id}/members/${adminMembership._id}/demote`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.message, 'You cannot demote yourself');
    });

    it('should return 400 when trying to demote non-admin member', async () => {
      // First, demote the member back to regular member status if needed
      await Member.findByIdAndUpdate(memberMembership._id, {
        roles: ['member']
      });

      const res = await request(app)
        .post(`/api/club/${club._id}/members/${memberMembership._id}/demote`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.message, 'Member is not an admin');
    });

    it('should return 403 when non-admin tries to demote', async () => {
      const res = await request(app)
        .post(`/api/club/${club._id}/members/${adminMembership._id}/demote`)
        .set('Authorization', `Bearer ${memberToken}`);

      assert.strictEqual(res.statusCode, 403);
    });

    it('should return 404 for non-existent member', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .post(`/api/club/${club._id}/members/${fakeId}/demote`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.statusCode, 404);
    });
  });
});