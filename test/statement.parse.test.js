import { expect } from 'chai';
import fs from 'node:fs';
import {
  parseStatementLines,
  readStatementLines,
  StatementError,
} from '../utils/gcashStatement.js';

// Spec 004, research R4/R5: GCash statement text lines → transactions.
// The running balance decides received vs sent and proves the read.
const HEADER = [
  'GCash Transaction History',
  '2026-09-27 to 2026-10-03',
  'Date and Time Description Reference No. Debit Credit Balance',
];

function statement(rows, { start = '10000.00', end } = {}) {
  return [
    ...HEADER,
    `STARTING BALANCE ${start}`,
    ...rows,
    ...(end === null ? [] : [`ENDING BALANCE ${end}`]),
    'Total Debit 0.00',
    'Total Credit 0.00',
  ];
}

function expectCode(fn, code) {
  try {
    fn();
  } catch (err) {
    expect(err).to.be.instanceOf(StatementError);
    expect(err.code).to.equal(code);
    return;
  }
  expect.fail(`expected StatementError ${code}`);
}

describe('utils/gcashStatement parseStatementLines', () => {
  it('reads the period, balances and every transaction row', () => {
    const parsed = parseStatementLines(
      statement(
        [
          '2026-09-27 09:00 AM Payment to Sample Store 9100000000001 150.00 9850.00',
          '2026-09-28 10:15 PM Transfer from 09170000001 to 09170000000 9000000000001 500.00 10,350.00',
        ],
        { end: '10,350.00' }
      )
    );

    expect(parsed.from).to.equal('2026-09-27');
    expect(parsed.to).to.equal('2026-10-03');
    expect(parsed.startingBalance).to.equal(1000000);
    expect(parsed.endingBalance).to.equal(1035000);
    expect(parsed.entries).to.deep.equal([
      {
        dateTime: '2026-09-27T09:00:00+08:00',
        date: '2026-09-27',
        reference: '9100000000001',
        amount: 15000,
        balance: 985000,
        direction: 'sent',
      },
      {
        dateTime: '2026-09-28T22:15:00+08:00',
        date: '2026-09-28',
        reference: '9000000000001',
        amount: 50000,
        balance: 1035000,
        direction: 'received',
      },
    ]);
  });

  it('skips wrapped description lines above and below a row', () => {
    const parsed = parseStatementLines(
      statement(
        [
          'Received GCash from Sample Bank, Inc. with account ending in 0000 and',
          '2026-10-01 11:20 AM 9000000000004 12,345.67 22,345.67',
          'invno:SAMPLE0000000000000000000001',
        ],
        { end: '22,345.67' }
      )
    );

    expect(parsed.entries).to.have.length(1);
    expect(parsed.entries[0]).to.include({
      reference: '9000000000004',
      amount: 1234567,
      direction: 'received',
    });
  });

  it('reads 12 AM and 12 PM correctly', () => {
    const parsed = parseStatementLines(
      statement(
        [
          '2026-10-01 12:05 AM Transfer 9000000000001 1.00 10001.00',
          '2026-10-01 12:30 PM Transfer 9000000000002 1.00 10002.00',
        ],
        { end: '10002.00' }
      )
    );

    expect(parsed.entries.map((e) => e.dateTime)).to.deep.equal([
      '2026-10-01T00:05:00+08:00',
      '2026-10-01T12:30:00+08:00',
    ]);
  });

  it('treats a 0.00 row as sent so it can never match', () => {
    const parsed = parseStatementLines(
      statement(
        [
          '2026-10-01 09:00 AM Fee 9100000000001 0.00 10000.00',
          '2026-10-01 10:00 AM Transfer 9000000000001 5.00 10005.00',
        ],
        { end: '10005.00' }
      )
    );

    expect(parsed.entries[0].direction).to.equal('sent');
  });

  it('refuses NO_TRANSACTIONS without a period line', () => {
    const lines = statement(['2026-10-01 10:00 AM Transfer 9000000000001 5.00 10005.00'], {
      end: '10005.00',
    }).filter((l) => !l.includes(' to 2026'));
    expectCode(() => parseStatementLines(lines), 'NO_TRANSACTIONS');
  });

  it('refuses NO_TRANSACTIONS without a starting balance', () => {
    const lines = statement(['2026-10-01 10:00 AM Transfer 9000000000001 5.00 10005.00'], {
      end: '10005.00',
    }).filter((l) => !l.startsWith('STARTING'));
    expectCode(() => parseStatementLines(lines), 'NO_TRANSACTIONS');
  });

  it('refuses NO_TRANSACTIONS when no row is found', () => {
    expectCode(() => parseStatementLines(statement([], { end: '10000.00' })), 'NO_TRANSACTIONS');
    expectCode(() => parseStatementLines(['%PDF garbage', 'nothing here']), 'NO_TRANSACTIONS');
  });

  it('refuses NO_CREDITS when every row is money sent', () => {
    expectCode(
      () =>
        parseStatementLines(
          statement(['2026-10-01 09:00 AM Payment 9100000000001 150.00 9850.00'], {
            end: '9850.00',
          })
        ),
      'NO_CREDITS'
    );
  });

  it('refuses UNRELIABLE when a balance does not follow from the previous one', () => {
    expectCode(
      () =>
        parseStatementLines(
          statement(
            [
              '2026-10-01 09:00 AM Transfer 9000000000001 500.00 10500.00',
              // A skipped row would leave this gap: 10500 ± 100 ≠ 10900.
              '2026-10-01 10:00 AM Transfer 9000000000002 100.00 10900.00',
            ],
            { end: '10900.00' }
          )
        ),
      'UNRELIABLE'
    );
  });

  it('refuses UNRELIABLE when the last balance is not the ending balance', () => {
    expectCode(
      () =>
        parseStatementLines(
          statement(['2026-10-01 09:00 AM Transfer 9000000000001 500.00 10500.00'], {
            end: '10600.00',
          })
        ),
      'UNRELIABLE'
    );
  });

  it('refuses UNRELIABLE when the ending balance is missing', () => {
    expectCode(
      () =>
        parseStatementLines(
          statement(['2026-10-01 09:00 AM Transfer 9000000000001 500.00 10500.00'], { end: null })
        ),
      'UNRELIABLE'
    );
  });

  it('parses a 1,000-entry statement well under 10 seconds (SC-004)', () => {
    const rows = [];
    let balance = 1000000;
    for (let i = 0; i < 1000; i += 1) {
      const amount = 100 + i;
      balance += i % 2 ? amount : -amount;
      const ref = String(9000000000000 + i);
      rows.push(
        `2026-10-01 09:00 AM Row ${i} ${ref} ${(amount / 100).toFixed(2)} ${(balance / 100).toFixed(2)}`
      );
    }
    const started = Date.now();
    const parsed = parseStatementLines(statement(rows, { end: (balance / 100).toFixed(2) }));
    expect(parsed.entries).to.have.length(1000);
    expect(Date.now() - started).to.be.below(10000);
  });
});

// Synthetic fixtures from specs/004-gcash-bulk-verify/fixtures/make_statement.py
// (made-up data, constitution V).
const FIXTURE = fs.readFileSync(new URL('./fixtures/gcash-statement-synthetic.pdf', import.meta.url));
const FIXTURE_OPEN = fs.readFileSync(
  new URL('./fixtures/gcash-statement-synthetic-open.pdf', import.meta.url)
);
const FIXTURE_PASSWORD = 'test-statement';

async function expectReadCode(promise, code) {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(StatementError);
    expect(err.code).to.equal(code);
    return;
  }
  expect.fail(`expected StatementError ${code}`);
}

describe('utils/gcashStatement readStatementLines', () => {
  it('asks for a password when a protected file arrives without one', async () => {
    await expectReadCode(readStatementLines(FIXTURE), 'PASSWORD_REQUIRED');
  });

  it('reports a wrong password distinctly', async () => {
    await expectReadCode(readStatementLines(FIXTURE, 'wrong'), 'PASSWORD_INCORRECT');
  });

  it('reads the protected fixture into lines the parser accepts', async () => {
    const { lines, pages } = await readStatementLines(FIXTURE, FIXTURE_PASSWORD);
    const parsed = parseStatementLines(lines);

    expect(pages).to.equal(1);
    expect(parsed.from).to.equal('2026-09-27');
    expect(parsed.to).to.equal('2026-10-03');
    expect(parsed.entries).to.have.length(11);
    expect(parsed.entries.filter((e) => e.direction === 'received')).to.have.length(7);
    // Wrapped description, comma amount.
    expect(parsed.entries.find((e) => e.reference === '9100000000002')).to.include({
      amount: 1234567,
      direction: 'received',
      dateTime: '2026-10-01T15:30:00+08:00',
    });
    expect(parsed.entries.find((e) => e.reference === '9000000000005').direction).to.equal(
      'sent'
    );
  });

  it('reads an unprotected statement without a password, and ignores one if sent', async () => {
    const plain = await readStatementLines(FIXTURE_OPEN);
    const withPassword = await readStatementLines(FIXTURE_OPEN, 'anything');
    expect(parseStatementLines(plain.lines).entries).to.have.length(11);
    expect(withPassword.lines).to.deep.equal(plain.lines);
  });

  it('refuses bytes that are not a readable PDF as NO_TRANSACTIONS', async () => {
    await expectReadCode(
      readStatementLines(Buffer.from('%PDF-1.4 not really a pdf')),
      'NO_TRANSACTIONS'
    );
  });

  it('refuses statements over the page cap as UNRELIABLE', async () => {
    await expectReadCode(
      readStatementLines(FIXTURE, FIXTURE_PASSWORD, { maxPages: 0 }),
      'UNRELIABLE'
    );
  });

  it('stops with TIMEOUT once the deadline passes', async () => {
    let calls = 0;
    // Start at 0, then jump past the 15 s deadline.
    const now = () => (calls++ === 0 ? 0 : 20000);
    await expectReadCode(readStatementLines(FIXTURE, FIXTURE_PASSWORD, { now }), 'TIMEOUT');
  });
});
