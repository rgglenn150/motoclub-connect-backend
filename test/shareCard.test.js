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
} from '../utils/shareCard.js';

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
      expect(svg).to.include('₱4,500 confirmed · ₱1,200 pending');
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
      expect(svg).to.not.include('pending');
      expect(svg).to.include('₱4,500 confirmed');
    });

    it('shows amounts without a bar when there is no target', () => {
      const svg = buildCardSvg(
        card({
          targetAmount: undefined,
          progress: { confirmedTotal: 500, pendingTotal: 250 },
        })
      );

      expect(svg).to.not.include('bar-track');
      expect(svg).to.include('₱500 confirmed · ₱250 pending');
      expect(svg).to.not.include('target');
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
