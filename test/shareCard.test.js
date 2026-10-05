import { expect } from 'chai';
import sinon from 'sinon';
import sharp from 'sharp';
import IDCardService from '../utils/idCardService.js';
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  CARD_CACHE_LIMIT,
  buildCardSvg,
  cloudinaryThumb,
  renderCollectionCard,
  clearCardCache,
  cardCacheSize,
  cardCacheKey,
  CARD_LAYOUT,
} from '../utils/shareCard.js';
import fs from 'node:fs';

// Captured from the card code before spec 007 (tasks T003).
const TARGET_MODE = JSON.parse(
  fs.readFileSync(new URL('./fixtures/card-target-mode.svg.json', import.meta.url))
);

const BAR_WIDTH = /id="bar-(track|confirmed|pending)"[^>]*width="([\d.]+)"/g;

function barWidths(svg) {
  const widths = {};
  for (const [, part, width] of svg.matchAll(BAR_WIDTH))
    widths[part] = Number(width);
  return widths;
}

function card(overrides = {}) {
  return {
    collectionName: 'Ride for Relief',
    clubName: 'Iron Riders',
    logoDataUri: null,
    progress: { confirmedTotal: 4500, pendingTotal: 1200 },
    targetAmount: 10000,
    ...overrides,
  };
}

describe('utils/shareCard', () => {
  describe('buildCardSvg', () => {
    it('draws confirmed and pending segments as shares of the target', () => {
      const svg = buildCardSvg(card());
      const { track, confirmed, pending } = barWidths(svg);

      expect(confirmed / track).to.be.closeTo(0.45, 0.001);
      expect(pending / track).to.be.closeTo(0.12, 0.001);
      // Specs 003 + 006: pending first, display words; bar drawing unchanged.
      expect(svg).to.include('₱1,200 pending · ₱4,500 verified');
      expect(svg).to.include('of ₱10,000 target');
    });

    it('caps the bar at the track width', () => {
      const svg = buildCardSvg(
        card({ progress: { confirmedTotal: 9000, pendingTotal: 5000 } })
      );
      const { track, confirmed, pending } = barWidths(svg);

      expect(confirmed + pending).to.be.closeTo(track, 0.001);
    });

    it('leaves out the pending segment and label when nothing is pending', () => {
      const svg = buildCardSvg(
        card({ progress: { confirmedTotal: 4500, pendingTotal: 0 } })
      );

      expect(barWidths(svg)).to.not.have.property('pending');
      expect(svg).to.not.include('pending ·');
      expect(svg).to.include('₱4,500 verified');
    });

    it('keeps target cards byte-identical to before spec 007 (red-team F1)', () => {
      for (const { input, svg } of Object.values(TARGET_MODE)) {
        expect(buildCardSvg(input)).to.equal(svg);
      }
    });

    describe('without a target: verified vs pending split (spec 007)', () => {
      const split = (progress) =>
        buildCardSvg(card({ targetAmount: undefined, progress }));

      it('draws the caption and a split bar above the unchanged amounts line (US2 AC1)', () => {
        const svg = split({ confirmedTotal: 4500, pendingTotal: 1200 });
        const widths = barWidths(svg);

        expect(svg).to.include('>Verified vs pending</text>');
        expect(widths.track).to.equal(1040);
        expect(widths.confirmed).to.be.closeTo(1040 * 0.78947, 0.1);
        expect(widths.pending).to.be.closeTo(1040 * 0.21053, 0.1);
        expect(svg).to.include('₱1,200 pending · ₱4,500 verified');
        expect(svg).to.match(/y="500"[^>]*>₱1,200 pending/);
        expect(svg).to.not.include('target');
      });

      it('draws an empty track with the caption when nothing is collected (US2 AC2)', () => {
        const svg = split({ confirmedTotal: 0, pendingTotal: 0 });
        const widths = barWidths(svg);

        expect(svg).to.include('Verified vs pending');
        expect(widths.track).to.equal(1040);
        expect(widths.confirmed ?? 0).to.equal(0);
        expect(widths.pending).to.equal(undefined);
        expect(svg).to.include('₱0 verified');
      });

      it('keeps a tiny share at least 4px wide (FR-004)', () => {
        const widths = barWidths(split({ confirmedTotal: 100000, pendingTotal: 1 }));
        expect(widths.pending).to.be.at.least(4);
        expect(widths.confirmed + widths.pending).to.be.closeTo(1040, 0.001);
      });

      it('has no caption on target cards (US2 AC3)', () => {
        expect(buildCardSvg(card())).to.not.include('Verified vs pending');
      });
    });

    it('shrinks the amounts line so long amounts stay on the card (spec 003)', () => {
      const amountsSize = (svg) =>
        Number(
          svg.match(/font-size="(\d+)" font-weight="bold" fill="#ffffff">₱/)[1]
        );

      const short = buildCardSvg(
        card({ progress: { confirmedTotal: 4500, pendingTotal: 0 } })
      );
      const long = buildCardSvg(
        card({
          progress: { confirmedTotal: 104500.5, pendingTotal: 121200.75 },
          targetAmount: 1000000,
        })
      );

      expect(amountsSize(short)).to.equal(44);
      expect(amountsSize(long)).to.be.below(44);
      expect(amountsSize(long)).to.be.at.least(28);
    });

    it('escapes and truncates user text', () => {
      const svg = buildCardSvg(
        card({
          collectionName: 'Ride "2025" <script>',
          clubName: 'A'.repeat(60),
        })
      );

      expect(svg).to.include('Ride &quot;2025&quot; &lt;script&gt;');
      expect(svg).to.not.include('<script>');
      expect(svg).to.include(`${'A'.repeat(39)}…`);
      expect(svg).to.not.include('A'.repeat(40));
    });

    it('embeds the logo when given, otherwise a monogram', () => {
      expect(
        buildCardSvg(card({ logoDataUri: 'data:image/png;base64,AAAA' }))
      ).to.include('href="data:image/png;base64,AAAA"');
      const svg = buildCardSvg(card());
      expect(svg).to.include('id="logo-monogram"');
      expect(svg).to.match(/>I<\/text>/);
    });
  });

  describe('cloudinaryThumb', () => {
    it('asks Cloudinary for a small square logo', () => {
      expect(
        cloudinaryThumb(
          'https://res.cloudinary.com/demo/image/upload/v1/clubs/logo.png'
        )
      ).to.equal(
        'https://res.cloudinary.com/demo/image/upload/w_240,h_240,c_fill/v1/clubs/logo.png'
      );
    });

    it('leaves other URLs alone', () => {
      expect(cloudinaryThumb('https://cdn.test/logo.png')).to.equal(
        'https://cdn.test/logo.png'
      );
      expect(cloudinaryThumb(undefined)).to.equal(undefined);
    });
  });

  describe('renderCollectionCard', function () {
    this.timeout(30000);

    let logoDataUri;
    const collection = {
      _id: '507f191e810c19729de860ea',
      name: 'Ride for Relief',
      targetAmount: 10000,
      updatedAt: new Date(0),
    };
    const club = {
      clubName: 'Iron Riders',
      logoUrl: 'https://res.cloudinary.com/demo/image/upload/v1/logo.png',
    };
    const progress = { confirmedTotal: 4500, pendingTotal: 1200 };
    const fallbackLogoUrl = 'https://app.test/assets/icons/icon-512x512.png';

    before(async () => {
      const png = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#f59e0b' },
      })
        .png()
        .toBuffer();
      logoDataUri = `data:image/png;base64,${png.toString('base64')}`;
    });

    beforeEach(() => clearCardCache());
    afterEach(() => sinon.restore());

    it('renders a 1200×630 PNG', async () => {
      sinon.stub(IDCardService, 'fetchImageAsDataUri').resolves(logoDataUri);

      const png = await renderCollectionCard({
        collection,
        club,
        progress,
        fallbackLogoUrl,
      });
      const meta = await sharp(png).metadata();

      expect([CARD_WIDTH, CARD_HEIGHT]).to.deep.equal([1200, 630]);
      expect(meta).to.include({ format: 'png', width: 1200, height: 630 });
    });

    it('fetches a resized logo with a short timeout, then falls back to the app icon', async () => {
      const fetch = sinon.stub(IDCardService, 'fetchImageAsDataUri');
      fetch.onFirstCall().resolves(null);
      fetch.onSecondCall().resolves(logoDataUri);

      await renderCollectionCard({
        collection,
        club,
        progress,
        fallbackLogoUrl,
      });

      expect(fetch.firstCall.args).to.deep.equal([
        'https://res.cloudinary.com/demo/image/upload/w_240,h_240,c_fill/v1/logo.png',
        { timeout: 3000 },
      ]);
      expect(fetch.secondCall.args).to.deep.equal([
        fallbackLogoUrl,
        { timeout: 3000 },
      ]);
    });

    it('still renders when no logo can be loaded', async () => {
      sinon.stub(IDCardService, 'fetchImageAsDataUri').resolves(null);

      const png = await renderCollectionCard({
        collection,
        club: { clubName: 'Iron Riders' },
        progress,
        fallbackLogoUrl,
      });

      expect((await sharp(png).metadata()).width).to.equal(1200);
    });

    it('serves a repeat of the same version from memory', async () => {
      const fetch = sinon
        .stub(IDCardService, 'fetchImageAsDataUri')
        .resolves(logoDataUri);

      const first = await renderCollectionCard({
        collection,
        club,
        progress,
        fallbackLogoUrl,
      });
      const second = await renderCollectionCard({
        collection,
        club,
        progress,
        fallbackLogoUrl,
      });
      await renderCollectionCard({
        collection,
        club,
        progress: { confirmedTotal: 5000, pendingTotal: 0 },
        fallbackLogoUrl,
      });

      expect(second).to.equal(first);
      expect(fetch.callCount).to.equal(2);
    });

    it('includes the card layout version in the cache key (spec 007 R5)', () => {
      expect(CARD_LAYOUT).to.equal('2');
      expect(cardCacheKey({ collection, club, progress }).split(':')).to.include(CARD_LAYOUT);
    });

    it('renders a fresh card when the club logo or name changes', async () => {
      const fetch = sinon
        .stub(IDCardService, 'fetchImageAsDataUri')
        .resolves(logoDataUri);

      await renderCollectionCard({
        collection,
        club,
        progress,
        fallbackLogoUrl,
      });
      await renderCollectionCard({
        collection,
        club: { ...club, logoUrl: `${club.logoUrl}?v=2` },
        progress,
        fallbackLogoUrl,
      });
      await renderCollectionCard({
        collection,
        club: { ...club, clubName: 'Iron Riders MC' },
        progress,
        fallbackLogoUrl,
      });

      expect(fetch.callCount).to.equal(3);
      expect(cardCacheSize()).to.equal(3);
    });

    it(`keeps at most ${CARD_CACHE_LIMIT} cards`, async () => {
      sinon.stub(IDCardService, 'fetchImageAsDataUri').resolves(null);

      for (let i = 0; i <= CARD_CACHE_LIMIT; i += 1) {
        await renderCollectionCard({
          collection,
          club,
          progress: { confirmedTotal: i, pendingTotal: 0 },
          fallbackLogoUrl,
        });
      }

      expect(cardCacheSize()).to.equal(CARD_CACHE_LIMIT);
    });
  });
});
