/**
 * The one rule for whether an event is upcoming or past (spec 010 FR-002,
 * research R1), shared by the club event list and the My Clubs and Global
 * feeds.
 *
 * An event is upcoming until its effective end: its end time when it has one
 * that isn't before its start time, otherwise its start time. The upcoming and
 * past matches are exact complements, so every event lands in one of them.
 *
 * Callers combine `match` with their own conditions via `$and`, because the
 * matches use `$or` and would otherwise clash with a search `$or` (R2).
 */

export const EVENT_FILTERS = ['upcoming', 'past', 'all'];

/** `upcoming` | `past` | `all`; anything else (missing, unknown) → `upcoming`. */
export function parseEventFilter(value) {
  return EVENT_FILTERS.includes(value) ? value : 'upcoming';
}

/**
 * @param {'upcoming'|'past'|'all'} filter
 * @param {Date} [now]
 * @returns {{ match: object, sort: object }}
 */
export function eventTimeFilter(filter, now = new Date()) {
  const hasValidEnd = { $expr: { $gte: ['$endTime', '$startTime'] } };

  if (filter === 'upcoming') {
    return {
      match: {
        $or: [
          { startTime: { $gte: now } },
          { endTime: { $gte: now }, ...hasValidEnd },
        ],
      },
      sort: { startTime: 1, _id: 1 },
    };
  }

  if (filter === 'past') {
    return {
      match: {
        startTime: { $lt: now },
        $or: [
          { endTime: null },
          { endTime: { $lt: now } },
          { $expr: { $lt: ['$endTime', '$startTime'] } },
        ],
      },
      sort: { startTime: -1, _id: -1 },
    };
  }

  return { match: {}, sort: { startTime: 1, _id: 1 } };
}
