import { expect } from 'chai';
import mongoose from 'mongoose';
import { ensureConnection } from './setup.js';
import Event from '../models/EventModel.js';
import {
  parseEventFilter,
  eventTimeFilter,
} from '../utils/eventTimeFilter.js';

// Spec 010 FR-001–003, research R1. A fixed `now` keeps every case exact.
const NOW = new Date('2026-11-23T10:00:00.000Z');
const at = (hours) => new Date(NOW.getTime() + hours * 3600 * 1000);

describe('eventTimeFilter', () => {
  describe('parseEventFilter', () => {
    it('passes the three known filters through', () => {
      expect(parseEventFilter('upcoming')).to.equal('upcoming');
      expect(parseEventFilter('past')).to.equal('past');
      expect(parseEventFilter('all')).to.equal('all');
    });

    it('treats missing, empty, unknown and non-string values as upcoming', () => {
      for (const value of [undefined, null, '', 'bogus', 'PAST', ['past'], 1]) {
        expect(parseEventFilter(value), String(value)).to.equal('upcoming');
      }
    });
  });

  describe('sort', () => {
    it('sorts upcoming soonest first, past most recent first, all oldest first', () => {
      expect(eventTimeFilter('upcoming', NOW).sort).to.deep.equal({ startTime: 1, _id: 1 });
      expect(eventTimeFilter('past', NOW).sort).to.deep.equal({ startTime: -1, _id: -1 });
      expect(eventTimeFilter('all', NOW).sort).to.deep.equal({ startTime: 1, _id: 1 });
    });

    it('matches everything for all', () => {
      expect(eventTimeFilter('all', NOW).match).to.deep.equal({});
    });
  });

  describe('match against real documents', () => {
    const club = new mongoose.Types.ObjectId();
    const createdBy = new mongoose.Types.ObjectId();
    const cases = {
      futureStart: { startTime: at(24) },
      futureStartWithEnd: { startTime: at(24), endTime: at(26) },
      inProgress: { startTime: at(-1), endTime: at(2) },
      endsExactlyNow: { startTime: at(-2), endTime: NOW },
      startsExactlyNowNoEnd: { startTime: NOW },
      startedNoEnd: { startTime: at(-0.1) },
      startedNullEnd: { startTime: at(-0.1), endTime: null },
      ended: { startTime: at(-5), endTime: at(-1) },
      endBeforeStartStarted: { startTime: at(-1), endTime: at(-3) },
      endBeforeStartFuture: { startTime: at(5), endTime: at(1) },
    };
    const upcoming = [
      'futureStart',
      'futureStartWithEnd',
      'inProgress',
      'endsExactlyNow',
      'startsExactlyNowNoEnd',
      'endBeforeStartFuture',
    ];
    const past = ['startedNoEnd', 'startedNullEnd', 'ended', 'endBeforeStartStarted'];

    const names = async (filter) => {
      const { match } = eventTimeFilter(filter, NOW);
      const docs = await Event.find({ $and: [{ club }, match] }).lean();
      return docs.map((d) => d.name).sort();
    };

    before(async () => {
      await ensureConnection();
      await Event.insertMany(
        Object.entries(cases).map(([name, times]) => ({
          name,
          description: 'spec 010 time filter',
          club,
          createdBy,
          ...times,
        }))
      );
    });

    after(async () => {
      await Event.deleteMany({ club });
    });

    it('upcoming holds events whose effective end is now or later', async () => {
      expect(await names('upcoming')).to.deep.equal([...upcoming].sort());
    });

    it('past holds every other event', async () => {
      expect(await names('past')).to.deep.equal([...past].sort());
    });

    it('upcoming and past split all events exactly', async () => {
      const all = await names('all');
      expect(all).to.have.length(Object.keys(cases).length);
      expect([...(await names('upcoming')), ...(await names('past'))].sort()).to.deep.equal(all);
    });
  });
});
