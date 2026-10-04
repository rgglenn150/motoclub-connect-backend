import { expect } from 'chai';
import sinon from 'sinon';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { app } from '../server.js';
import {
  createShareRateLimit,
  shareClientKey,
  resetProxyWarning,
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

  describe('keying for requests proxied by the app middleware (spec 002, FR-006)', () => {
    const SECRET = 's'.repeat(40);
    const proxied = (tiny, clientIp, secret = SECRET) =>
      request(tiny)
        .get('/ping')
        .set('X-Forwarded-For', '198.51.100.50') // the Vercel edge, as nginx reports it
        .set('X-Share-Client-IP', clientIp)
        .set('X-Share-Proxy-Secret', secret);

    const tinyApp = (secret = SECRET) => {
      const tiny = express();
      tiny.set('trust proxy', 1);
      tiny.use(createShareRateLimit({ limit: 2, secret }));
      tiny.get('/ping', (req, res) => res.send('ok'));
      return tiny;
    };

    afterEach(() => sinon.restore());

    it('gives each proxied client its own allowance when the secret matches', async () => {
      const tiny = tinyApp();
      await proxied(tiny, '203.0.113.1');
      await proxied(tiny, '203.0.113.1');

      expect((await proxied(tiny, '203.0.113.2')).status).to.equal(200);
      expect((await proxied(tiny, '203.0.113.1')).status).to.equal(429);
    });

    it('accepts IPv6 client addresses', async () => {
      const tiny = tinyApp();
      expect((await proxied(tiny, '2001:db8::1')).status).to.equal(200);
    });

    for (const [label, makeReq] of [
      ['a wrong secret', (tiny, ip) => proxied(tiny, ip, 'w'.repeat(40))],
      [
        'a missing secret',
        (tiny, ip) =>
          request(tiny)
            .get('/ping')
            .set('X-Forwarded-For', '198.51.100.50')
            .set('X-Share-Client-IP', ip),
      ],
      ['an invalid client IP', (tiny) => proxied(tiny, 'not-an-ip')],
    ]) {
      it(`falls back to the connecting IP with ${label}`, async () => {
        sinon.stub(console, 'warn');
        const tiny = tinyApp();
        await makeReq(tiny, '203.0.113.1');
        await makeReq(tiny, '203.0.113.2');

        // Both requests counted against 198.51.100.50, so the third is limited.
        expect((await makeReq(tiny, '203.0.113.3')).status).to.equal(429);
      });
    }

    it('ignores the headers when the configured secret is too short', async () => {
      sinon.stub(console, 'warn');
      const short = 'short-secret';
      const tiny = tinyApp(short);
      await proxied(tiny, '203.0.113.1', short);
      await proxied(tiny, '203.0.113.2', short);

      expect((await proxied(tiny, '203.0.113.3', short)).status).to.equal(429);
    });

    it('compares the secret in constant time', () => {
      const compare = sinon.spy(crypto, 'timingSafeEqual');
      const req = {
        ip: '198.51.100.50',
        get: (name) =>
          ({
            'x-share-client-ip': '203.0.113.1',
            'x-share-proxy-secret': SECRET,
          })[name.toLowerCase()],
      };

      shareClientKey(req, SECRET);

      expect(compare.calledOnce).to.equal(true);
    });
  });

  describe('warning on a misconfigured proxy secret (red-team F3)', () => {
    const SECRET = 's'.repeat(40);
    const reqWith = (headers) => ({
      ip: '198.51.100.50',
      get: (name) => headers[name.toLowerCase()],
    });
    const warnings = (warn) =>
      warn
        .getCalls()
        .filter((c) => String(c.args[0]).includes('SHARE_PROXY_SECRET'));

    let warn;
    beforeEach(() => {
      resetProxyWarning();
      warn = sinon.stub(console, 'warn');
    });
    afterEach(() => sinon.restore());

    it('warns once when proxy headers carry a wrong secret, without leaking it', () => {
      const wrong = 'w'.repeat(40);
      for (let i = 0; i < 3; i += 1) {
        shareClientKey(
          reqWith({
            'x-share-client-ip': '203.0.113.1',
            'x-share-proxy-secret': wrong,
          }),
          SECRET
        );
      }

      expect(warnings(warn)).to.have.length(1);
      const message = warnings(warn)[0].args.join(' ');
      expect(message).to.not.include(wrong);
      expect(message).to.not.include(SECRET);
    });

    it('warns once when proxy headers arrive but the secret is unset or too short', () => {
      shareClientKey(
        reqWith({
          'x-share-client-ip': '203.0.113.1',
          'x-share-proxy-secret': 'abc',
        }),
        undefined
      );
      shareClientKey(reqWith({ 'x-share-client-ip': '203.0.113.1' }), 'short');

      expect(warnings(warn)).to.have.length(1);
    });

    it('never warns for valid proxied requests or plain requests', () => {
      shareClientKey(
        reqWith({
          'x-share-client-ip': '203.0.113.1',
          'x-share-proxy-secret': SECRET,
        }),
        SECRET
      );
      shareClientKey(reqWith({}), SECRET);
      shareClientKey(reqWith({}), undefined);

      expect(warnings(warn)).to.have.length(0);
    });
  });

  describe('in the app', function () {
    this.timeout(30000);

    // One listening server for the whole burst: supertest otherwise starts a
    // new one per request, and 120+ of those in a row can drop connections.
    let server;
    before((done) => {
      server = app.listen(0, done);
    });
    after((done) => {
      server.close(done);
    });

    it(`limits /share to ${SHARE_RATE_LIMIT_PER_MIN} requests per minute per client`, async () => {
      const client = '203.0.113.9';
      let last;
      for (let i = 0; i <= SHARE_RATE_LIMIT_PER_MIN; i += 1) {
        last = await request(server)
          .get('/share/collection/not-an-id/card.png')
          .set('X-Forwarded-For', client);
        if (i < SHARE_RATE_LIMIT_PER_MIN) expect(last.status).to.equal(404);
      }

      expect(last.status).to.equal(429);
    });

    it('never limits the API', async () => {
      const client = '203.0.113.10';
      for (let i = 0; i <= SHARE_RATE_LIMIT_PER_MIN; i += 1) {
        await request(server)
          .get('/share/collection/not-an-id/card.png')
          .set('X-Forwarded-For', client);
      }

      const api = await request(server)
        .get('/api/wakeup')
        .set('X-Forwarded-For', client);

      expect(api.status).to.equal(200);
    });
  });
});
