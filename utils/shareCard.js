import sharp from 'sharp';
import IDCardService from './idCardService.js';
import {
  formatPeso,
  progressBar,
  progressVersion,
  STATUS_LABEL,
} from './collectionProgress.js';

/**
 * Open Graph card for a public collection (spec 001, FR-011): logo, names and a
 * two-tone bar (confirmed solid, pending tinted). Rendered SVG → PNG with sharp,
 * the same way ID cards are; text needs the fonts installed in the Dockerfile.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const CARD_CACHE_LIMIT = 100;

const LOGO_TIMEOUT_MS = 3000;
const MAX_TEXT = 40;
const FONT = 'DejaVu Sans, Arial, sans-serif';
const COLORS = {
  background: '#0f172a',
  surface: '#1e293b',
  accent: '#f59e0b',
  text: '#ffffff',
  muted: '#94a3b8',
};

const BAR = { x: 80, y: 380, width: 1040, height: 40 };

// Bold DejaVu Sans averages ~0.62em per glyph for this text; used to keep the
// amounts line inside the card when amounts get long (spec 003 wording).
const AMOUNTS_FONT = { max: 44, min: 28, emPerChar: 0.62 };
function fitFontSize(text, width) {
  const fitted = Math.floor(width / (text.length * AMOUNTS_FONT.emPerChar));
  return Math.max(AMOUNTS_FONT.min, Math.min(AMOUNTS_FONT.max, fitted));
}
const LOGO = { x: 80, y: 80, size: 160 };

// Insertion-ordered Map used as a small LRU: crawlers fetch the same card
// several times, and the route is public (research R10).
const cache = new Map();

export function clearCardCache() {
  cache.clear();
}

export function cardCacheSize() {
  return cache.size;
}

function truncate(text, max = MAX_TEXT) {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const esc = (text) => IDCardService.escapeSVG(text);

/** Ask Cloudinary for a small square logo instead of the full upload. */
export function cloudinaryThumb(url) {
  if (
    !url ||
    !url.includes('res.cloudinary.com') ||
    !url.includes('/image/upload/')
  )
    return url;
  return url.replace('/image/upload/', '/image/upload/w_240,h_240,c_fill/');
}

function logoMarkup(logoDataUri, clubName) {
  const { x, y, size } = LOGO;
  const r = size / 2;
  if (logoDataUri) {
    return `
  <clipPath id="logo-clip"><circle cx="${x + r}" cy="${y + r}" r="${r}"/></clipPath>
  <image href="${logoDataUri}" x="${x}" y="${y}" width="${size}" height="${size}"
         preserveAspectRatio="xMidYMid slice" clip-path="url(#logo-clip)"/>`;
  }
  const initial = esc((String(clubName ?? '').trim()[0] || 'M').toUpperCase());
  return `
  <circle id="logo-monogram" cx="${x + r}" cy="${y + r}" r="${r}" fill="${COLORS.surface}"/>
  <text x="${x + r}" y="${y + r + 28}" font-family="${FONT}" font-size="80" font-weight="bold"
        fill="${COLORS.accent}" text-anchor="middle">${initial}</text>`;
}

// Bumped when the card's drawing changes, so a running process never serves an
// old layout from memory (spec 007 research R5).
export const CARD_LAYOUT = '2';

// The split bar keeps a positive share at least this wide (spec 007 FR-004).
const MIN_SEGMENT_WIDTH = 4;

/** Segment widths in px; `minWidth` only applies to the split bar. */
function segmentWidths(percents, minWidth) {
  const { width } = BAR;
  let confirmedWidth = (width * percents.confirmedPct) / 100;
  let pendingWidth = (width * percents.pendingPct) / 100;
  if (minWidth > 0) {
    if (pendingWidth > 0 && pendingWidth < minWidth) {
      pendingWidth = minWidth;
      confirmedWidth = Math.min(confirmedWidth, width - minWidth);
    }
    if (confirmedWidth > 0 && confirmedWidth < minWidth) {
      confirmedWidth = minWidth;
      pendingWidth = Math.min(pendingWidth, width - minWidth);
    }
  }
  return { confirmedWidth, pendingWidth };
}

function barMarkup(percents, minWidth = 0) {
  const { x, y, width, height } = BAR;
  const { confirmedWidth, pendingWidth } = segmentWidths(percents, minWidth);
  const pending =
    pendingWidth > 0
      ? `<rect id="bar-pending" x="${x + confirmedWidth}" y="${y}" width="${pendingWidth}" height="${height}" fill="${COLORS.accent}" fill-opacity="0.4"/>`
      : '';
  return `
  <clipPath id="bar-clip"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}"/></clipPath>
  <g clip-path="url(#bar-clip)">
    <rect id="bar-track" x="${x}" y="${y}" width="${width}" height="${height}" fill="${COLORS.surface}"/>
    <rect id="bar-confirmed" x="${x}" y="${y}" width="${confirmedWidth}" height="${height}" fill="${COLORS.accent}"/>
    ${pending}
  </g>`;
}

/**
 * Pure SVG for the card, so layout rules are testable without rendering.
 * @param {{ collectionName: string, clubName?: string, logoDataUri?: string|null,
 *           progress: { confirmedTotal: number, pendingTotal: number }, targetAmount?: number }} input
 */
export function buildCardSvg({
  collectionName,
  clubName,
  logoDataUri,
  progress,
  targetAmount,
}) {
  const bar = progressBar(progress, targetAmount);
  const percents = bar.mode === 'target' ? bar : null;
  // Pending first, then verified (spec 003 FR-003); the bar is unchanged.
  const amounts = [];
  if (progress.pendingTotal > 0)
    amounts.push(
      `${formatPeso(progress.pendingTotal)} ${STATUS_LABEL.pending.lower}`
    );
  amounts.push(
    `${formatPeso(progress.confirmedTotal)} ${STATUS_LABEL.confirmed.lower}`
  );
  const amountsText = amounts.join(' · ');

  // Without a target the bar shows the verified vs pending split under a
  // caption (spec 007); the amounts line stays below it either way.
  const amountsY = 500;
  const goal = percents
    ? `<text x="${BAR.x}" y="${amountsY + 56}" font-family="${FONT}" font-size="32" fill="${COLORS.muted}">of ${esc(formatPeso(targetAmount))} target</text>`
    : '';

  return `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${COLORS.background}"/>
  ${logoMarkup(logoDataUri, clubName)}
  <text x="280" y="150" font-family="${FONT}" font-size="56" font-weight="bold" fill="${COLORS.text}">${esc(truncate(collectionName))}</text>
  <text x="280" y="210" font-family="${FONT}" font-size="32" fill="${COLORS.muted}">${esc(truncate(clubName))}</text>
  ${percents ? barMarkup(percents) : splitMarkup(bar)}
  <text x="${BAR.x}" y="${amountsY}" font-family="${FONT}" font-size="${fitFontSize(amountsText, BAR.width)}" font-weight="bold" fill="${COLORS.text}">${esc(amountsText)}</text>
  ${goal}
  <text x="${CARD_WIDTH - 80}" y="${CARD_HEIGHT - 40}" font-family="${FONT}" font-size="24" fill="${COLORS.muted}" text-anchor="end">Motoclub Connect</text>
</svg>`;
}

/** Caption + split bar for a collection without a target (spec 007 D1–D3, R4). */
function splitMarkup(split) {
  return `<text x="${BAR.x}" y="${BAR.y - 20}" font-family="${FONT}" font-size="28" fill="${COLORS.muted}">Verified vs pending</text>${barMarkup(split, MIN_SEGMENT_WIDTH)}`;
}

/** In-memory cache key: the collection's version, the card layout, and the club's name and logo. */
export function cardCacheKey({ collection, club, progress }) {
  return [
    collection._id,
    progressVersion(progress, collection.updatedAt),
    CARD_LAYOUT,
    club?.clubName ?? '',
    club?.logoUrl ?? '',
  ].join(':');
}

async function loadLogo(club, fallbackLogoUrl) {
  const options = { timeout: LOGO_TIMEOUT_MS };
  if (club?.logoUrl) {
    const logo = await IDCardService.fetchImageAsDataUri(
      cloudinaryThumb(club.logoUrl),
      options
    );
    if (logo) return logo;
  }
  return fallbackLogoUrl
    ? IDCardService.fetchImageAsDataUri(fallbackLogoUrl, options)
    : null;
}

/**
 * PNG card for a public collection. Never fails for a missing logo (FR-013);
 * the caller handles render errors.
 */
export async function renderCollectionCard({
  collection,
  club,
  progress,
  fallbackLogoUrl,
}) {
  // The club's name and logo are drawn on the card, so they are part of the key.
  const key = cardCacheKey({ collection, club, progress });
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const logoDataUri = await loadLogo(club, fallbackLogoUrl);
  const svg = buildCardSvg({
    collectionName: collection.name,
    clubName: club?.clubName,
    logoDataUri,
    progress,
    targetAmount: collection.targetAmount,
  });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  cache.set(key, png);
  if (cache.size > CARD_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return png;
}
