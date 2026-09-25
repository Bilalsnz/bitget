/**
 * The basis between a tokenized counterpart and the regular-session print.
 *
 * ## What it measures
 *
 * `tokenizedPrice − regularSessionPrice`, and that same gap as a percentage of
 * the regular print. Tokenized equities trade around the clock while the US
 * tape does not, so while the tape is closed this is a live market's opinion of
 * where the instrument sits relative to the last price the tape printed. For a
 * product whose whole question is "what moved after the close", that is the
 * most useful derived number available to a deployment with no extended-hours
 * entitlement — and it is derived from two figures that are each real, rather
 * than from an inference about either.
 *
 * ## Why it lives here and not in the view
 *
 * Market numbers are produced by `lib/market` and the analysis layer consumes
 * them (see the header of `lib/types.ts`). A basis is a market number: it is
 * arithmetic on two observed prices, it is persisted into saved briefs, and it
 * should read the same in a brief opened next week as it did when the card was
 * built. Computing it once, in the layer that produced both of its inputs, is
 * how that stays true. A view that recomputed it would be a second
 * implementation, and a second implementation is a thing that can disagree
 * with the first.
 *
 * ## The rule that keeps it honest: the closing print, and nothing else
 *
 * The basis is computed only against a print that falls **at the regular
 * session's close** — the closing auction, the last price the session produces.
 * That is the one print whose meaning is unambiguous, and it is the one the
 * phrase names: "2.31% above the 16:00 EDT regular-session print" is precisely
 * the move since the close.
 *
 * Two narrower-looking rules were tried and are both wrong. "The regular
 * session" is too loose: a print taken at 14:00 is also a regular-session
 * print, and a gap against it measures movement *during* the session — a
 * smaller, differently-caused number that would carry the identical label and
 * the identical caption. On an after-hours desk a reader would take it for the
 * since-the-close move every time. "Whatever session the print is in" is
 * looser still, and against a genuine extended-hours print it would be
 * comparing two instruments across two sessions this deployment already admits
 * it cannot separate (see the note in `session.ts` on the closing minute).
 *
 * Relabelling per case would mean more copy and more chances to mislabel — and
 * mislabelling a tokenized figure as an equity's after-hours move is the exact
 * failure this product was built to prevent. So the rule is to compute nothing.
 * An absent basis costs the reader one line; a mislabelled one is
 * unrecoverable.
 *
 * ## Failure is null, never zero
 *
 * The same asymmetry as `bitget.ts`. Every missing or unusable input yields
 * `null`, and `null` renders as no basis at all. It never estimates, never
 * interpolates, never carries a previous value forward, and never quietly falls
 * back to a different reference when the regular session one is unavailable.
 */

import type { Quote, TokenizedBasis, TokenizedQuote } from '../types';

/**
 * How close to zero a gap has to be before it is called level.
 *
 * Five thousandths of a percent. Below this the two markets are agreeing, and
 * rendering "+0.00%" beside a direction word would be a precision the number
 * does not carry — the venues quote to different tick sizes and the two legs
 * are not sampled at the same instant, so a gap smaller than this is noise
 * rather than signal. "Level with" is the honest reading of it.
 */
const LEVEL_BAND_PERCENT = 0.005;

/**
 * The tokenized market's gap from the regular-session print, or `null`.
 *
 * Returns `null` — never zero, never a guess — when there is no tokenized
 * quote, when either price is unusable, or when the reference print is not a
 * regular-session print.
 */
export function tokenizedBasis(
  tokenized: TokenizedQuote | null | undefined,
  quote: Quote,
): TokenizedBasis | null {
  if (!tokenized) return null;

  // A non-positive or non-finite price is not a price. Dividing by it, or
  // subtracting it, would manufacture a figure rather than report one.
  if (!Number.isFinite(tokenized.price) || tokenized.price <= 0) return null;

  // The rule from the header: the closing print, or nothing. Not merely "a
  // regular-session print" — see the note there on why 14:00 must not qualify.
  if (!quote.session.atRegularClose) return null;

  if (!Number.isFinite(quote.price) || quote.price <= 0) return null;

  const absolute = tokenized.price - quote.price;
  // As a percent of the *regular print*, which is the reference. Dividing by
  // the tokenized price instead would be a different and much smaller number
  // for the same gap — plausible enough on screen that nobody would catch it.
  const percent = (absolute / quote.price) * 100;

  return {
    absolute,
    percent,
    position:
      Math.abs(percent) < LEVEL_BAND_PERCENT ? 'level' : percent > 0 ? 'above' : 'below',
    referencePrice: quote.price,
    // Names the session and the clock time, so the figure can never be read as
    // a comparison against "now" or against an after-hours print. The time
    // comes from the quote's own session, so a half day says 13:00.
    referenceLabel: `${quote.session.etTime} regular-session print`,
  };
}

/**
 * The basis as a phrase, e.g. `2.31% above the 16:00 EDT regular-session print`.
 *
 * Exported and shared rather than written twice, because it *is* written twice:
 * the card caption and the copied brief both state this fact, and a brief is
 * read with none of the card's surrounding context. If the two renderings could
 * drift, the one that drifted would be the one that travelled — and the phrase
 * exists precisely so the figure cannot be read as a move in the equity. A
 * second copy of that guarantee is a second chance to lose it.
 *
 * Same reasoning as `movementBasisFor` in `session.ts`: this layer already owns
 * the plain-language description of what a number is measured against.
 *
 * The direction word carries the sign and the sign is never written as well —
 * "−2.31% below" states one fact twice and reads as a stutter.
 */
export function basisPhrase(basis: TokenizedBasis): string {
  if (basis.position === 'level') return `level with the ${basis.referenceLabel}`;
  const magnitude = `${Math.abs(basis.percent).toFixed(2)}%`;
  return `${magnitude} ${basis.position} the ${basis.referenceLabel}`;
}
