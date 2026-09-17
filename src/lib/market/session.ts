/**
 * US equity market session logic.
 *
 * This module exists so the app can be *precise* about what a quote timestamp
 * actually represents. The free market-data tier does not hand us a labelled
 * extended-hours print, so instead of guessing we derive the session from the
 * timestamp the provider gave us and label it truthfully.
 *
 * Everything is computed in America/New_York wall-clock time. No date library:
 * `Intl.DateTimeFormat` already knows the DST rules, and the holiday calendar
 * is derived from the published NYSE rules rather than hardcoded per year.
 */

import type { SessionInfo, SessionPhase } from '../types';

/**
 * Regular session: 09:30–16:00 ET.
 *
 * Exported so anything that needs to describe the session's *length* — the
 * Bitget alignment panel does — reads the same numbers this classifier uses,
 * rather than restating "6.5 hours" in a string that can silently drift out of
 * agreement with it.
 */
export const REGULAR_OPEN_MIN = 9 * 60 + 30;
export const REGULAR_CLOSE_MIN = 16 * 60;
/** Extended hours: 04:00–09:30 and 16:00–20:00 ET. */
const PRE_OPEN_MIN = 4 * 60;
const AFTER_CLOSE_MIN = 20 * 60;
/** Half-day sessions close at 13:00 ET. */
const EARLY_CLOSE_MIN = 13 * 60;

const ET_TIME_ZONE = 'America/New_York';

/* ------------------------------------------------------------ ET conversion */

type EtParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** "EDT" / "EST" */
  zoneAbbr: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Break a Unix timestamp (seconds) into New York wall-clock parts. */
export function etParts(unixSeconds: number): EtParts {
  const date = new Date(unixSeconds * 1000);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });

  const parts = formatter.formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) lookup[part.type] = part.value;

  // `hourCycle: 'h23'` guarantees 00-23, but defensive-parse anyway.
  const hour = Number(lookup.hour) % 24;

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour,
    minute: Number(lookup.minute),
    weekday: WEEKDAY_INDEX[lookup.weekday ?? 'Sun'] ?? 0,
    zoneAbbr: lookup.timeZoneName ?? 'ET',
  };
}

/** Minutes since midnight in ET. */
function minutesOfDay(parts: EtParts): number {
  return parts.hour * 60 + parts.minute;
}

/* -------------------------------------------------------- holiday calendar */

/** Anonymous Gregorian computus — Easter Sunday for a given year. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Day-of-week for a Y/M/D (UTC arithmetic — no zone involvement). */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The nth (1-based) `weekday` of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const firstWeekday = weekdayOf(year, month, 1);
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** The last `weekday` of a month. */
function lastWeekday(year: number, month: number, weekday: number): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekdayDate = weekdayOf(year, month, daysInMonth);
  const offset = (lastWeekdayDate - weekday + 7) % 7;
  return daysInMonth - offset;
}

/**
 * Shift a fixed-date holiday to the day the market actually observes it:
 * Saturday → preceding Friday, Sunday → following Monday.
 */
function observed(year: number, month: number, day: number): { month: number; day: number } {
  const wd = weekdayOf(year, month, day);
  if (wd === 6) {
    const prev = new Date(Date.UTC(year, month - 1, day - 1));
    return { month: prev.getUTCMonth() + 1, day: prev.getUTCDate() };
  }
  if (wd === 0) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return { month: next.getUTCMonth() + 1, day: next.getUTCDate() };
  }
  return { month, day };
}

type Calendar = {
  /** "M-D" keys of full-day market closures. */
  closed: Set<string>;
  /** "M-D" keys of half days that close at 13:00 ET. */
  earlyClose: Set<string>;
};

const calendarCache = new Map<number, Calendar>();

function key(month: number, day: number): string {
  return `${month}-${day}`;
}

/**
 * NYSE full-day closures and half days for a year.
 *
 * Note on scope: this models the *published rule set*. Ad-hoc closures
 * (national days of mourning, weather) are not knowable in advance — the UI
 * never claims otherwise, because it labels the session from the quote's own
 * timestamp rather than from an assumption about today.
 */
export function calendarFor(year: number): Calendar {
  const cached = calendarCache.get(year);
  if (cached) return cached;

  const closed = new Set<string>();
  const earlyClose = new Set<string>();

  const add = (set: Set<string>, date: { month: number; day: number }) =>
    set.add(key(date.month, date.day));

  // New Year's Day
  add(closed, observed(year, 1, 1));
  // Martin Luther King Jr. Day — 3rd Monday of January
  closed.add(key(1, nthWeekday(year, 1, 1, 3)));
  // Washington's Birthday / Presidents' Day — 3rd Monday of February
  closed.add(key(2, nthWeekday(year, 2, 1, 3)));
  // Good Friday — two days before Easter Sunday
  {
    const easter = easterSunday(year);
    const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day - 2));
    closed.add(key(goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()));
  }
  // Memorial Day — last Monday of May
  closed.add(key(5, lastWeekday(year, 5, 1)));
  // Juneteenth National Independence Day
  add(closed, observed(year, 6, 19));
  // Independence Day
  add(closed, observed(year, 7, 4));
  // Labor Day — 1st Monday of September
  closed.add(key(9, nthWeekday(year, 9, 1, 1)));
  // Thanksgiving — 4th Thursday of November
  {
    const thanksgiving = nthWeekday(year, 11, 4, 4);
    closed.add(key(11, thanksgiving));
    // Black Friday is a half day.
    earlyClose.add(key(11, thanksgiving + 1));
  }
  // Christmas Day
  add(closed, observed(year, 12, 25));

  // Christmas Eve is a half day when it falls Mon–Thu and is not itself the
  // observed holiday (a Saturday Christmas moves the closure to Friday 24th).
  {
    const christmasEveWeekday = weekdayOf(year, 12, 24);
    if (christmasEveWeekday >= 1 && christmasEveWeekday <= 4 && !closed.has(key(12, 24))) {
      earlyClose.add(key(12, 24));
    }
  }

  // July 3rd is a half day when Independence Day is observed on the 4th and
  // the 3rd is a weekday.
  {
    const july3Weekday = weekdayOf(year, 7, 3);
    if (july3Weekday >= 1 && july3Weekday <= 5 && !closed.has(key(7, 3)) && !closed.has(key(7, 4))) {
      earlyClose.add(key(7, 3));
    }
  }

  const calendar = { closed, earlyClose };
  calendarCache.set(year, calendar);
  return calendar;
}

/* ------------------------------------------------------------ session logic */

export function isMarketHoliday(year: number, month: number, day: number): boolean {
  return calendarFor(year).closed.has(key(month, day));
}

function isEarlyClose(year: number, month: number, day: number): boolean {
  return calendarFor(year).earlyClose.has(key(month, day));
}

const PHASE_LABEL: Record<SessionPhase, string> = {
  'pre-market': 'Pre-market',
  regular: 'Regular session',
  'after-hours': 'After-hours',
  closed: 'Market closed',
};

/**
 * Classify a quote timestamp into a US trading session.
 *
 * Returns `closed` for weekends, NYSE holidays, and the overnight gap — in
 * which case the caller should describe the quote as the last available
 * reference print, not as live extended-hours activity.
 */
export function sessionFor(unixSeconds: number): SessionInfo {
  const parts = etParts(unixSeconds);
  const minutes = minutesOfDay(parts);
  const weekend = parts.weekday === 0 || parts.weekday === 6;
  const holiday = isMarketHoliday(parts.year, parts.month, parts.day);
  const halfDay = isEarlyClose(parts.year, parts.month, parts.day);
  const closeMin = halfDay ? EARLY_CLOSE_MIN : REGULAR_CLOSE_MIN;

  let phase: SessionPhase;
  if (weekend || holiday) {
    phase = 'closed';
  } else if (minutes >= REGULAR_OPEN_MIN && minutes < closeMin) {
    phase = 'regular';
  } else if (minutes >= PRE_OPEN_MIN && minutes < REGULAR_OPEN_MIN) {
    phase = 'pre-market';
  } else if (minutes >= closeMin && minutes < AFTER_CLOSE_MIN) {
    phase = 'after-hours';
  } else {
    phase = 'closed';
  }

  const etTime = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')} ${parts.zoneAbbr}`;
  const etDate = `${WEEKDAY_ABBR[parts.weekday]} ${parts.day} ${MONTH_ABBR[parts.month - 1]} ${parts.year}`;

  const halfDayNote = halfDay && phase !== 'closed' ? ' (half day)' : '';

  return {
    phase,
    label: `${PHASE_LABEL[phase]}${halfDayNote}`,
    marketOpenNow: phase === 'regular',
    extendedHours: phase === 'pre-market' || phase === 'after-hours',
    etTime,
    etDate,
  };
}

/** Session for "right now" — used for the market-status strip in the header. */
export function currentSession(now: Date = new Date()): SessionInfo {
  return sessionFor(Math.floor(now.getTime() / 1000));
}

/**
 * A plain-language sentence describing what the displayed movement measures.
 * Kept here (not in the UI) so every surface phrases it identically.
 */
export function movementBasisFor(session: SessionInfo): string {
  switch (session.phase) {
    case 'regular':
      return 'Change versus the previous regular-session close.';
    case 'after-hours':
      return 'Change versus the previous regular-session close, on a print timestamped after the 16:00 ET close.';
    case 'pre-market':
      return 'Change versus the previous regular-session close, on a print timestamped before the 09:30 ET open.';
    case 'closed':
    default:
      return 'Change versus the previous regular-session close, from the most recent available print.';
  }
}
