import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import { ensureConnection } from './setup.js';
import Club from '../models/ClubModel.js';
import Member from '../models/MemberModel.js';
import JoinRequest from '../models/JoinRequest.js';
import User from '../models/UserModel.js';
import assert from 'assert';
import dotenv from 'dotenv';

dotenv.config();

describe('Club Membership Status API', () => {
  let testUser;
  let testClub;
  let userToken;
  
  before(async () => {
    await ensureConnection();
    
    // Clean up any existing test data
    await User.deleteMany({ email: { $regex: /membership_test/ } });
    await Club.deleteMany({ clubName: { $regex: /Test Club/ } });
  });
  
  beforeEach(async () => {
    // Create a test user and get token
    const uniqueId = Date.now();
    const userData = {
      email: `membership_test_${uniqueId}@example.com`,
      password: 'password123',
      username: `membership_user_${uniqueId}`,
    };
    
    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send(userData);
    
    assert.strictEqual(signupRes.statusCode, 200);
    userToken = signupRes.body.token;
    
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: userData.email, password: userData.password });
    
    testUser = loginRes.body.user;
    
    // Create a test club
    const clubData = {
      name: `Test Club ${uniqueId}`,
      description: 'Test club for membership status',
      location: 'Test Location',
      isPrivate: false,
    };
    
    const clubRes = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${userToken}`)
      .send(clubData);
    
    assert.strictEqual(clubRes.statusCode, 201);
    testClub = clubRes.body;
  });
  
  afterEach(async () => {
    // Clean up test data created in this test
    await User.deleteMany({ email: { $regex: /membership_test|regular_member|non_member|pending_user/ } });
    await Member.deleteMany({});
    await JoinRequest.deleteMany({});
    await Club.deleteMany({ clubName: { $regex: /Test Club|Private Test Club/ } });
  });

  after(async () => {
    if (server) {
      server.close();
    }
  });

  describe('GET /:clubId/membership-status', () => {
    it('should return admin status for club creator', async () => {
      const res = await request(app)
        .get(`/api/club/${testClub._id}/membership-status`)
        .set('Authorization', `Bearer ${userToken}`);
      
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'admin');
      assert.strictEqual(res.body.role, 'admin');
      assert(Array.isArray(res.body.permissions));
      assert(res.body.permissions.includes('manage'));
      assert(res.body.permissions.includes('admin'));
      assert(res.body.memberSince);
      assert(res.body.memberId);
    });

    it('should return not-member status for non-member user', async () => {
      // Create another user who is not a member
      const uniqueId = Date.now();
      const userData = {
        email: `non_member_${uniqueId}@example.com`,
        password: 'password123',
        username: `non_member_${uniqueId}`,
      };
      
      const signupRes = await request(app)
        .post('/api/auth/signup')
        .send(userData);
      
      const nonMemberToken = signupRes.body.token;
      
      const res = await request(app)
        .get(`/api/club/${testClub._id}/membership-status`)
        .set('Authorization', `Bearer ${nonMemberToken}`);
      
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'not-member');
      assert(!res.body.role);
      assert(!res.body.permissions);
      assert(!res.body.memberSince);
    });

    it('should return member status for regular member', async () => {
      // Create another user and make them a regular member
      const uniqueId = Date.now();
      const userData = {
        email: `regular_member_${uniqueId}@example.com`,
        password: 'password123',
        username: `regular_member_${uniqueId}`,
      };
      
      const signupRes = await request(app)
        .post('/api/auth/signup')
        .send(userData);
      
      const memberToken = signupRes.body.token;
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: userData.email, password: userData.password });
      
      const memberUser = loginRes.body.user;
      
      // Add user as regular member to the club
      const member = new Member({
        user: memberUser._id,
        club: testClub._id,
        roles: ['member'],
      });
      await member.save();
      
      // Update the club's members array
      await Club.findByIdAndUpdate(testClub._id, { 
        $push: { members: member._id } 
      });
      
      const res = await request(app)
        .get(`/api/club/${testClub._id}/membership-status`)
        .set('Authorization', `Bearer ${memberToken}`);
      
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'member');
      assert.strictEqual(res.body.role, 'member');
      assert(Array.isArray(res.body.permissions));
      assert(res.body.permissions.includes('view'));
      assert(res.body.permissions.includes('post'));
      assert(!res.body.permissions.includes('manage'));
      assert(res.body.memberSince);
      assert(res.body.memberId);
    });

    it('should return pending status when user has pending join request', async () => {
      // Create a private club
      const uniqueId = Date.now();
      const privateClubData = {
        name: `Private Test Club ${uniqueId}`,
        description: 'Private test club',
        location: 'Test Location',
        isPrivate: true,
      };
      
      const privateClubRes = await request(app)
        .post('/api/club/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send(privateClubData);
      
      const privateClub = privateClubRes.body;
      
      // Create another user
      const pendingUserData = {
        email: `pending_user_${uniqueId}@example.com`,
        password: 'password123',
        username: `pending_user_${uniqueId}`,
      };
      
      const pendingSignupRes = await request(app)
        .post('/api/auth/signup')
        .send(pendingUserData);
      
      const pendingUserToken = pendingSignupRes.body.token;
      const pendingLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: pendingUserData.email, password: pendingUserData.password });
      
      const pendingUser = pendingLoginRes.body.user;
      
      // Create a pending join request
      await request(app)
        .post(`/api/club/${privateClub._id}/join`)
        .set('Authorization', `Bearer ${pendingUserToken}`);
      
      const res = await request(app)
        .get(`/api/club/${privateClub._id}/membership-status`)
        .set('Authorization', `Bearer ${pendingUserToken}`);
      
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'pending');
      assert(res.body.joinRequestId);
      assert(res.body.requestedAt);
      assert(!res.body.role);
      assert(!res.body.permissions);
    });

    it('should return 404 for non-existent club', async () => {
      const fakeClubId = '507f1f77bcf86cd799439011';
      
      const res = await request(app)
        .get(`/api/club/${fakeClubId}/membership-status`)
        .set('Authorization', `Bearer ${userToken}`);
      
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.body.message, 'Club not found');
    });

    it('should return 401 without authentication token', async () => {
      const res = await request(app)
        .get(`/api/club/${testClub._id}/membership-status`);
      
      assert.strictEqual(res.statusCode, 401);
    });

    it('should return 400 for invalid club ID format', async () => {
      const res = await request(app)
        .get('/api/club/invalid-id/membership-status')
        .set('Authorization', `Bearer ${userToken}`);
      
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.message, 'Invalid club ID format');
    });
  });
});