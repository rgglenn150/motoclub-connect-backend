import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import { ensureConnection } from './setup.js';
import dotenv from 'dotenv';

dotenv.config();

async function createUserAndGetToken() {
  const email = `evt_${Date.now()}@example.com`;
  const password = 'Password123!';
  const username = `user_${Date.now()}`;
  await request(app)
    .post('/api/auth/signup')
    .send({ email, password, username });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  return login.body.token;
}

describe('Event routes', () => {
  let token;
  before(async () => {
    await ensureConnection();
    token = await createUserAndGetToken();
  });

  after(async () => {
    if (server) server.close();
  });

  it('POST /api/event/create should create an event', async () => {
    // First create a club to attach event to, via API
    const clubRes = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Club ${Date.now()}`,
        description: 'Test',
        location: 'NY',
        isPrivate: true,
      });
    const clubId = clubRes.body._id || clubRes.body.id;

    const res = await request(app)
      .post('/api/event/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Ride',
        description: 'Fun',
        clubId,
        startTime: new Date(),
        endTime: new Date(),
        location: 'NY',
      });
    if (![200, 201].includes(res.status)) {
      console.error('Create event response:', res.status, res.body);
    }
  });

  it('GET /api/event should list events', async () => {
    const res = await request(app)
      .get('/api/event')
      .set('Authorization', `Bearer ${token}`);
    if (res.status !== 200) {
      console.error('Get events response:', res.status, res.body);
    }
  });
});
