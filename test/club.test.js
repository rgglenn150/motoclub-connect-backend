import request from 'supertest';
import app from '../server.js';
import Club from '../models/ClubModel.js';
import assert from 'assert';

describe('GET /api/clubs', () => {
  it('should return all clubs', async () => {
    const clubs = await Club.find();
    const res = await request(app).get('/api/clubs');
    assert.strictEqual(res.statusCode, 200);
    assert.equal(res.body.clubs.length, clubs.length);
  });
});
