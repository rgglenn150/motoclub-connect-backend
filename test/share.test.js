import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../server.js';
import Collection from '../models/CollectionModel.js';
import Club from '../models/ClubModel.js';
import Payment from '../models/PaymentModel.js';
import IDCardService from '../utils/idCardService.js';
import { clearCardCache } from '../utils/shareCard.js';

const FB_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const CLUB_ID = '507f1f77bcf86cd799439011';
const COLLECTION_ID = '507f191e810c19729de860ea';
const UPDATED_AT = new Date('2026-10-01T00:00:00Z');

function meta(html, attr, key) {
  const match = html.match(
    new RegExp(`<meta ${attr}="${key}" content="([^"]*)"/>`)
  );
  return match ? match[1] : null;
}

// The share page only reads from Mongo, so stubbing the model calls keeps this
// suite free of a database connection. Payment totals come back in the grouped
// shape utils/collectionProgress.js asks for (rejected payments are filtered
// out by its $match, so they never appear here).
function stubCollection(doc, { confirmed = 4500, pending = 1200 } = {}) {
  sinon.stub(Collection, 'findById').returns({
    lean: () => Promise.resolve(doc && { updatedAt: UPDATED_AT, ...doc }),
  });
  sinon.stub(Club, 'findById').returns({
    lean: () =>
      Promise.resolve({
        _id: CLUB_ID,
        clubName: 'Iron Riders',
        logoUrl: 'https://cdn.test/logo.png',
      }),
  });
  const collection = new mongoose.Types.ObjectId(COLLECTION_ID);
  const rows = [];
  if (confirmed)
    rows.push({ _id: { collection, status: 'confirmed' }, total: confirmed });
  if (pending)
    rows.push({ _id: { collection, status: 'pending' }, total: pending });
  return sinon.stub(Payment, 'aggregate').resolves(rows);
}

const PUBLIC_COLLECTION = {
  _id: COLLECTION_ID,
  club: CLUB_ID,
  name: 'Ride for Relief',
  description: 'Fuel and supplies for the typhoon run.',
  targetAmount: 10000,
  visibility: 'public',
};

describe('GET /share/collection/:collectionId', () => {
  beforeEach(() => {
    process.env.PUBLIC_API_URL = 'https://api.test';
  });

  afterEach(() => {
    sinon.restore();
    delete process.env.PUBLIC_API_URL;
  });

  it('renders Open Graph tags with confirmed and pending progress for a public collection', async () => {
    const aggregate = stubCollection(PUBLIC_COLLECTION);

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA);

    expect(res.status).to.equal(200);
    expect(res.headers['content-type']).to.match(/text\/html/);
    expect(res.headers['cache-control']).to.equal('public, max-age=300');
    expect(meta(res.text, 'property', 'og:title')).to.equal(
      'Ride for Relief · Iron Riders'
    );
    expect(meta(res.text, 'property', 'og:description')).to.equal(
      'Fuel and supplies for the typhoon run. ₱4,500 confirmed + ₱1,200 pending of ₱10,000.'
    );
    expect(aggregate.firstCall.args[0][0].$match.status).to.deep.equal({
      $in: ['confirmed', 'pending'],
    });
    expect(res.text).to.include(
      `/clubs/${CLUB_ID}/collection/${COLLECTION_ID}`
    );
  });

  it('points og:image at the versioned progress card with large-card tags', async () => {
    stubCollection(PUBLIC_COLLECTION);

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA);

    const cardUrl = `https://api.test/share/collection/${COLLECTION_ID}/card.png?v=4500-1200-${UPDATED_AT.getTime()}`;
    expect(meta(res.text, 'property', 'og:image')).to.equal(cardUrl);
    expect(meta(res.text, 'name', 'twitter:image')).to.equal(cardUrl);
    expect(meta(res.text, 'property', 'og:image:width')).to.equal('1200');
    expect(meta(res.text, 'property', 'og:image:height')).to.equal('630');
    expect(meta(res.text, 'property', 'og:image:type')).to.equal('image/png');
    expect(meta(res.text, 'name', 'twitter:card')).to.equal(
      'summary_large_image'
    );
  });

  it('builds the card URL from the forwarded protocol and host without PUBLIC_API_URL', async () => {
    delete process.env.PUBLIC_API_URL;
    stubCollection(PUBLIC_COLLECTION);

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA)
      .set('Host', 'moto-api.example')
      .set('X-Forwarded-Proto', 'https');

    expect(meta(res.text, 'property', 'og:image')).to.match(
      new RegExp(
        `^https://moto-api\\.example/share/collection/${COLLECTION_ID}/card\\.png\\?v=`
      )
    );
  });

  it('describes the club when the collection has no description', async () => {
    stubCollection({ ...PUBLIC_COLLECTION, description: undefined });

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA);

    expect(meta(res.text, 'property', 'og:description')).to.equal(
      'Iron Riders is collecting contributions. ₱4,500 confirmed + ₱1,200 pending of ₱10,000.'
    );
  });

  it('says "so far" without a target and drops pending when there is none', async () => {
    stubCollection(
      { ...PUBLIC_COLLECTION, targetAmount: undefined },
      { pending: 0 }
    );

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA);

    expect(meta(res.text, 'property', 'og:description')).to.equal(
      'Fuel and supplies for the typhoon run. ₱4,500 confirmed so far.'
    );
    expect(meta(res.text, 'property', 'og:image')).to.include(
      '/card.png?v=4500-0-'
    );
  });

  it('keeps descriptions within 300 characters', async () => {
    stubCollection({
      ...PUBLIC_COLLECTION,
      description: 'Long ride. '.repeat(60),
    });

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA);

    const description = meta(res.text, 'property', 'og:description');
    expect(description.length).to.be.at.most(300);
    expect(description.endsWith('…')).to.equal(true);
  });

  it('escapes markup in the collection name and description', async () => {
    stubCollection({
      ...PUBLIC_COLLECTION,
      name: 'Ride "2025" <script>',
      description: 'Bring & share',
    });

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA);

    expect(res.text).to.not.include('<script>alert');
    expect(res.text).to.include('Ride &quot;2025&quot; &lt;script&gt;');
    expect(res.text).to.include('Bring &amp; share');
  });

  it('keeps a members-only collection generic', async () => {
    stubCollection({
      ...PUBLIC_COLLECTION,
      name: 'Secret dues',
      description: 'internal',
      visibility: 'members_only',
    });

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA);

    expect(res.status).to.equal(200);
    for (const leak of [
      'Secret dues',
      'internal',
      'Iron Riders',
      '4,500',
      '1,200',
      'card.png',
      'cdn.test/logo',
    ]) {
      expect(res.text).to.not.include(leak);
    }
    expect(meta(res.text, 'property', 'og:title')).to.equal('Motoclub Connect');
    expect(meta(res.text, 'property', 'og:image')).to.match(
      /\/assets\/icons\/icon-512x512\.png$/
    );
    expect(meta(res.text, 'name', 'twitter:card')).to.equal('summary');
    expect(meta(res.text, 'property', 'og:image:width')).to.equal(null);
    // Still deep-links, so a member who opens it lands on the collection.
    expect(res.text).to.include(
      `/clubs/${CLUB_ID}/collection/${COLLECTION_ID}`
    );
  });

  it('shows the generic preview when the collection cannot be loaded', async () => {
    sinon
      .stub(Collection, 'findById')
      .returns({ lean: () => Promise.reject(new Error('db down')) });

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', FB_UA);

    expect(res.status).to.equal(200);
    expect(meta(res.text, 'property', 'og:title')).to.equal('Motoclub Connect');
  });

  it('redirects a real browser to the app page', async () => {
    stubCollection(PUBLIC_COLLECTION);

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', BROWSER_UA);

    expect(res.status).to.equal(302);
    expect(res.headers.location).to.match(
      new RegExp(`/clubs/${CLUB_ID}/collection/${COLLECTION_ID}$`)
    );
  });

  it('redirects a browser to a members-only collection page too', async () => {
    stubCollection({ ...PUBLIC_COLLECTION, visibility: 'members_only' });

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', BROWSER_UA);

    expect(res.status).to.equal(302);
    expect(res.headers.location).to.match(
      new RegExp(`/clubs/${CLUB_ID}/collection/${COLLECTION_ID}$`)
    );
  });

  it('redirects a browser to the app home for unknown or malformed links', async () => {
    sinon
      .stub(Collection, 'findById')
      .returns({ lean: () => Promise.resolve(null) });

    const unknown = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', BROWSER_UA);
    const malformed = await request(app)
      .get('/share/collection/not-an-id')
      .set('User-Agent', BROWSER_UA);

    for (const res of [unknown, malformed]) {
      expect(res.status).to.equal(302);
      expect(res.headers.location).to.not.include('/clubs/');
      expect(res.text).to.not.include('<meta');
    }
  });

  it('still redirects a browser when the collection cannot be loaded', async () => {
    sinon
      .stub(Collection, 'findById')
      .returns({ lean: () => Promise.reject(new Error('db down')) });

    const res = await request(app)
      .get(`/share/collection/${COLLECTION_ID}`)
      .set('User-Agent', BROWSER_UA);

    expect(res.status).to.equal(302);
    expect(res.headers.location).to.not.include('/clubs/');
  });

  it('falls back to the app preview for an unknown collection', async () => {
    const res = await request(app)
      .get('/share/collection/not-an-id')
      .set('User-Agent', FB_UA);

    expect(res.status).to.equal(200);
    expect(meta(res.text, 'property', 'og:title')).to.equal('Motoclub Connect');
  });
});

describe('GET /share/collection/:collectionId/card.png', function () {
  this.timeout(20000);

  beforeEach(() => clearCardCache());
  afterEach(() => sinon.restore());

  it('serves the progress card for a public collection to any client', async () => {
    stubCollection(PUBLIC_COLLECTION);
    sinon.stub(IDCardService, 'fetchImageAsDataUri').resolves(null);

    const res = await request(app).get(
      `/share/collection/${COLLECTION_ID}/card.png?v=anything`
    );

    expect(res.status).to.equal(200);
    expect(res.headers['content-type']).to.equal('image/png');
    expect(res.headers['cache-control']).to.equal('public, max-age=3600');
    expect(res.body.subarray(0, 4).toString('latin1')).to.equal('\x89PNG');
  });

  it('returns 404 for members-only, unknown, deleted and malformed collections', async () => {
    const findById = sinon.stub(Collection, 'findById');
    findById
      .onFirstCall()
      .returns({
        lean: () =>
          Promise.resolve({ ...PUBLIC_COLLECTION, visibility: 'members_only' }),
      });
    findById.onSecondCall().returns({ lean: () => Promise.resolve(null) });
    const render = sinon
      .stub(IDCardService, 'fetchImageAsDataUri')
      .resolves(null);

    const membersOnly = await request(app).get(
      `/share/collection/${COLLECTION_ID}/card.png`
    );
    const unknown = await request(app).get(
      '/share/collection/507f191e810c19729de860ff/card.png'
    );
    const malformed = await request(app).get(
      '/share/collection/not-an-id/card.png'
    );

    for (const res of [membersOnly, unknown, malformed]) {
      expect(res.status).to.equal(404);
      expect(res.body).to.satisfy(
        (body) => !body || body.length === 0 || Object.keys(body).length === 0
      );
    }
    expect(findById.callCount).to.equal(2); // malformed IDs never reach the database
    expect(render.called).to.equal(false);
  });

  it('redirects to the club logo when the card cannot be rendered', async () => {
    stubCollection(PUBLIC_COLLECTION);
    sinon.stub(IDCardService, 'fetchImageAsDataUri').rejects(new Error('boom'));

    const res = await request(app).get(
      `/share/collection/${COLLECTION_ID}/card.png`
    );

    expect(res.status).to.equal(302);
    expect(res.headers.location).to.equal('https://cdn.test/logo.png');
  });

  it('redirects to the app icon when the club cannot be loaded', async () => {
    sinon.stub(Collection, 'findById').returns({
      lean: () =>
        Promise.resolve({ updatedAt: UPDATED_AT, ...PUBLIC_COLLECTION }),
    });
    sinon
      .stub(Club, 'findById')
      .returns({ lean: () => Promise.reject(new Error('db down')) });
    sinon.stub(Payment, 'aggregate').resolves([]);

    const res = await request(app).get(
      `/share/collection/${COLLECTION_ID}/card.png`
    );

    expect(res.status).to.equal(302);
    expect(res.headers.location).to.match(
      /\/assets\/icons\/icon-512x512\.png$/
    );
  });
});
