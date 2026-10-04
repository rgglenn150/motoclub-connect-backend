import { rateLimit } from 'express-rate-limit';

/**
 * Per-client limit for the public /share routes (spec 001, FR-019; ADR-0001).
 * Client = req.ip, which is the real visitor because server.js trusts exactly
 * one proxy hop. Counters live in memory, which is fine for one container.
 */

const DEFAULT_PER_MIN = 120;

export const SHARE_RATE_LIMIT_PER_MIN =
  Number.parseInt(process.env.SHARE_RATE_LIMIT_PER_MIN, 10) > 0
    ? Number.parseInt(process.env.SHARE_RATE_LIMIT_PER_MIN, 10)
    : DEFAULT_PER_MIN;

export function createShareRateLimit({
  limit = SHARE_RATE_LIMIT_PER_MIN,
} = {}) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Crawlers don't read error bodies; an empty 429 is cheapest.
    handler: (req, res) => res.status(429).end(),
  });
}

export const shareRateLimit = createShareRateLimit();
