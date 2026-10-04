/**
 * The one rule for peso amounts people enter: payment amounts (spec 001) and
 * collection targets (spec 006). Positive, at most two decimals, at most
 * ₱10,000,000. Strings from multipart forms are accepted.
 */
export const MAX_AMOUNT = 10_000_000;

export function isValidAmount(amount) {
  if (typeof amount !== 'number' && typeof amount !== 'string') return false;
  const text = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return false;
  const value = Number(text);
  return value > 0 && value <= MAX_AMOUNT;
}
