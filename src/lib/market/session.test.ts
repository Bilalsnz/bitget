/**
 * Tests for US equity session and holiday logic.
 *
 * The session classifier is what stops the app describing a regular-session
 * price as an after-hours move, so it carries more weight than its size
 * suggests. The holiday cases are the ones that silently rot: a calendar that
 * is wrong by a day produces an app that confidently mislabels a closed market.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calendarFor, etParts, isMarketHoliday, movementBasisFor, sessionFor } from './session';

/**
 * Unix seconds for a wall-clock ET time during EDT (UTC−4).
 * Note the offset is the *test's* responsibility, not the code's: `sessionFor`
 * is given an instant and must work out the zone itself.
 */
function edt(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour + 4, minute) / 1000);
}

/** Unix seconds for a wall-clock ET time during EST (UTC−5). */
function est(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour + 5, minute) / 1000);
}

describe('etParts', () => {
  it('converts a summer instant using EDT', () => {
    const parts = etParts(edt(2026, 9, 14, 10, 30));
    assert.equal(parts.hour, 10);
    assert.equal(parts.minute, 30);
    assert.equal(parts.weekday, 1, '2026-09-14 is a Monday');
    assert.equal(parts.zoneAbbr, 'EDT');
  });

  it('converts a winter instant using EST', () => {
    const parts = etParts(est(2026, 12, 25, 12, 0));
    assert.equal(parts.hour, 12);
    assert.equal(parts.zoneAbbr, 'EST');
  });
});

describe('sessionFor — regular trading day', () => {
  // Monday 2026-09-14, an ordinary session with no holiday nearby.
  it('classifies pre-market', () => {
    const session = sessionFor(edt(2026, 9, 14, 8, 0));
    assert.equal(session.phase, 'pre-market');
    assert.equal(session.extendedHours, true);
    assert.equal(session.marketOpenNow, false);
  });

  it('classifies the regular session at the open, midday and the close', () => {
    for (const [hour, minute] of [
      [9, 30],
      [12, 0],
      [15, 59],
    ] as const) {
      const session = sessionFor(edt(2026, 9, 14, hour, minute));
      assert.equal(session.phase, 'regular', `expected regular at ${hour}:${minute}`);
      assert.equal(session.marketOpenNow, true);
    }
  });

  it('classifies 16:00 exactly as the regular session, not after-hours', () => {
    // The closing minute belongs to the regular session.
    //
    // This asserted the opposite until 2026-09-24, on the reasoning that the
    // close is exclusive. It is, on the clock — but the free quote endpoint
    // stamps the closing auction print at exactly 16:00, so the `<` boundary
    // meant the day's *closing price* was labelled "After-hours" on every card
    // opened after the close, beside a notice reading "Regular-session data
    // only (not live after-hours)". See the note in `session.ts`: a
    // minute-resolution stamp cannot tell the 16:00:00 cross from a 16:00:30
    // extended-hours trade, and the two errors are not symmetric — inventing
    // extended hours is worse than disclaiming them.
    const session = sessionFor(edt(2026, 9, 14, 16, 0));
    assert.equal(session.phase, 'regular');
  });

  it('classifies the first minute after the close as after-hours', () => {
    // The boundary this protects: one minute later is genuinely extended hours
    // and must still be labelled as such, or the fix above would have swallowed
    // the whole after-hours session.
    assert.equal(sessionFor(edt(2026, 9, 14, 16, 1)).phase, 'after-hours');
  });

  it('classifies after-hours', () => {
    const session = sessionFor(edt(2026, 9, 14, 17, 30));
    assert.equal(session.phase, 'after-hours');
    assert.equal(session.extendedHours, true);
  });

  /**
   * `atRegularClose` — the close specifically, not the whole regular session.
   *
   * It exists because "is this print a regular-session print?" and "is this
   * print *the close*?" are different questions, and one caller needs the
   * second. A gap measured against a mid-session print is a different quantity
   * from a gap measured against the close, and nothing about the two numbers on
   * screen would tell a reader which they were looking at.
   */
  it('marks the closing minute, and only the closing minute', () => {
    assert.equal(sessionFor(edt(2026, 9, 14, 16, 0)).atRegularClose, true);
    // Both neighbours are important: 15:59 is inside the regular session and is
    // not the close, and 16:01 is the extended session entirely.
    assert.equal(sessionFor(edt(2026, 9, 14, 15, 59)).atRegularClose, false);
    assert.equal(sessionFor(edt(2026, 9, 14, 16, 1)).atRegularClose, false);
    // Mid-session: regular, but the session went on to print a later price.
    assert.equal(sessionFor(edt(2026, 9, 14, 14, 0)).atRegularClose, false);
  });

  it('marks the early close on a half day, not 16:00', () => {
    // Friday 2026-11-27, the day after Thanksgiving: closes at 13:00 ET.
    assert.equal(sessionFor(est(2026, 11, 27, 13, 0)).atRegularClose, true);
    assert.equal(sessionFor(est(2026, 11, 27, 12, 59)).atRegularClose, false);
    // 13:01 is after the early close, so it is extended hours rather than a
    // second close — a half day must not leave two minutes marked as "the close".
    assert.equal(sessionFor(est(2026, 11, 27, 13, 1)).atRegularClose, false);
  });

  it('never marks a closed day as a close', () => {
    // A weekend has a 16:00 on the clock and no session at all.
    // Saturday 2026-09-19.
    assert.equal(sessionFor(edt(2026, 9, 19, 16, 0)).atRegularClose, false);
  });
  it('classifies the overnight gap as closed', () => {
    assert.equal(sessionFor(edt(2026, 9, 14, 22, 0)).phase, 'closed');
    assert.equal(sessionFor(edt(2026, 9, 14, 2, 0)).phase, 'closed');
    assert.equal(sessionFor(edt(2026, 9, 14, 3, 59)).phase, 'closed');
    assert.equal(sessionFor(edt(2026, 9, 14, 4, 0)).phase, 'pre-market');
  });
});

describe('sessionFor — weekends', () => {
  it('treats Saturday and Sunday as closed at every hour', () => {
    for (const day of [12, 13]) {
      for (const hour of [5, 10, 14, 18]) {
        assert.equal(
          sessionFor(edt(2026, 9, day, hour)).phase,
          'closed',
          `expected closed on day ${day} at ${hour}:00`,
        );
      }
    }
  });
});

describe('sessionFor — holidays', () => {
  it('closes on Good Friday', () => {
    // Easter Sunday 2026 is 5 April, so Good Friday is 3 April.
    assert.equal(sessionFor(edt(2026, 4, 3, 12, 0)).phase, 'closed');
    assert.equal(isMarketHoliday(2026, 4, 3), true);
  });

  it('closes on Martin Luther King Jr. Day (3rd Monday of January)', () => {
    assert.equal(sessionFor(est(2026, 1, 19, 12, 0)).phase, 'closed');
  });

  it('closes on Thanksgiving (4th Thursday of November)', () => {
    assert.equal(sessionFor(est(2026, 11, 26, 12, 0)).phase, 'closed');
  });

  it('closes on Christmas Day', () => {
    assert.equal(sessionFor(est(2026, 12, 25, 12, 0)).phase, 'closed');
  });

  it('shifts a Saturday Independence Day back to the Friday', () => {
    // 4 July 2026 falls on a Saturday, so the market closes on Friday the 3rd.
    assert.equal(sessionFor(edt(2026, 7, 3, 12, 0)).phase, 'closed');
  });

  it('does not close on an ordinary weekday', () => {
    assert.equal(sessionFor(edt(2026, 9, 14, 12, 0)).phase, 'regular');
  });
});

describe('sessionFor — half days', () => {
  it('runs a normal session before the early close', () => {
    // Christmas Eve 2026 is a Thursday and a half day.
    const session = sessionFor(est(2026, 12, 24, 12, 0));
    assert.equal(session.phase, 'regular');
    assert.ok(session.label.includes('half day'));
  });

  it('ends the regular session after 13:00 ET', () => {
    assert.equal(sessionFor(est(2026, 12, 24, 12, 59)).phase, 'regular');
    // 13:00 is the half-day closing print, so it is regular for the same reason
    // 16:00 is on a full day.
    assert.equal(sessionFor(est(2026, 12, 24, 13, 0)).phase, 'regular');
    assert.equal(sessionFor(est(2026, 12, 24, 13, 1)).phase, 'after-hours');
  });

  it('treats Black Friday as a half day', () => {
    assert.equal(sessionFor(est(2026, 11, 27, 12, 0)).phase, 'regular');
    assert.equal(sessionFor(est(2026, 11, 27, 14, 0)).phase, 'after-hours');
  });
});

describe('calendarFor', () => {
  it('is memoised — the same year returns the same object', () => {
    assert.equal(calendarFor(2026), calendarFor(2026));
  });

  it('does not leak closures between years', () => {
    // 4 July 2027 is a Sunday, so it should be observed on Monday the 5th.
    assert.equal(isMarketHoliday(2027, 7, 5), true);
    assert.equal(isMarketHoliday(2027, 7, 4), false);
  });
});

describe('movementBasisFor', () => {
  it('never claims an after-hours basis for a closed market', () => {
    const closed = sessionFor(edt(2026, 9, 14, 22, 0));
    const basis = movementBasisFor(closed);
    assert.ok(basis.includes('most recent available print'));
    assert.ok(!basis.includes('after the 16:00 ET close'));
  });

  it('states the extended-hours basis when the print is post-close', () => {
    const afterHours = sessionFor(edt(2026, 9, 14, 17, 0));
    assert.ok(movementBasisFor(afterHours).includes('after the 16:00 ET close'));
  });

  it('names the half-day close, not 16:00, on a short session', () => {
    // Black Friday 2026 closes at 13:00. A basis line reading "after the 16:00
    // ET close" would be false, and would sit on the same card as a "(half day)"
    // label contradicting it.
    const blackFriday = sessionFor(est(2026, 11, 27, 14, 0));
    const basis = movementBasisFor(blackFriday);

    assert.ok(basis.includes('after the 13:00 ET close'));
    assert.equal(basis.includes('16:00'), false);
  });
});
