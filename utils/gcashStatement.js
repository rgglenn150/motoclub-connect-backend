/**
 * Reads a GCash "Transaction History" PDF in memory (spec 004, research R4/R5).
 * Nothing here stores, logs or returns statement text: callers get parsed
 * entries or a StatementError code (FR-003).
 */

import { getDocumentProxy } from 'unpdf';

/** Contract error codes → HTTP status and the message the app shows (contracts §1). */
export const STATEMENT_ERRORS = {
  NOT_PDF: { status: 400, message: 'Please choose a PDF file.' },
  FILE_TOO_LARGE: { status: 413, message: 'This file is larger than 10 MB.' },
  PASSWORD_REQUIRED: {
    status: 422,
    message: 'This PDF is password-protected. Enter its password.',
  },
  PASSWORD_INCORRECT: { status: 422, message: 'Incorrect PDF password.' },
  NO_TRANSACTIONS: {
    status: 422,
    message: "We couldn't find GCash transactions in this file.",
  },
  NO_CREDITS: {
    status: 422,
    message: 'This statement has no incoming transactions.',
  },
  UNRELIABLE: {
    status: 422,
    message: "We couldn't read this statement reliably. Nothing was matched.",
  },
  TIMEOUT: { status: 422, message: 'This statement took too long to read.' },
};

export class StatementError extends Error {
  constructor(code) {
    super(STATEMENT_ERRORS[code]?.message ?? code);
    this.name = 'StatementError';
    this.code = code;
    this.status = STATEMENT_ERRORS[code]?.status ?? 422;
  }
}

const MAX_PAGES = 50;
const DEADLINE_MS = 15_000;

// PDF.js PasswordResponses.INCORRECT_PASSWORD; NEED_PASSWORD is 1 (research R2).
const INCORRECT_PASSWORD = 2;

/** One page's text items → lines, top to bottom, items left to right. */
function pageLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const y = Math.round(item.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, row]) =>
      row
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((item) => item.str.trim())
        .join(' ')
    );
}

/**
 * PDF bytes (+ password) → text lines in printed order. Reader errors are
 * mapped to codes and never rethrown raw, so no statement text can reach a
 * log through an error message (FR-003, red-team F6).
 * @param {Buffer|Uint8Array} buffer
 * @param {string} [password]
 * @param {{ maxPages?: number, deadlineMs?: number, now?: () => number }} [options]
 * @returns {Promise<{ lines: string[], pages: number }>}
 */
export async function readStatementLines(
  buffer,
  password,
  { maxPages = MAX_PAGES, deadlineMs = DEADLINE_MS, now = Date.now } = {}
) {
  const startedAt = now();
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(buffer), {
      password: password || undefined,
      verbosity: 0,
      isEvalSupported: false,
    });
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new StatementError(
        err.code === INCORRECT_PASSWORD && password
          ? 'PASSWORD_INCORRECT'
          : 'PASSWORD_REQUIRED'
      );
    }
    throw new StatementError('NO_TRANSACTIONS');
  }

  try {
    if (doc.numPages > maxPages) throw new StatementError('UNRELIABLE');
    const lines = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      if (now() - startedAt > deadlineMs) throw new StatementError('TIMEOUT');
      const page = await doc.getPage(n);
      const { items } = await page.getTextContent();
      lines.push(...pageLines(items));
    }
    return { lines, pages: doc.numPages };
  } catch (err) {
    if (err instanceof StatementError) throw err;
    throw new StatementError('NO_TRANSACTIONS');
  } finally {
    await doc.destroy().catch(() => {});
  }
}

const PERIOD = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/;
const STARTING = /^STARTING BALANCE ([\d,]+\.\d{2})$/;
const ENDING = /^ENDING BALANCE ([\d,]+\.\d{2})$/;
// Date, anything (a description may share the line), 13-digit reference,
// amount, balance. Wrapped description lines don't match and are skipped.
const ROW =
  /^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) ([AP]M)\b.*?\b(\d{13}) ([\d,]+\.\d{2}) ([\d,]+\.\d{2})$/;

/** '12,345.67' → 1234567 (integer centavos; no float drift). */
function centavos(text) {
  const [pesos, cents] = text.replace(/,/g, '').split('.');
  return Number(pesos) * 100 + Number(cents);
}

/** Printed 12-hour Manila time → ISO with +08:00. */
function manilaIso(date, hour, minute, meridiem) {
  let h = Number(hour) % 12;
  if (meridiem === 'PM') h += 12;
  return `${date}T${String(h).padStart(2, '0')}:${minute}:00+08:00`;
}

/**
 * Text lines (in printed order) → statement. The running balance decides
 * received vs sent and must reconcile from STARTING to ENDING BALANCE, or the
 * statement is refused rather than risk a wrong match (FR-004, FR-015).
 * @param {string[]} lines
 */
export function parseStatementLines(lines) {
  let from;
  let to;
  let startingBalance;
  let endingBalance;
  const rows = [];

  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if (!from && (m = line.match(PERIOD))) {
      [, from, to] = m;
    } else if (startingBalance === undefined && (m = line.match(STARTING))) {
      startingBalance = centavos(m[1]);
    } else if ((m = line.match(ENDING))) {
      endingBalance = centavos(m[1]);
    } else if ((m = line.match(ROW))) {
      const [, date, hour, minute, meridiem, reference, amount, balance] = m;
      rows.push({
        dateTime: manilaIso(date, hour, minute, meridiem),
        date,
        reference,
        amount: centavos(amount),
        balance: centavos(balance),
      });
    }
  }

  if (!from || startingBalance === undefined || rows.length === 0) {
    throw new StatementError('NO_TRANSACTIONS');
  }

  let previous = startingBalance;
  const entries = rows.map((row) => {
    let direction;
    if (row.amount > 0 && previous + row.amount === row.balance) {
      direction = 'received';
    } else if (previous - row.amount === row.balance) {
      direction = 'sent';
    } else {
      throw new StatementError('UNRELIABLE');
    }
    previous = row.balance;
    return { ...row, direction };
  });

  if (endingBalance === undefined || previous !== endingBalance) {
    throw new StatementError('UNRELIABLE');
  }
  if (!entries.some((e) => e.direction === 'received')) {
    throw new StatementError('NO_CREDITS');
  }

  return { from, to, startingBalance, endingBalance, entries };
}
