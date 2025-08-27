import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import { ensureConnection } from './setup.js';
import Club from '../models/ClubModel.js';
import assert from 'assert';
import dotenv from 'dotenv';

dotenv.config();

describe('GET /api/clubs', () => {
  before(async () => {
    await ensureConnection();
  });

  after(async () => {
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
