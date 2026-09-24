/**
 * Tests for the trading-hours arithmetic behind the Bitget alignment panel.
 *
 * The panel is marketing-adjacent — it is the one section of the page that
 * argues for the product rather than reporting on an instrument — and that is
 * exactly why it needs a test. A number in a persuasive paragraph is the kind
 * of thing that gets rounded up over time, or restated in a string and left
 * behind when the session model changes.
 *
 * The last two cases are the ones that matter. They do not test the arithmetic
 * at all; they test that the arithmetic still *agrees with the classifier*. If
 * the regular session ever moves, those fail and this panel is caught claiming
 * hours the app no longer keeps.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sessionFor } from './market/session';
import {
  HOURS_PER_WEEK,
  REGULAR_SESSION_HOURS,
  REGULAR_SESSION_MINUTES,
  WEEKLY_REGULAR_HOURS,
  regularSessionShareOfWeek,
  weekSplit,
} from './tradingHours';

/** Monday 14 September 2026. 09:30 ET is 13:30 UTC while EDT is in force. */
const MONDAY = { year: 2026, month: 8, day: 14 };
const at = (utcHour: number, utcMinute: number) =>
  Math.floor(Date.UTC(MONDAY.year, MONDAY.month, MONDAY.day, utcHour, utcMinute) / 1000);

describe('regular session arithmetic', () => {
  it('is 390 minutes — 09:30 to 16:00 ET', () => {
    assert.equal(REGULAR_SESSION_MINUTES, 390);
    assert.equal(REGULAR_SESSION_HOURS, 6.5);
  });

  it('is 32.5 hours out of the 168 in a week', () => {
    assert.equal(HOURS_PER_WEEK, 168);
    assert.equal(WEEKLY_REGULAR_HOURS, 32.5);
  });

  it('is about a fifth of the week', () => {
    const share = regularSessionShareOfWeek();
    assert.ok(share > 0.19 && share < 0.2, `expected ~0.193, got ${share}`);
  });
});

describe('weekSplit', () => {
  it('reports the open and closed shares as whole percentages', () => {
    assert.deepEqual(weekSplit(), { open: 19, closed: 81 });
  });

  it('always sums to exactly 100', () => {
    // Rounded once and subtracted rather than rounded twice, so the panel can
    // never appear to account for 101% of the week.
    const { open, closed } = weekSplit();
    assert.equal(open + closed, 100);
  });
});

describe('the arithmetic agrees with the session classifier', () => {
  /*
   * These are the tests that keep the panel honest. They assert the numbers the
   * panel prints against `sessionFor`, the function that actually decides which
   * session a quote belongs to. If the session model changes and the panel does
   * not, these fail rather than the page quietly overstating the market's hours.
   */

  it('treats 09:30 ET as the start of the regular session', () => {
    assert.equal(sessionFor(at(13, 30)).phase, 'regular');
    assert.equal(sessionFor(at(13, 29)).phase, 'pre-market');
  });

  it('ends the regular session after the 16:00 ET closing minute', () => {
    // 15:59 and 16:00 are both regular; 16:01 has rolled to after-hours.
    //
    // 16:00 moved from after-hours to regular on 2026-09-24. The free quote
    // endpoint stamps the closing auction print at exactly 16:00, so the old
    // boundary labelled the day's closing price "After-hours" on every card
    // opened in the evening — the mislabelling this whole module exists to
    // prevent. See the note in `market/session.ts` for why the two possible
    // errors are not symmetric.
    assert.equal(sessionFor(at(19, 59)).phase, 'regular');
    assert.equal(sessionFor(at(20, 0)).phase, 'regular');
    assert.equal(sessionFor(at(20, 1)).phase, 'after-hours');
  });

  it('spans exactly REGULAR_SESSION_MINUTES from open to close', () => {
    const open = at(13, 30);
    const close = at(20, 0);

    assert.equal((close - open) / 60, REGULAR_SESSION_MINUTES);
  });
});
