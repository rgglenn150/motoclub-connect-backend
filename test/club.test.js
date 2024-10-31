const request = require('supertest');
const app = require('../server');
const Club = require('../models/ClubModel');
const assert = require('assert');


describe('GET /api/clubs', () => {
  it('should return all clubs', async () => {
    const clubs = await Club.find();
    const res = await request(app).get('/api/clubs');
    assert.strictEqual(res.statusCode, 200);
  });
});
