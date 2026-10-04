import Collection from '../models/CollectionModel.js';
import Club from '../models/ClubModel.js';
import Payment from '../models/PaymentModel.js';

const SITE_NAME = 'Motoclub Connect';
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '1515940283108537';

/**
 * Social crawlers (Facebook, Messenger, Viber, X, ...) don't run JavaScript, so
 * the Angular SPA can't give them anything but the static index.html. These
 * routes render a small HTML document with the Open Graph tags instead, and
 * bounce real visitors to the app page they asked for.
 */
const CRAWLER_UA =
  /facebookexternalhit|facebookcatalog|facebot|twitterbot|slackbot|linkedinbot|whatsapp|viber|telegrambot|discordbot|pinterest|redditbot|applebot|skypeuripreview|embedly|vkshare|googlebot|bingbot|quora link preview|outbrain|nuzzel|w3c_validator|bitlybot|flipboard|tumblr|xing-contenttabreceiver|line-podcast|snapchat/i;

export function isCrawler(userAgent = '') {
  return CRAWLER_UA.test(userAgent);
}

export function appBaseUrl() {
  const configured =
    process.env.PUBLIC_APP_URL ||
    (process.env.FRONTEND_URL || '').split(',')[0].trim();
  const base = configured || 'https://moto.pspipes.net';
  return base.replace(/\/+$/, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Open Graph descriptions are truncated by most scrapers well before this. */
function truncate(value, max = 300) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatPeso(amount) {
  return `₱${Number(amount || 0).toLocaleString('en-PH')}`;
}

function renderSharePage({ title, description, image, canonicalUrl, redirectUrl }) {
  const safe = {
    title: escapeHtml(title),
    description: escapeHtml(description),
    image: escapeHtml(image),
    canonicalUrl: escapeHtml(canonicalUrl),
    redirectUrl: escapeHtml(redirectUrl),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${safe.title}</title>
<meta name="description" content="${safe.description}"/>
<link rel="canonical" href="${safe.canonicalUrl}"/>

<meta property="og:type" content="website"/>
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}"/>
<meta property="og:title" content="${safe.title}"/>
<meta property="og:description" content="${safe.description}"/>
<meta property="og:url" content="${safe.canonicalUrl}"/>
<meta property="og:image" content="${safe.image}"/>
<meta property="og:image:alt" content="${safe.title}"/>
<meta property="fb:app_id" content="${escapeHtml(FACEBOOK_APP_ID)}"/>

<meta name="twitter:card" content="summary"/>
<meta name="twitter:title" content="${safe.title}"/>
<meta name="twitter:description" content="${safe.description}"/>
<meta name="twitter:image" content="${safe.image}"/>

<meta http-equiv="refresh" content="0; url=${safe.redirectUrl}"/>
</head>
<body>
<p>Redirecting to <a href="${safe.redirectUrl}">${safe.title}</a>…</p>
<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</body>
</html>`;
}

/**
 * GET /share/collection/:collectionId
 * Serves Open Graph metadata to scrapers; redirects everyone else into the app.
 */
export async function renderCollectionShare(req, res) {
  const { collectionId } = req.params;
  const base = appBaseUrl();
  const fallbackImage = `${base}/assets/icons/icon-512x512.png`;

  let redirectUrl = base;
  let title = SITE_NAME;
  let description =
    'Manage your motorcycle club — members, events, and collections — in one place.';
  let image = fallbackImage;

  try {
    const collection = collectionId.match(/^[0-9a-fA-F]{24}$/)
      ? await Collection.findById(collectionId).lean()
      : null;

    if (collection) {
      redirectUrl = `${base}/clubs/${collection.club}/collection/${collection._id}`;

      // Only public collections get their details exposed to a scraper; a
      // members-only one keeps the generic app preview.
      if (collection.visibility === 'public') {
        const [club, totalResult] = await Promise.all([
          Club.findById(collection.club, 'clubName logoUrl').lean(),
          Payment.aggregate([
            { $match: { collection: collection._id } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]),
        ]);

        const clubName = club?.clubName || '';
        const collected = totalResult[0]?.total ?? 0;

        title = clubName ? `${collection.name} · ${clubName}` : collection.name;

        const progress = collection.targetAmount
          ? `${formatPeso(collected)} of ${formatPeso(collection.targetAmount)} collected.`
          : `${formatPeso(collected)} collected so far.`;
        description = truncate(
          collection.description
            ? `${collection.description} ${progress}`
            : `${clubName ? `${clubName} is collecting contributions. ` : ''}${progress}`
        );

        if (club?.logoUrl) image = club.logoUrl;
      }
    }
  } catch (err) {
    console.error('Error rendering collection share page:', err.message);
  }

  const canonicalUrl = redirectUrl;

  if (!isCrawler(req.headers['user-agent'])) {
    return res.redirect(302, redirectUrl);
  }

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  return res
    .status(200)
    .send(renderSharePage({ title, description, image, canonicalUrl, redirectUrl }));
}
