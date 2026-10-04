import { expect } from 'chai';
import fs from 'fs';
import { isCrawler } from '../controllers/shareController.js';

// Spec 002 FR-008: the app's Vercel middleware keeps a copy of CRAWLER_UA.
// Both repos test their copy against this same fixture (byte-identical with
// specs/002-app-link-previews/contracts/crawler-user-agents.json), so editing
// one list without the other fails a test.
const fixture = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/crawler-user-agents.json', import.meta.url)
  )
);

describe('crawler User-Agent fixture (shared with the app middleware)', () => {
  for (const ua of fixture.crawlers) {
    it(`treats as a link-preview service: ${ua.slice(0, 60)}`, () => {
      expect(isCrawler(ua)).to.equal(true);
    });
  }

  for (const ua of fixture.people) {
    it(`treats as a person: ${ua.slice(0, 60)}`, () => {
      expect(isCrawler(ua)).to.equal(false);
    });
  }
});
