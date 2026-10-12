import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import { app } from '../server.js';
import { RECEIPT_ERRORS } from '../utils/receiptErrors.js';

// Spec 008 Story 3: every receipt failure names its cause (contracts/README.md).
describe('POST /api/payment/extract-receipt', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const savedKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    sinon.restore();
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  const upload = (
    buffer = JPEG,
    filename = 'receipt.jpg',
    contentType = 'image/jpeg'
  ) =>
    request(app)
      .post('/api/payment/extract-receipt')
      .attach('receipt', buffer, { filename, contentType });

  const modelReply = (content) =>
    sinon.stub(globalThis, 'fetch').resolves(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

  const upstreamStatus = (status) =>
    sinon
      .stub(globalThis, 'fetch')
      .resolves(new Response(JSON.stringify({ error: 'x' }), { status }));

  const expectCode = (res, code) => {
    expect(res.status).to.equal(RECEIPT_ERRORS[code].status);
    expect(res.body).to.deep.equal({
      code,
      message: RECEIPT_ERRORS[code].message,
    });
  };

  it('returns the fields of a partial read', async () => {
    modelReply(
      '```json\n{"name":"Juan","amount":"₱1,500.00","referenceNumber":null,"phoneNumber":null,"transactionDateTime":null}\n```'
    );

    const res = await upload();

    expect(res.status).to.equal(200);
    expect(res.body.name).to.equal('Juan');
    expect(res.body.amount).to.equal(1500);
    expect(res.body.referenceNumber).to.equal(null);
  });

  it('answers FILE_TOO_LARGE for a file over 10 MB', async () => {
    const fetch = sinon.stub(globalThis, 'fetch');

    const res = await upload(Buffer.alloc(10 * 1024 * 1024 + 1));

    expectCode(res, 'FILE_TOO_LARGE');
    expect(fetch.called).to.equal(false);
  });

  it('answers UNSUPPORTED_FORMAT for a file that is not an image', async () => {
    const fetch = sinon.stub(globalThis, 'fetch');

    const res = await upload(
      Buffer.from('%PDF-1.4'),
      'receipt.pdf',
      'application/pdf'
    );

    expectCode(res, 'UNSUPPORTED_FORMAT');
    expect(fetch.called).to.equal(false);
  });

  it('answers a plain 400 for a malformed upload, not UNSUPPORTED_FORMAT', async () => {
    const fetch = sinon.stub(globalThis, 'fetch');

    const res = await request(app)
      .post('/api/payment/extract-receipt')
      .attach('photo', JPEG, {
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).to.equal(400);
    expect(res.body.code).to.equal(undefined);
    expect(res.body.message).to.be.a('string');
    expect(fetch.called).to.equal(false);
  });

  it('answers UNSUPPORTED_FORMAT for an image type the reader does not take', async () => {
    const fetch = sinon.stub(globalThis, 'fetch');

    const res = await upload(JPEG, 'receipt.heic', 'image/heic');

    expectCode(res, 'UNSUPPORTED_FORMAT');
    expect(fetch.called).to.equal(false);
  });

  it('answers UNSUPPORTED_FORMAT when the reader rejects the image (400)', async () => {
    upstreamStatus(400);
    expectCode(await upload(), 'UNSUPPORTED_FORMAT');
  });

  it('answers READER_UNAVAILABLE without an API key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetch = sinon.stub(globalThis, 'fetch');

    expectCode(await upload(), 'READER_UNAVAILABLE');
    expect(fetch.called).to.equal(false);
  });

  for (const status of [401, 404, 429, 500, 503]) {
    it(`answers READER_UNAVAILABLE when the reader answers ${status}`, async () => {
      upstreamStatus(status);
      expectCode(await upload(), 'READER_UNAVAILABLE');
    });
  }

  it('answers READER_UNAVAILABLE when the reader cannot be reached', async () => {
    sinon.stub(globalThis, 'fetch').rejects(new TypeError('fetch failed'));
    expectCode(await upload(), 'READER_UNAVAILABLE');
  });

  it('answers UNREADABLE when every field is null', async () => {
    modelReply(
      '{"name":null,"amount":null,"referenceNumber":null,"phoneNumber":null,"transactionDateTime":null}'
    );
    expectCode(await upload(), 'UNREADABLE');
  });

  it('answers UNREADABLE when the reply is not JSON', async () => {
    modelReply('Sorry, I cannot see a receipt in this image.');
    expectCode(await upload(), 'UNREADABLE');
  });
});
