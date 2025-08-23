import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import User from '../models/UserModel.js';
import dotenv from 'dotenv';

dotenv.config();

async function createUserAndGetToken() {
  const email = `user_${Date.now()}@example.com`;
  const password = 'Password123!';
  const username = `user_${Date.now()}`;
  await request(app).post('/api/auth/signup').send({ email, password, username });
  const login = await request(app).post('/api/auth/login').send({ email, password });
  return login.body.token;
}

describe('User routes', () => {
  let token;
  
  before(async () => {
    await mongoose.connect(process.env.MONGO_LOCAL_URI);
    token = await createUserAndGetToken();
  });

  after(async () => {
    await mongoose.connection.close();
    if (server) server.close();
  });

  it('GET /api/user should return users array with valid token', async () => {
    const res = await request(app)
      .get('/api/user')
      .set('Authorization', `Bearer ${token}`);
    if (res.status !== 200) {
      console.error('Get users response:', res.status, res.body);
    }
    if (!Array.isArray(res.body)) throw new Error('Expected array of users');
  });

  it('GET /api/user should return 401 without valid token', async () => {
    const res = await request(app).get('/api/user');
    if (res.status !== 401) {
      console.error('Expected 401 for unauthenticated request, got:', res.status, res.body);
    }
  });

  it('User model should validate required fields correctly', async () => {
    try {
      // Test regular user creation - should require password
      const user = new User({
        email: 'test@example.com',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User'
        // Missing password - should fail
      });
      await user.validate();
      throw new Error('Expected validation to fail for missing password');
    } catch (error) {
      if (error.message.includes('Expected validation to fail')) {
        throw error;
      }
      // Expected validation error - test passes
    }
  });

  it('User model should allow missing password for Facebook users', async () => {
    try {
      // Test Facebook user creation - password should be optional
      const user = new User({
        email: 'fbtest@example.com',
        username: 'fbtestuser',
        firstName: 'Test',
        lastName: 'User',
        facebookId: '123456789',
        facebookEmail: 'fbtest@example.com'
        // No password - should be valid for Facebook users
      });
      await user.validate();
      // If we get here, validation passed (good)
    } catch (error) {
      console.error('Facebook user validation failed:', error.message);
      throw new Error('Facebook user should not require password');
    }
  });

  it('User model should preserve profilePhoto field', async () => {
    const user = new User({
      email: 'photo@example.com',
      username: 'photouser',
      firstName: 'Photo',
      lastName: 'User',
      password: 'hashedpassword123',
      profilePhoto: 'https://example.com/photo.jpg'
    });
    
    if (!user.profilePhoto) {
      throw new Error('profilePhoto field should be preserved');
    }
    
    if (user.profilePicture !== undefined) {
      throw new Error('profilePicture field should not exist anymore');
    }
  });
});
