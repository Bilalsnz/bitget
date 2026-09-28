/**
 * The disclaimers this product shows, and nowhere else.
 *
 * The interface carries two short statements — one next to the verdict, one
 * next to the price — plus one line describing the tokenized counterpart, which
 * is a different kind of thing: not a disclaimer about the product but a label
 * on a second instrument. All of it lives here so the card, the snapshot panel
 * and the copied brief cannot drift into several phrasings of the same promise
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

/**
 * What a tokenized price is, said in as few words as will still say it.
 *
 * Takes the instrument's own symbol (`rNVDA`) rather than the equity's, because
 * the parenthesis is doing the work the old wording did at four times the
 * length: it names the thing being priced as something *other* than the ticker
 * beside it. A reader who takes in nothing else from this caption takes in that
 * the symbol in brackets is not the symbol above it.
 *
 * ## What this replaced, and what was given up
 *
 * The previous caption read *"tokenized instrument, not a share — not NVDA's
 * price, and not an after-hours print for NVDA."* It was replaced on request
 * with this shorter form, and the trade is worth recording rather than
 * pretending it was free:
 *
 *   - **Kept:** the instrument is identified as tokenized, and named, and the
 *     price is attributed to Bitget with the words "Live 24/7". All of that was
 *     already true and remains true.
 *   - **Given up:** the two explicit *negations*. The old caption said outright
 *     that the number is not the share's price and not an after-hours print.
 *     The new one identifies what the number *is* and leaves the reader to
 *     conclude what it is not.
 *
 * That is a real reduction in what is spelled out, and it is the reduction the
 * request asked for. It is defensible on the same grounds as the earlier
 * strip-down to two notices — a caveat a reader skips protects nobody — and it
 * is a judgement about copy, not a licence to blur the distinction. The
 * enforcement is elsewhere and did not move: the tokenized figure is still a
 * field of its own that is never merged into `Quote` (see `market/bitget.ts`),
 * and the basis still names its reference every time (`market/basis.ts`).
 *
 * One shared string, imported by the card and by the copied brief, for the
 * reason this file exists at all: a brief leaves the app with no card around
 * it, and two wordings of the same promise drift.
 */
export function tokenizedNotice(symbol: string): string {
  return `Tokenized instrument (${symbol}) · Live 24/7 price on Bitget`;
}
