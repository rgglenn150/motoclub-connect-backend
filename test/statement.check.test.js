import { expect } from 'chai';
import fs from 'node:fs';
import sinon from 'sinon';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../server.js';
import Payment from '../models/PaymentModel.js';
import Collection from '../models/CollectionModel.js';
import Member from '../models/MemberModel.js';

const COLLECTION_ID = '507f191e810c19729de860c1';
const CLUB_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439099';

// Synthetic statement (specs/004-gcash-bulk-verify/fixtures/make_statement.py).
const FIXTURE = fs.readFileSync(new URL('./fixtures/gcash-statement-synthetic.pdf', import.meta.url));
const FIXTURE_PASSWORD = 'test-statement';

// Quickstart payments A–F (all pending; the query only asks for pending).
const PAYMENTS = [
  ['a', '9000000000001', 500, '2026-09-28T10:15:00Z'],
  ['b', '9000000000002', 1000, '2026-09-29T20:30:00Z'],
  ['c', '9000000000003', 50, '2026-09-30T07:45:00Z'],
  ['d', '9000000000004', 300, '2026-10-02T11:20:00Z'],
  ['e', '9000000000005', 200, '2026-10-01T13:05:00Z'],
  ['f', '9000000000099', 750, '2026-10-01T09:00:00Z'],
].map(([id, referenceNumber, amount, date]) => ({
  _id: id,
  name: `Payer ${id.toUpperCase()}`,
  referenceNumber,
  amount,
  transactionDate: new Date(date),
  status: 'pending',
}));

// Spec 004 US1, contracts §1.
describe('POST /api/payment/collection/:collectionId/statement-check', () => {
  let token;
  let logged;
  let writes;

  const url = (id = COLLECTION_ID) => `/api/payment/collection/${id}/statement-check`;

  const post = ({ file = FIXTURE, password, filename = 'statement.pdf', contentType = 'application/pdf' } = {}) => {
    const req = request(app).post(url()).set('Authorization', `Bearer ${token}`);
    if (password !== undefined) req.field('password', password);
    if (file) req.attach('statement', file, { filename, contentType });
    return req;
  };

  function stubCollection(found = true) {
    sinon
      .stub(Collection, 'findById')
      .resolves(found ? { _id: COLLECTION_ID, club: CLUB_ID } : null);
  }

  function stubAdmin(isAdmin = true) {
    return sinon.stub(Member, 'findOne').resolves(isAdmin ? { roles: ['admin'] } : null);
  }

  function stubPayments(payments = PAYMENTS) {
    return sinon.stub(Payment, 'find').returns({
      sort: () => ({ lean: async () => payments }),
    });
  }

  beforeEach(() => {
    token = jwt.sign({ _id: USER_ID }, process.env.JWT_SECRET);
    logged = [];
    for (const level of ['log', 'info', 'warn', 'error']) {
      sinon.stub(console, level).callsFake((...args) => logged.push(args.map(String).join(' ')));
    }
    writes = [
      sinon.stub(Payment, 'findOneAndUpdate'),
      sinon.stub(Payment, 'updateOne'),
      sinon.stub(Payment, 'updateMany'),
      sinon.stub(Payment, 'create'),
      sinon.stub(Payment.prototype, 'save'),
    ];
  });

  afterEach(() => sinon.restore());

  const statementLogLines = () => logged.filter((l) => l.startsWith('statement-check '));

  it('classifies the pending payments and stores nothing (US1 AC1–4, FR-003)', async () => {
    stubCollection();
    stubAdmin();
    const find = stubPayments();

    const res = await post({ password: FIXTURE_PASSWORD });

    expect(res.status).to.equal(200);
    expect(find.firstCall.args[0]).to.deep.equal({ collection: COLLECTION_ID, status: 'pending' });
    expect(res.body.statement).to.deep.equal({
      from: '2026-09-27',
      to: '2026-10-03',
      entryCount: 11,
    });
    expect(res.body.summary).to.deep.equal({
      checked: 6,
      matched: 3,
      mismatched: 2,
      notFound: 1,
      matchedTotal: 1800,
    });
    const byId = Object.fromEntries(res.body.results.map((r) => [r.paymentId, r]));
    expect(byId.a.outcome).to.equal('matched');
    expect(byId.b.outcome).to.equal('matched');
    expect(byId.d.outcome).to.equal('matched');
    expect(byId.d.notes).to.deep.equal([
      { code: 'DATE_DIFFERS', app: '2026-10-02', statement: '2026-10-01' },
    ]);
    expect(byId.c.reasons).to.deep.equal([{ code: 'AMOUNT_DIFFERS', app: 50, statement: 500 }]);
    expect(byId.e.reasons).to.deep.equal([{ code: 'NOT_RECEIVED' }]);
    expect(byId.f.outcome).to.equal('not_found');

    // Unrelated statement entries never leave the server (D8).
    expect(res.text).to.not.include('9100000000002');
    expect(res.text).to.not.include(FIXTURE_PASSWORD);
    for (const write of writes) expect(write.called).to.equal(false);
  });

  it('logs one outcome line with counts and no statement content (red-team F2/F6)', async () => {
    stubCollection();
    stubAdmin();
    stubPayments();

    await post({ password: FIXTURE_PASSWORD });

    expect(statementLogLines()).to.deep.equal([
      `statement-check club=${CLUB_ID} outcome=OK pages=1 entries=11 checked=6 matched=3 mismatched=2 notFound=1`,
    ]);
    const all = logged.join('\n');
    for (const secret of [FIXTURE_PASSWORD, '9000000000001', '9100000000002', 'Transfer from', '12,345.67']) {
      expect(all).to.not.include(secret);
    }
  });

  it('asks for the password when a protected file arrives without one (AC5)', async () => {
    stubCollection();
    stubAdmin();
    stubPayments();

    const res = await post();

    expect(res.status).to.equal(422);
    expect(res.body).to.deep.equal({
      code: 'PASSWORD_REQUIRED',
      message: 'This PDF is password-protected. Enter its password.',
    });
    expect(statementLogLines()).to.deep.equal([
      `statement-check club=${CLUB_ID} outcome=PASSWORD_REQUIRED`,
    ]);
  });

  it('reports a wrong password (AC7, FR-008)', async () => {
    stubCollection();
    stubAdmin();
    stubPayments();

    const res = await post({ password: 'wrong' });

    expect(res.status).to.equal(422);
    expect(res.body).to.deep.equal({ code: 'PASSWORD_INCORRECT', message: 'Incorrect PDF password.' });
    expect(logged.join('\n')).to.not.include('wrong');
  });

  it('requires a token', async () => {
    const res = await request(app).post(url()).attach('statement', FIXTURE, 'statement.pdf');
    expect(res.status).to.equal(401);
  });

  it('forbids members who are not club admins (FR-001)', async () => {
    stubCollection();
    const member = stubAdmin(false);

    const res = await post({ password: FIXTURE_PASSWORD });

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal('NOT_CLUB_ADMIN');
    expect(member.firstCall.args[0]).to.deep.equal({ club: CLUB_ID, user: USER_ID, roles: 'admin' });
  });

  it('does not let a platform admin skip the club check (constitution VI)', async () => {
    token = jwt.sign({ _id: USER_ID, role: 'admin' }, process.env.JWT_SECRET);
    stubCollection();
    stubAdmin(false);

    const res = await post({ password: FIXTURE_PASSWORD });

    expect(res.status).to.equal(403);
  });

  it('returns 404 for an unknown or malformed collection', async () => {
    stubCollection(false);
    const unknown = await post({ password: FIXTURE_PASSWORD });
    expect(unknown.status).to.equal(404);
    expect(unknown.body.code).to.equal('COLLECTION_NOT_FOUND');

    const malformed = await request(app)
      .post(url('not-an-id'))
      .set('Authorization', `Bearer ${token}`)
      .attach('statement', FIXTURE, 'statement.pdf');
    expect(malformed.status).to.equal(404);
  });

  describe('file guard (FR-013)', () => {
    beforeEach(() => {
      stubCollection();
      stubAdmin();
      stubPayments();
    });

    it('refuses a missing file', async () => {
      const res = await post({ file: null });
      expect(res.status).to.equal(400);
      expect(res.body).to.deep.equal({ code: 'NOT_PDF', message: 'Please choose a PDF file.' });
    });

    it('refuses a non-PDF type', async () => {
      const res = await post({ file: Buffer.from('hello'), filename: 'a.txt', contentType: 'text/plain' });
      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal('NOT_PDF');
    });

    it('refuses a "PDF" that does not start with %PDF-', async () => {
      const res = await post({ file: Buffer.from('<html>not a pdf</html>') });
      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal('NOT_PDF');
    });

    it('refuses files over 10 MB', async () => {
      const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)]);
      const res = await post({ file: big });
      expect(res.status).to.equal(413);
      expect(res.body).to.deep.equal({ code: 'FILE_TOO_LARGE', message: 'This file is larger than 10 MB.' });
    });
  });
});
