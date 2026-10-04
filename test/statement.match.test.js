import { expect } from 'chai';
import { matchPayments } from '../utils/statementMatch.js';

// Spec 004 D2/D3/D8, research R6/R7: classify pending payments against
// statement entries. Reference + amount decide; dates only add notes.
function entry(reference, amount, { date = '2026-10-01', direction = 'received' } = {}) {
  return {
    dateTime: `${date}T10:00:00+08:00`,
    date,
    reference,
    amount,
    balance: 0,
    direction,
  };
}

let nextId = 1;
function payment(referenceNumber, amount, extra = {}) {
  return {
    _id: `p${nextId++}`,
    name: 'Rider',
    referenceNumber,
    amount,
    status: 'pending',
    transactionDate: new Date('2026-10-01T10:00:00Z'),
    ...extra,
  };
}

const resultFor = (out, p) => out.results.find((r) => r.paymentId === p._id);

describe('utils/statementMatch matchPayments', () => {
  it('matches on reference and amount, returning the compared entry', () => {
    const p = payment('9000000000001', 500);
    const out = matchPayments([p], [entry('9000000000001', 50000)]);

    expect(resultFor(out, p)).to.deep.equal({
      paymentId: p._id,
      name: 'Rider',
      amount: 500,
      referenceNumber: '9000000000001',
      transactionDate: '2026-10-01T10:00:00.000Z',
      outcome: 'matched',
      reasons: [],
      notes: [],
      statementEntry: {
        dateTime: '2026-10-01T10:00:00+08:00',
        amount: 500,
        direction: 'received',
      },
    });
  });

  it('ignores case, spaces and dashes in references', () => {
    const p = payment('9000 000-000 001', 500);
    const q = payment('ab12', 1);
    const out = matchPayments([p, q], [entry('9000000000001', 50000), entry('AB-12', 100)]);
    expect(resultFor(out, p).outcome).to.equal('matched');
    expect(resultFor(out, q).outcome).to.equal('matched');
  });

  it('compares amounts to the centavo', () => {
    const p = payment('9000000000001', 0.1 + 0.2); // float noise still equals ₱0.30
    const out = matchPayments([p], [entry('9000000000001', 30)]);
    expect(resultFor(out, p).outcome).to.equal('matched');
  });

  it('flags AMOUNT_DIFFERS with both amounts', () => {
    const p = payment('9000000000003', 50);
    const out = matchPayments([p], [entry('9000000000003', 50000)]);
    expect(resultFor(out, p)).to.include({ outcome: 'mismatch' });
    expect(resultFor(out, p).reasons).to.deep.equal([
      { code: 'AMOUNT_DIFFERS', app: 50, statement: 500 },
    ]);
  });

  it('flags NOT_RECEIVED when the statement shows the money as sent', () => {
    const p = payment('9000000000005', 200);
    const out = matchPayments([p], [entry('9000000000005', 20000, { direction: 'sent' })]);
    expect(resultFor(out, p).outcome).to.equal('mismatch');
    expect(resultFor(out, p).reasons).to.deep.equal([{ code: 'NOT_RECEIVED' }]);
    expect(resultFor(out, p).statementEntry.direction).to.equal('sent');
  });

  it('flags DUPLICATE_REFERENCE when two pending payments share a reference', () => {
    const p = payment('9000000000001', 500);
    const q = payment('9000-000-000-001', 500);
    const out = matchPayments([p, q], [entry('9000000000001', 50000)]);
    for (const x of [p, q]) {
      expect(resultFor(out, x).outcome).to.equal('mismatch');
      expect(resultFor(out, x).reasons).to.deep.equal([{ code: 'DUPLICATE_REFERENCE' }]);
      expect(resultFor(out, x).statementEntry).to.equal(null);
    }
  });

  it('flags DUPLICATE_IN_STATEMENT when the reference appears twice in the statement', () => {
    const p = payment('9000000000007', 100);
    const out = matchPayments(
      [p],
      [entry('9000000000007', 10000), entry('9000000000007', 10000)]
    );
    expect(resultFor(out, p).outcome).to.equal('mismatch');
    expect(resultFor(out, p).reasons).to.deep.equal([{ code: 'DUPLICATE_IN_STATEMENT' }]);
    expect(resultFor(out, p).statementEntry).to.equal(null);
  });

  it('reports not_found when the reference is absent', () => {
    const p = payment('9000000000099', 750);
    const out = matchPayments([p], [entry('9000000000001', 50000)]);
    expect(resultFor(out, p)).to.include({ outcome: 'not_found', statementEntry: null });
    expect(resultFor(out, p).reasons).to.deep.equal([]);
  });

  it('keeps a match with a different day, adding the DATE_DIFFERS note', () => {
    const p = payment('9000000000004', 300, {
      transactionDate: new Date('2026-10-02T09:00:00Z'),
    });
    const out = matchPayments([p], [entry('9000000000004', 30000, { date: '2026-10-01' })]);
    expect(resultFor(out, p).outcome).to.equal('matched');
    expect(resultFor(out, p).notes).to.deep.equal([
      { code: 'DATE_DIFFERS', app: '2026-10-02', statement: '2026-10-01' },
    ]);
  });

  it('reads stored dates both as typed (UTC) and as Manila time (research R6)', () => {
    // Typed "2026-10-01 23:55" stored as UTC by the server: Manila reads Oct 2.
    const typed = payment('9000000000001', 1, { transactionDate: new Date('2026-10-01T23:55:00Z') });
    // A true instant, 2026-10-02 07:30 Manila, is 2026-10-01 in UTC.
    const instant = payment('9000000000002', 1, {
      transactionDate: new Date('2026-10-01T23:30:00Z'),
    });
    const out = matchPayments(
      [typed, instant],
      [
        entry('9000000000001', 100, { date: '2026-10-01' }),
        entry('9000000000002', 100, { date: '2026-10-02' }),
      ]
    );
    expect(resultFor(out, typed).notes).to.deep.equal([]);
    expect(resultFor(out, instant).notes).to.deep.equal([]);
  });

  it('adds NO_DATE to a match when the payment has no date', () => {
    const p = payment('9000000000001', 500, { transactionDate: undefined });
    const out = matchPayments([p], [entry('9000000000001', 50000)]);
    expect(resultFor(out, p).outcome).to.equal('matched');
    expect(resultFor(out, p).notes).to.deep.equal([{ code: 'NO_DATE' }]);
    expect(resultFor(out, p)).to.not.have.property('transactionDate');
  });

  it('puts no notes on mismatches', () => {
    const p = payment('9000000000003', 50, { transactionDate: undefined });
    const out = matchPayments([p], [entry('9000000000003', 50000)]);
    expect(resultFor(out, p).notes).to.deep.equal([]);
  });

  it('only checks pending payments', () => {
    const verified = payment('9000000000001', 500, { status: 'confirmed' });
    const rejected = payment('9000000000002', 500, { status: 'rejected' });
    const out = matchPayments([verified, rejected], [entry('9000000000001', 50000)]);
    expect(out.results).to.deep.equal([]);
    expect(out.summary.checked).to.equal(0);
  });

  it('never returns statement entries that no payment references (D8)', () => {
    const p = payment('9000000000001', 500);
    const out = matchPayments(
      [p],
      [entry('9100000000001', 15000, { direction: 'sent' }), entry('9000000000001', 50000), entry('9100000000002', 99999)]
    );
    expect(out.results).to.have.length(1);
    expect(JSON.stringify(out)).to.not.include('9100000000001');
    expect(JSON.stringify(out)).to.not.include('9100000000002');
  });

  it('summarizes counts and the matched total', () => {
    const a = payment('9000000000001', 500);
    const b = payment('9000000000002', 1000.25);
    const c = payment('9000000000003', 50);
    const f = payment('9000000000099', 750);
    const out = matchPayments(
      [a, b, c, f],
      [entry('9000000000001', 50000), entry('9000000000002', 100025), entry('9000000000003', 50000)]
    );
    expect(out.summary).to.deep.equal({
      checked: 4,
      matched: 2,
      mismatched: 1,
      notFound: 1,
      matchedTotal: 1500.25,
    });
  });
});
