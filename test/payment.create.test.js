import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import { app } from '../server.js';
import Collection from '../models/CollectionModel.js';
import Payment from '../models/PaymentModel.js';
import cloudinary from '../utils/cloudinary.js';

const COLLECTION_ID = '507f191e810c19729de860ea';
const CLUB_ID = '507f1f77bcf86cd799439011';

// Spec 001, FR-020: pending amounts are shown publicly for public collections,
// so anonymous submissions must carry a sane amount (contracts/payment.md).
describe('POST /api/payment/create amount validation', () => {
  afterEach(() => sinon.restore());

  const submit = (amount) =>
    request(app)
      .post('/api/payment/create')
      .send({
        collection: COLLECTION_ID,
        name: 'Demo Payer',
        referenceNumber: `R-${Math.random()}`,
        ...(amount !== undefined && { amount }),
      });

  for (const amount of [
    'abc',
    0,
    -500,
    '-1',
    10000000.01,
    20000000,
    '1.234',
    '1e3',
    '',
    null,
  ]) {
    it(`rejects ${JSON.stringify(amount)}`, async () => {
      const find = sinon.stub(Collection, 'findById');
      const save = sinon.stub(Payment.prototype, 'save');

      const res = await submit(amount);

      expect(res.status).to.equal(400);
      expect(find.called).to.equal(false);
      expect(save.called).to.equal(false);
    });
  }

  for (const amount of [1500, '1500', 1234.56, '0.5', 10000000]) {
    it(`accepts ${JSON.stringify(amount)}`, async () => {
      sinon
        .stub(Collection, 'findById')
        .resolves({ _id: COLLECTION_ID, club: CLUB_ID, visibility: 'public' });
      sinon.stub(Payment, 'findOne').resolves(null);
      sinon.stub(Payment.prototype, 'save').resolves();

      const res = await submit(amount);

      expect(res.status).to.equal(201);
      expect(res.body.payment.amount).to.equal(Number(amount));
      expect(res.body.payment.status).to.equal('pending');
    });
  }
});

// Spec 008 FR-006: an oversized or non-image receipt gets a coded error, never
// the global handler's bare { error } (contracts/README.md).
describe('POST /api/payment/create receipt upload', () => {
  afterEach(() => sinon.restore());

  const submit = (buffer, filename, contentType) =>
    request(app)
      .post('/api/payment/create')
      .field('collection', COLLECTION_ID)
      .field('name', 'Demo Payer')
      .field('amount', '500')
      .field('referenceNumber', `R-${Math.random()}`)
      .attach('receipt', buffer, { filename, contentType });

  it('answers FILE_TOO_LARGE for a receipt over 10 MB', async () => {
    const find = sinon.stub(Collection, 'findById');

    const res = await submit(
      Buffer.alloc(10 * 1024 * 1024 + 1),
      'receipt.jpg',
      'image/jpeg'
    );

    expect(res.status).to.equal(413);
    expect(res.body.code).to.equal('FILE_TOO_LARGE');
    expect(res.body.message).to.be.a('string');
    expect(find.called).to.equal(false);
  });

  it('answers UNSUPPORTED_FORMAT for a receipt that is not an image', async () => {
    const find = sinon.stub(Collection, 'findById');

    const res = await submit(
      Buffer.from('%PDF-1.4'),
      'receipt.pdf',
      'application/pdf'
    );

    expect(res.status).to.equal(415);
    expect(res.body.code).to.equal('UNSUPPORTED_FORMAT');
    expect(find.called).to.equal(false);
  });

  it('still stores an image receipt', async () => {
    sinon
      .stub(Collection, 'findById')
      .resolves({ _id: COLLECTION_ID, club: CLUB_ID, visibility: 'public' });
    sinon.stub(Payment, 'findOne').resolves(null);
    sinon.stub(Payment.prototype, 'save').resolves();
    const upload = sinon
      .stub(cloudinary.uploader, 'upload')
      .resolves({
        secure_url: 'https://res.cloudinary.com/demo/r.jpg',
        public_id: 'payments/r',
      });

    const res = await submit(
      Buffer.from([0xff, 0xd8, 0xff]),
      'receipt.jpg',
      'image/jpeg'
    );

    expect(res.status).to.equal(201);
    expect(upload.calledOnce).to.equal(true);
    expect(upload.firstCall.args[0]).to.match(/^data:image\/jpeg;base64,/);
  });
});
