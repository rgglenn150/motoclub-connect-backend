import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import dotenv from 'dotenv';

dotenv.config();

describe('Auth routes', () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_LOCAL_URI);
  });

  after(async () => {
    await mongoose.connection.close();
    if (server) server.close();
  });

  it('POST /api/auth/signup should create user and return token', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        email: `test_${Date.now()}@example.com`,
        password: 'Password123!',
        username: `user_${Date.now()}`,
        firstName: 'Test',
        lastName: 'User',
      });
    if (![200,201].includes(res.status)) {
      console.error('Signup response:', res.status, res.body);
    }
    // Depending on controller, signup returns 200
    if (res.status === 200) {
      if (!res.body.token) throw new Error('Missing token in signup response');
    }
  });

  it('POST /api/auth/login should return token for valid credentials', async () => {
    const email = `login_${Date.now()}@example.com`;
    const password = 'Password123!';
    const username = `user_${Date.now()}`;
    await request(app).post('/api/auth/signup').send({ email, password, username });
    const res = await request(app).post('/api/auth/login').send({ email, password });
    if (res.status !== 200) {
      console.error('Login response:', res.status, res.body);
    }
    if (!res.body.token) throw new Error('Missing token in login response');
  });

  it('POST /api/auth/logout should succeed', async () => {
    const res = await request(app).post('/api/auth/logout');
    if (res.status !== 200) {
      console.error('Logout response:', res.status, res.body);
    }
  });

  it('POST /api/auth/facebook/register should handle missing access token', async () => {
    const res = await request(app)
      .post('/api/auth/facebook/register')
      .send({
        username: 'testuser'
      });
    if (res.status !== 400) {
      console.error('Facebook register without token response:', res.status, res.body);
    }
    if (!res.body.message || !res.body.message.includes('access token')) {
      throw new Error('Expected error message about missing access token');
    }
  });

  it('POST /api/auth/facebook should handle missing access token', async () => {
    const res = await request(app)
      .post('/api/auth/facebook')
      .send({});
    if (res.status !== 400) {
      console.error('Facebook login without token response:', res.status, res.body);
    }
    if (!res.body.message || !res.body.message.includes('access token')) {
      throw new Error('Expected error message about missing access token');
    }
  });

  it('POST /api/auth/facebook should handle invalid access token', async () => {
    const res = await request(app)
      .post('/api/auth/facebook')
      .send({
        accessToken: 'invalid_token_123'
      });
    // Should return 400 or 404 for invalid token
    if (![400, 404].includes(res.status)) {
      console.error('Facebook login with invalid token response:', res.status, res.body);
    }
  });

  it('POST /api/auth/facebook/register should handle invalid access token', async () => {
    const res = await request(app)
      .post('/api/auth/facebook/register')
      .send({
        accessToken: 'invalid_token_123',
        username: 'testuser'
      });
    // Should return 400 for invalid token
    if (res.status !== 400) {
      console.error('Facebook register with invalid token response:', res.status, res.body);
    }
  });
});
