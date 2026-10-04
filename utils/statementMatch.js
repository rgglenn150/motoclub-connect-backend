/**
 * Classifies a collection's pending payments against GCash statement entries
 * (spec 004 D2/D3/D8, research R6/R7). Pure: no DB, no I/O.
 *
 * Reference + amount decide a match; the date only adds a note. Statement
 * entries no payment references are never returned.
 */

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Uppercase, letters and digits only: "9000 000-000 001" → "9000000000001". */
export function normalizeReference(reference) {
  return String(reference ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const toCentavos = (pesos) => Math.round(Number(pesos) * 100);

/**
 * The app stores a typed datetime-local as if it were UTC, so the UTC date is
 * what the member typed; a server-set date is a real instant whose Manila
 * date is the real one. Either agreeing counts as the same day (research R6).
 */
function paymentDays(date) {
  const time = new Date(date).getTime();
  const utc = new Date(time).toISOString().slice(0, 10);
  const manila = new Date(time + MANILA_OFFSET_MS).toISOString().slice(0, 10);
  return { utc, manila };
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const k = key(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}

/**
 * @param {object[]} payments Payment docs or plain objects (any status)
 * @param {object[]} entries From parseStatementLines (amounts in centavos)
 */
export function matchPayments(payments, entries) {
  const pending = payments.filter((p) => p.status === 'pending');
  const paymentsByRef = groupBy(pending, (p) => normalizeReference(p.referenceNumber));
  const entriesByRef = groupBy(entries, (e) => normalizeReference(e.reference));

  const results = pending.map((p) => {
    const ref = normalizeReference(p.referenceNumber);
    const found = entriesByRef.get(ref) ?? [];
    const reasons = [];
    let entry = null;

    if (paymentsByRef.get(ref).length > 1) {
      reasons.push({ code: 'DUPLICATE_REFERENCE' });
    } else if (found.length > 1) {
      reasons.push({ code: 'DUPLICATE_IN_STATEMENT' });
    } else if (found.length === 1) {
      [entry] = found;
      if (entry.direction !== 'received') {
        reasons.push({ code: 'NOT_RECEIVED' });
      } else if (toCentavos(p.amount) !== entry.amount) {
        reasons.push({
          code: 'AMOUNT_DIFFERS',
          app: Number(p.amount),
          statement: entry.amount / 100,
        });
      }
    }

    let outcome = 'not_found';
    if (reasons.length) outcome = 'mismatch';
    else if (entry) outcome = 'matched';

    const notes = [];
    if (outcome === 'matched') {
      if (!p.transactionDate) {
        notes.push({ code: 'NO_DATE' });
      } else {
        const { utc, manila } = paymentDays(p.transactionDate);
        if (entry.date !== utc && entry.date !== manila) {
          notes.push({ code: 'DATE_DIFFERS', app: utc, statement: entry.date });
        }
      }
    }

    return {
      paymentId: String(p._id),
      name: p.name,
      amount: Number(p.amount),
      referenceNumber: p.referenceNumber,
      ...(p.transactionDate && {
        transactionDate: new Date(p.transactionDate).toISOString(),
      }),
      outcome,
      reasons,
      notes,
      statementEntry: entry
        ? {
            dateTime: entry.dateTime,
            amount: entry.amount / 100,
            direction: entry.direction,
          }
        : null,
    };
  });

  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  const matchedCentavos = results
    .filter((r) => r.outcome === 'matched')
    .reduce((sum, r) => sum + toCentavos(r.amount), 0);

  return {
    summary: {
      checked: results.length,
      matched: count('matched'),
      mismatched: count('mismatch'),
      notFound: count('not_found'),
      matchedTotal: matchedCentavos / 100,
    },
    results,
  };
}
