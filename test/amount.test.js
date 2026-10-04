import { expect } from 'chai';
import { isValidAmount, MAX_AMOUNT } from '../utils/amount.js';

// Spec 006 research R3: one rule for payment amounts and collection targets.
describe('utils/amount isValidAmount', () => {
  for (const ok of [1, 0.5, '12.30', ' 7 ', 10_000_000, '10000000.00']) {
    it(`accepts ${JSON.stringify(ok)}`, () => {
      expect(isValidAmount(ok)).to.equal(true);
    });
  }

  for (const bad of [0, '0.00', -5, '-5', 1.234, '1.234', 10_000_000.01, 'abc', '1e3', '', null, undefined, {}, [5], true]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(isValidAmount(bad)).to.equal(false);
    });
  }

  it('caps amounts at ₱10,000,000', () => {
    expect(MAX_AMOUNT).to.equal(10_000_000);
  });
});
