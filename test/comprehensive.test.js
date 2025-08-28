import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import { ensureConnection } from './setup.js';
import User from '../models/UserModel.js';
import Club from '../models/ClubModel.js';
import dotenv from 'dotenv';

dotenv.config();

describe('Comprehensive Integration Tests', () => {
  before(async () => {
    await ensureConnection();
  });

  after(async () => {
    if (server) server.close();
  });

  describe('User Model Compatibility Tests', () => {
    it('should handle User creation with profilePhoto field', async () => {
      try {
        const user = await User.signup(
          `profiletest_${Date.now()}@example.com`,
          'Password123!',
          `profileuser_${Date.now()}`,
          'Profile',
          'Test'
        );

        // Update user with profilePhoto
        user.profilePhoto = 'https://example.com/photo.jpg';
        await user.save();

        const savedUser = await User.findById(user._id);
        if (!savedUser.profilePhoto) {
          throw new Error('profilePhoto field not preserved after save');
        }

        // Clean up
        await User.findByIdAndDelete(user._id);
      } catch (error) {
        throw new Error(`User profilePhoto test failed: ${error.message}`);
      }
    });

    it('should handle Facebook user creation correctly', async () => {
      try {
        const facebookId = `fb_${Date.now()}`;
        const email = `fbuser_${Date.now()}@example.com`;

        const user = await User.facebookSignup(
          facebookId,
          email,
          'Facebook',
          'User',
          'https://facebook.com/photo.jpg',
          `fbuser_${Date.now()}`
        );

        if (!user.facebookId || user.facebookId !== facebookId) {
          throw new Error('Facebook ID not set correctly');
        }

        if (!user.profilePhoto) {
          throw new Error('Facebook profile photo not set');
        }

        if (!user.facebookEmail || user.facebookEmail !== email) {
          throw new Error('Facebook email not set correctly');
        }

        // Clean up
        await User.findByIdAndDelete(user._id);
      } catch (error) {
        throw new Error(`Facebook user creation test failed: ${error.message}`);
      }
    });

    it('should prevent duplicate Facebook accounts', async () => {
      const facebookId = `fb_duplicate_${Date.now()}`;
      const email = `duplicate_${Date.now()}@example.com`;

      try {
        // Create first Facebook user
        const user1 = await User.facebookSignup(
          facebookId,
          email,
          'First',
          'User',
          null,
          `firstuser_${Date.now()}`
        );

        // Try to create second user with same Facebook ID
        const user2 = await User.facebookSignup(
          facebookId,
          email,
          'Second',
          'User',
          null,
          `seconduser_${Date.now()}`
        );

        // Should return the same user
        if (user1._id.toString() !== user2._id.toString()) {
          throw new Error('Should return same user for duplicate Facebook ID');
        }

        // Clean up
        await User.findByIdAndDelete(user1._id);
      } catch (error) {
        throw new Error(
          `Duplicate Facebook account test failed: ${error.message}`
        );
      }
    });
  });

  describe('API Integration Tests', () => {
    let authToken;
    let testUser;

    before(async () => {
      // Create a test user and get auth token
      const email = `integration_${Date.now()}@example.com`;
      const password = 'Password123!';
      const username = `integration_${Date.now()}`;

      const signupRes = await request(app)
        .post('/api/auth/signup')
        .send({
          email,
          password,
          username,
          firstName: 'Test',
          lastName: 'User',
        });

      if (signupRes.status !== 200) {
        throw new Error(
          `Signup failed: ${signupRes.status} ${JSON.stringify(signupRes.body)}`
        );
      }

      authToken = signupRes.body.token;

      // Get user info
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email, password });

      testUser = loginRes.body.user;
    });

    it('should create club with authenticated user', async () => {
      const clubData = {
        name: `Test Club ${Date.now()}`,
        description: 'Integration test club',
        location: 'Test City',
        isPrivate: false,
      };

      const res = await request(app)
        .post('/api/club/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(clubData);

      if (![200, 201].includes(res.status)) {
        throw new Error(
          `Club creation failed: ${res.status} ${JSON.stringify(res.body)}`
        );
      }

      if (!res.body._id && !res.body.id) {
        throw new Error('Club creation did not return ID');
      }
    });

    it('should list clubs for authenticated user', async () => {
      const res = await request(app)
        .get('/api/club')
        .set('Authorization', `Bearer ${authToken}`);

      if (res.status !== 200) {
        throw new Error(
          `Club listing failed: ${res.status} ${JSON.stringify(res.body)}`
        );
      }
    });

    it('should list users for authenticated user', async () => {
      const res = await request(app)
        .get('/api/user')
        .set('Authorization', `Bearer ${authToken}`);

      if (res.status !== 200) {
        throw new Error(
          `User listing failed: ${res.status} ${JSON.stringify(res.body)}`
        );
      }

      if (!Array.isArray(res.body)) {
        throw new Error('User listing did not return array');
      }
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/user');

      if (res.status !== 401) {
        throw new Error(
          `Expected 401 for unauthenticated request, got ${res.status}`
        );
      }
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle invalid JWT tokens gracefully', async () => {
      const res = await request(app)
        .get('/api/user')
        .set('Authorization', 'Bearer invalid_token_123');

      if (res.status !== 403) {
        throw new Error(`Expected 403 for invalid token, got ${res.status}`);
      }
    });

    it('should handle malformed authorization headers', async () => {
      const res = await request(app)
        .get('/api/user')
        .set('Authorization', 'InvalidFormat');

      if (res.status !== 401) {
        throw new Error(
          `Expected 401 for malformed auth header, got ${res.status}`
        );
      }
    });

    it('should handle missing required fields in signup', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'incomplete@test.com' }); // Missing password and username

      if (res.status !== 400) {
        throw new Error(
          `Expected 400 for incomplete signup, got ${res.status}`
        );
      }
    });

    it('should handle duplicate email in signup', async () => {
      const email = `duplicate_${Date.now()}@example.com`;
      const password = 'Password123!';
      const username1 = `user1_${Date.now()}`;
      const username2 = `user2_${Date.now()}`;

      // First signup should succeed
      const res1 = await request(app)
        .post('/api/auth/signup')
        .send({ email, password, username: username1 });

      if (res1.status !== 200) {
        throw new Error(`First signup failed: ${res1.status}`);
      }

      // Second signup with same email should fail
      const res2 = await request(app)
        .post('/api/auth/signup')
        .send({ email, password, username: username2 });

      if (res2.status !== 400) {
        throw new Error(`Expected 400 for duplicate email, got ${res2.status}`);
      }
    });
  });
});
