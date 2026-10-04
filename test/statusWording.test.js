import { expect } from 'chai';
import {
  formatProgressText,
  STATUS_LABEL,
} from '../utils/collectionProgress.js';
import { buildCardSvg } from '../utils/shareCard.js';

// Spec 003 SC-001 / red-team F4, as amended by spec 006 D6: people see
// "verified" (never the stored "confirmed") and "pending" (never the retired
// "awaiting verification"), with the pending amount before the verified one.
// Checks rendered output, not source text, so internal enum values and SVG
// element ids are allowed to stay as they are.
const OLD_WORDS = /\bconfirmed\b|awaiting/i;

// Visible SVG text only (drop tags and attribute values such as id="bar-pending").
const visibleText = (svg) =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');

const combos = [];
for (const pendingTotal of [0, 1200, 121200.75]) {
  for (const confirmedTotal of [0, 4500, 104500.5]) {
    for (const targetAmount of [undefined, 12000, 1000000]) {
      combos.push({ pendingTotal, confirmedTotal, targetAmount });
    }
  }
}

describe('status wording (specs 003 + 006)', () => {
  for (const { pendingTotal, confirmedTotal, targetAmount } of combos) {
    const label = `pending ${pendingTotal}, verified ${confirmedTotal}, target ${targetAmount ?? 'none'}`;
    const progress = { confirmedTotal, pendingTotal };

    it(`progress text and card: ${label}`, () => {
      const text = formatProgressText(progress, targetAmount);
      const card = visibleText(
        buildCardSvg({
          collectionName: 'Demo',
          clubName: 'Club',
          progress,
          targetAmount,
        })
      );

      for (const output of [text, card]) {
        expect(output).to.not.match(OLD_WORDS);
        expect(output).to.include('verified');
        if (pendingTotal > 0) {
          expect(output).to.include(' pending');
          expect(output.indexOf(' pending')).to.be.below(
            output.indexOf(' verified')
          );
        } else {
          expect(output).to.not.include('pending');
        }
      }
    });
  }

  it('409 wording for resolved payments uses the display labels', () => {
    for (const status of ['confirmed', 'rejected']) {
      const message = `Payment is already ${STATUS_LABEL[status].lower} and can't be changed.`;
      expect(message).to.not.match(OLD_WORDS);
    }
  });
});
