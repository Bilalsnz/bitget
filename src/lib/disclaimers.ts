/**
 * The two disclaimers this product shows, and nowhere else.
 *
 * The interface carries exactly two short statements: one next to the verdict,
 * one next to the price. Both live here so the card, the snapshot panel and the
 * copied brief cannot drift into three different phrasings of the same promise
 * — the failure mode that made the earlier, longer version of this app read as
 * defensive rather than confident.
 *
 * **This file is the wording, not the enforcement.** The rule that the analysis
 * may never call a regular-session print an after-hours one is enforced in
 * `lib/schema.ts` (`findSessionMislabel`) and in the prompt's own instructions.
 * Those are not disclaimers and are not affected by anything here: a short
 * label does not stop a model from writing "after-hours print" in a sentence,
 * which is precisely the bug the gate exists to catch.
 */

/**
 * Shown next to the verdict. Not financial advice, and not a trading surface —
 * the product holds no brokerage connection and has no control that can act.
 */
export const RESEARCH_NOTICE = 'Research only. Not financial advice. No trading.';

/**
 * Shown next to the price. The free data plan supplies no extended-hours quote,
 * so the number on screen is the latest regular-session print.
 */
export const REGULAR_SESSION_NOTICE = 'Regular-session data only (not live after-hours).';
