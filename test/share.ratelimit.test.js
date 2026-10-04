import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { app } from '../server.js';
import {
  createShareRateLimit,
  SHARE_RATE_LIMIT_PER_MIN,
} from '../middlewares/rateLimit.js';

// Spec 001, FR-019 / ADR-0001: public /share routes are rate-limited per client.
describe('Share route rate limit', () => {
  describe('createShareRateLimit', () => {
    const small = () => {
      const tiny = express();
      tiny.set('trust proxy', 1);
      tiny.use(createShareRateLimit({ limit: 3 }));
      tiny.get('/ping', (req, res) => res.send('ok'));
      return tiny;
    };

    it('allows the limit, then answers 429 with an empty body', async () => {
      const tiny = small();
      const codes = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await request(tiny)
          .get('/ping')
          .set('X-Forwarded-For', '198.51.100.1');
        codes.push(res.status);
        if (i === 3) expect(res.text).to.equal('');
      }

      expect(codes).to.deep.equal([200, 200, 200, 429]);
    });

    it('counts each client separately', async () => {
      const tiny = small();
      for (let i = 0; i < 3; i += 1) {
        await request(tiny).get('/ping').set('X-Forwarded-For', '198.51.100.2');
      }

      const other = await request(tiny)
        .get('/ping')
        .set('X-Forwarded-For', '198.51.100.3');

      expect(other.status).to.equal(200);
    });

    it('sends standard RateLimit headers', async () => {
      const res = await request(small())
        .get('/ping')
        .set('X-Forwarded-For', '198.51.100.4');

      expect(res.headers).to.have.property('ratelimit-policy');
      expect(res.headers).to.have.property('ratelimit');
      expect(res.headers).to.not.have.property('x-ratelimit-limit');
    });
  });

  describe('in the app', function () {
    this.timeout(30000);

    it(`limits /share to ${SHARE_RATE_LIMIT_PER_MIN} requests per minute per client`, async () => {
      const client = '203.0.113.9';
      let last;
      for (let i = 0; i <= SHARE_RATE_LIMIT_PER_MIN; i += 1) {
        last = await request(app)
          .get('/share/collection/not-an-id/card.png')
          .set('X-Forwarded-For', client);
        if (i < SHARE_RATE_LIMIT_PER_MIN) expect(last.status).to.equal(404);
      }

      expect(last.status).to.equal(429);
    });

    it('never limits the API', async () => {
      const client = '203.0.113.10';
      for (let i = 0; i <= SHARE_RATE_LIMIT_PER_MIN; i += 1) {
        await request(app)
          .get('/share/collection/not-an-id/card.png')
          .set('X-Forwarded-For', client);
      }

      const api = await request(app)
        .get('/api/wakeup')
        .set('X-Forwarded-For', client);

      expect(api.status).to.equal(200);
    });
  });
});
