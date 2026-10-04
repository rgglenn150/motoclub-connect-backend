import crypto from 'crypto';
import net from 'net';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

/**
 * Per-client limit for the public /share routes (spec 001, FR-019; ADR-0001).
 * Client = req.ip, which is the real visitor because server.js trusts exactly
 * one proxy hop. Counters live in memory, which is fine for one container.
 *
 * Requests proxied by the app's Vercel middleware arrive from Vercel's edge, so
 * req.ip is shared by many previewers. When such a request proves itself with
 * the shared secret, the forwarded client IP is the key instead (spec 002,
 * FR-006; ADR-0002).
 */

const DEFAULT_PER_MIN = 120;
const MIN_SECRET_LENGTH = 32;

export const SHARE_RATE_LIMIT_PER_MIN =
  Number.parseInt(process.env.SHARE_RATE_LIMIT_PER_MIN, 10) > 0
    ? Number.parseInt(process.env.SHARE_RATE_LIMIT_PER_MIN, 10)
    : DEFAULT_PER_MIN;

function secretMatches(given, secret) {
  if (typeof given !== 'string' || typeof secret !== 'string') return false;
  if (secret.length < MIN_SECRET_LENGTH) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  // timingSafeEqual needs equal lengths; compare against itself to keep timing flat.
  return (
    crypto.timingSafeEqual(a.length === b.length ? a : b, b) &&
    a.length === b.length
  );
}

// Proxy headers that don't validate mean the Vercel env and the server .env
// disagree: previews then share Vercel's buckets. Say so once (red-team F3),
// never echoing either secret.
let proxyWarned = false;
function warnProxyMisconfigured(reason) {
  if (proxyWarned) return;
  proxyWarned = true;
  console.warn(
    `SHARE_PROXY_SECRET: proxied /share request not trusted (${reason}); rate limiting by connecting IP. Check the Vercel env and the server .env match (ADR-0002).`
  );
}

/** Test hook: let the one-time warning fire again. */
export function resetProxyWarning() {
  proxyWarned = false;
}

/**
 * Rate-limit key for a /share request.
 * @param {import('express').Request} req
 * @param {string|undefined} secret the configured SHARE_PROXY_SECRET
 */
export function shareClientKey(req, secret) {
  const forwardedIp = req.get('x-share-client-ip');
  const given = req.get('x-share-proxy-secret');

  if (given === undefined && forwardedIp === undefined) {
    return ipKeyGenerator(req.ip);
  }

  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    warnProxyMisconfigured('server secret unset or shorter than 32 characters');
  } else if (!secretMatches(given, secret)) {
    warnProxyMisconfigured('missing or wrong secret header');
  } else if (!net.isIP(forwardedIp ?? '')) {
    warnProxyMisconfigured('invalid X-Share-Client-IP');
  } else {
    return ipKeyGenerator(forwardedIp);
  }
  return ipKeyGenerator(req.ip);
}

export function createShareRateLimit({
  limit = SHARE_RATE_LIMIT_PER_MIN,
  secret,
} = {}) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Read at request time, so a restart isn't the only way tests can set it.
    keyGenerator: (req) =>
      shareClientKey(req, secret ?? process.env.SHARE_PROXY_SECRET),
    // Crawlers don't read error bodies; an empty 429 is cheapest.
    handler: (req, res) => res.status(429).end(),
  });
}

export const shareRateLimit = createShareRateLimit();
