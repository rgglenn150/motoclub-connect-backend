import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import Club from '../models/ClubModel.js';
import assert from 'assert';
import dotenv from 'dotenv';

dotenv.config();

describe('GET /api/clubs', () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_LOCAL_URI);
  });

  after(async () => {
    await mongoose.connection.close();
    if (server) {
      server.close();
    }
  });

  it('should return all clubs', async () => {
    const clubs = await Club.find();
    const res = await request(app).get('/api/club');
    assert.strictEqual(res.statusCode, 200);
    assert.equal(res.body.clubs.length, clubs.length);
  });
});