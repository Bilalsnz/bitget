/**
 * How much of the week a US equity market is actually open.
 *
 * This exists so the Bitget alignment panel can state a number instead of a
 * vibe. "Markets are closed most of the time" is a claim nobody can check;
 * "32.5 hours out of 168" is arithmetic the reader can verify against the
 * session classifier that produced it.
 *
 * Derived from the same constants `sessionFor` uses, in ET wall-clock minutes.
 * That matters for two reasons: the number cannot drift out of agreement with
 * the classifier, and because it is expressed in ET minutes it is unaffected by
 * daylight saving — 09:30–16:00 ET is 390 minutes in July and in January alike.
 *
 * Nothing here is Bitget-specific. The panel combines this arithmetic with a
 * statement about crypto venues that is true of the market as a whole; see
 * `components/BitgetAlignment.tsx` for why that distinction is kept.
 */

import { REGULAR_CLOSE_MIN, REGULAR_OPEN_MIN } from './market/session';

/** Minutes in the regular session: 390. */
export const REGULAR_SESSION_MINUTES = REGULAR_CLOSE_MIN - REGULAR_OPEN_MIN;

/** Hours in the regular session: 6.5. */
export const REGULAR_SESSION_HOURS = REGULAR_SESSION_MINUTES / 60;

export const TRADING_DAYS_PER_WEEK = 5;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;
export const HOURS_PER_WEEK = HOURS_PER_DAY * DAYS_PER_WEEK;

/** 32.5 — regular-session hours in a normal, holiday-free week. */
export const WEEKLY_REGULAR_HOURS = REGULAR_SESSION_HOURS * TRADING_DAYS_PER_WEEK;

/** The regular session as a fraction of the week: ≈ 0.1935. */
export function regularSessionShareOfWeek(): number {
  return WEEKLY_REGULAR_HOURS / HOURS_PER_WEEK;
}

/**
 * The week as two whole percentages that add to 100.
 *
 * Rounded once and subtracted, rather than rounded twice, so the pair always
 * sums to exactly 100. Rounding each independently can produce 19 and 81 today
 * and 20 and 81 for some future session length — a panel that appears to
 * account for 101% of the week is a small thing that costs a lot of trust.
 */
export function weekSplit(): { open: number; closed: number } {
  const open = Math.round(regularSessionShareOfWeek() * 100);
  return { open, closed: 100 - open };
}
