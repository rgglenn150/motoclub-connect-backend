import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import { app } from '../server.js';
import Collection from '../models/CollectionModel.js';
import Club from '../models/ClubModel.js';
import Payment from '../models/PaymentModel.js';

const FB_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const CLUB_ID = '507f1f77bcf86cd799439011';
const COLLECTION_ID = '507f191e810c19729de860ea';

// The share page only reads from Mongo, so stubbing the model calls keeps this
// suite free of a database connection.
function stubCollection(doc) {
  sinon.stub(Collection, 'findById').returns({ lean: () => Promise.resolve(doc) });
  sinon.stub(Club, 'findById').returns({
    lean: () => Promise.resolve({ _id: CLUB_ID, clubName: 'Iron Riders', logoUrl: 'https://cdn.test/logo.png' }),
  });
  sinon.stub(Payment, 'aggregate').resolves([{ _id: null, total: 4500 }]);
}

describe('GET /share/collection/:collectionId', () => {
  afterEach(() => sinon.restore());

  it('renders Open Graph tags for a public collection when a crawler asks', async () => {
    stubCollection({
      _id: COLLECTION_ID,
      club: CLUB_ID,
      name: 'Ride for Relief',
      description: 'Fuel and supplies for the typhoon run.',
      targetAmount: 10000,
      visibility: 'public',
    });

    const res = await request(app).get(`/share/collection/${COLLECTION_ID}`).set('User-Agent', FB_UA);

    expect(res.status).to.equal(200);
    expect(res.headers['content-type']).to.match(/text\/html/);
    expect(res.text).to.include('<meta property="og:title" content="Ride for Relief · Iron Riders"/>');
    expect(res.text).to.include('Fuel and supplies for the typhoon run.');
    expect(res.text).to.include('₱4,500 of ₱10,000 collected.');
    expect(res.text).to.include('<meta property="og:image" content="https://cdn.test/logo.png"/>');
    expect(res.text).to.include(`/clubs/${CLUB_ID}/collection/${COLLECTION_ID}`);
  });

  it('escapes markup in the collection name and description', async () => {
    stubCollection({
      _id: COLLECTION_ID,
      club: CLUB_ID,
      name: 'Ride "2025" <script>',
      description: 'Bring & share',
      visibility: 'public',
    });

    const res = await request(app).get(`/share/collection/${COLLECTION_ID}`).set('User-Agent', FB_UA);

    expect(res.text).to.not.include('<script>alert');
    expect(res.text).to.include('Ride &quot;2025&quot; &lt;script&gt;');
    expect(res.text).to.include('Bring &amp; share');
  });

  it('keeps a members-only collection generic', async () => {
    stubCollection({
      _id: COLLECTION_ID,
      club: CLUB_ID,
      name: 'Secret dues',
      description: 'internal',
      visibility: 'members_only',
    });

    const res = await request(app).get(`/share/collection/${COLLECTION_ID}`).set('User-Agent', FB_UA);

    expect(res.status).to.equal(200);
    expect(res.text).to.not.include('Secret dues');
    expect(res.text).to.include('<meta property="og:title" content="Motoclub Connect"/>');
    // Still deep-links, so a member who opens it lands on the collection.
    expect(res.text).to.include(`/clubs/${CLUB_ID}/collection/${COLLECTION_ID}`);
  });

  it('redirects a real browser to the app page', async () => {
    stubCollection({ _id: COLLECTION_ID, club: CLUB_ID, name: 'Ride for Relief', visibility: 'public' });

    const res = await request(app).get(`/share/collection/${COLLECTION_ID}`).set('User-Agent', BROWSER_UA);

    expect(res.status).to.equal(302);
    expect(res.headers.location).to.match(new RegExp(`/clubs/${CLUB_ID}/collection/${COLLECTION_ID}$`));
  });

  it('falls back to the app preview for an unknown collection', async () => {
    const res = await request(app).get('/share/collection/not-an-id').set('User-Agent', FB_UA);

    expect(res.status).to.equal(200);
    expect(res.text).to.include('<meta property="og:title" content="Motoclub Connect"/>');
  });
});
