import { expect } from 'chai';
import {
  formatProgressText,
  STATUS_LABEL,
} from '../utils/collectionProgress.js';
import { buildCardSvg } from '../utils/shareCard.js';

// Spec 003 SC-001 / red-team F4: people never see the stored status words, and
// the awaiting amount always comes before the verified amount. Checks rendered
// output, not source text, so internal enum values ('confirmed', 'pending') and
// SVG element ids are allowed to stay as they are.
const OLD_WORDS = /\bconfirmed\b|\bpending\b/i;

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

describe('status wording (spec 003)', () => {
  for (const { pendingTotal, confirmedTotal, targetAmount } of combos) {
    const label = `awaiting ${pendingTotal}, verified ${confirmedTotal}, target ${targetAmount ?? 'none'}`;
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
          expect(output.indexOf('awaiting verification')).to.be.below(
            output.indexOf(' verified')
          );
        } else {
          expect(output).to.not.include('awaiting');
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
