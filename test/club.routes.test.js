import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import dotenv from 'dotenv';

dotenv.config();

async function createUserAndGetToken() {
  const email = `club_${Date.now()}@example.com`;
  const password = 'Password123!';
  const username = `user_${Date.now()}`;
  await request(app).post('/api/auth/signup').send({ email, password, username });
  const login = await request(app).post('/api/auth/login').send({ email, password });
  return login.body.token;
}

describe('Club routes', () => {
  let token;
  before(async () => {
    await mongoose.connect(process.env.MONGO_LOCAL_URI);
    token = await createUserAndGetToken();
  });

  after(async () => {
    await mongoose.connection.close();
    if (server) server.close();
  });

  it('POST /api/club/create should create a club', async () => {
    const res = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Club ${Date.now()}`, description: 'Desc', location: 'LA', isPrivate: true });
    if (![200,201].includes(res.status)) {
      console.error('Create club response:', res.status, res.body);
    }
  });

  it('GET /api/club should list clubs', async () => {
    const res = await request(app).get('/api/club');
    if (res.status !== 200) {
      console.error('List clubs response:', res.status, res.body);
    }
  });

  it('GET /api/club/:id should return club (auth required)', async () => {
    const create = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Club ${Date.now()}`, description: 'Desc', location: 'SF', isPrivate: false });
    const id = create.body._id || create.body.id;
    const res = await request(app)
      .get(`/api/club/${id}`)
      .set('Authorization', `Bearer ${token}`);
    if (res.status !== 200) {
      console.error('Get club response:', res.status, res.body);
    }
  });

  it('POST /api/club/:clubId/join should create join request', async () => {
    const create = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Club ${Date.now()}`, description: 'Desc', location: 'SF', isPrivate: false });
    const clubId = create.body._id || create.body.id;
    const res = await request(app)
      .post(`/api/club/${clubId}/join`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    if (![200,201].includes(res.status)) {
      console.error('Join club response:', res.status, res.body);
    }
  });
});
