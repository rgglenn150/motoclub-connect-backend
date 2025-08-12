import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import dotenv from 'dotenv';

dotenv.config();

describe('User routes', () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_LOCAL_URI);
  });

  after(async () => {
    await mongoose.connection.close();
    if (server) server.close();
  });

  it('GET /api/user should return users array', async () => {
    const res = await request(app).get('/api/user');
    if (res.status !== 200) {
      console.error('Get users response:', res.status, res.body);
    }
    if (!Array.isArray(res.body)) throw new Error('Expected array of users');
  });
});
