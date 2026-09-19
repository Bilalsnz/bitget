/**
 * The tokenized counterpart of a US ticker, where one was verified.
 *
 * ## What this is allowed to say
 *
 * It says three things and no more: the ticker has a counterpart, what that
 * counterpart is called, and that the venue carrying it does not close. Every
 * one of those is a fact read off live exchange data and stored in
 * `lib/assets.ts` — nothing here is inferred from the ticker's shape.
 *
 * The distinction that matters: this is a **link out**, not a reading. The app
 * does not fetch a price for rNVDA, does not compare the two, and does not know
 * what the tokenized market is doing right now. So the badge deliberately
 * carries no figure. A number here would come from nowhere, and a reader would
 * have no way to tell that it had.
 *
 * It also does not claim the two instruments are the same thing. A tokenized
 * equity tracks a price; it is not a share, and it carries neither voting rights
 * nor a dividend in the way the equity does. The panel below the desk spells
 * that out, and this badge links there rather than pretending to be a price.
 *
 * ## Two variants, because of HTML
 *
 * The instrument chips in the form are `<button>` elements — the whole chip is
 * the tap target that selects an instrument. An `<a>` may not be nested inside
 * a `<button>`, and a link inside one would also be ambiguous to a screen
 * reader: is this tap "select NVDA" or "leave for bitget.com"? So the chip gets
 * `BitgetChipTag`, which is text only, and the tappable `BitgetCounterpart`
 * lives on the card, where the reader is looking at one instrument and a link
 * has an unambiguous meaning.
 *
 * Both variants render nothing at all when no counterpart was verified. The
 * absence is the honest output — see the note in `lib/assets.ts`.
 */

import { getAsset } from '@/lib/assets';

const NEW_TAB_HINT = 'opens bitget.com in a new tab';

/**
 * The tappable badge, for the research card.
 *
 * Renders `null` for an instrument with no verified counterpart, and for any
 * ticker the app does not cover (a reader can type one).
 */
export function BitgetCounterpart({ ticker }: { ticker: string }) {
  const asset = getAsset(ticker);
  if (!asset?.bitget) return null;

  const { symbol, url } = asset.bitget;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${ticker} has a tokenized counterpart on Bitget: ${symbol}. Trades 24/7 — ${NEW_TAB_HINT}.`}
      className="group inline-flex min-h-[36px] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-accent-cyan/30 bg-accent-cyan/[0.07] px-2.5 py-1.5 transition hover:border-accent-cyan/55 hover:bg-accent-cyan/[0.12]"
    >
      <span aria-hidden="true" className="font-mono text-xs text-slate-500">
        →
      </span>
      <span aria-hidden="true" className="font-mono text-xs font-bold text-accent-cyan">
        {symbol}
      </span>
      <span aria-hidden="true" className="text-[0.65rem] font-medium text-slate-400">
        24/7 on Bitget
      </span>
      <span
        aria-hidden="true"
        className="text-[0.65rem] text-slate-500 transition group-hover:text-slate-300"
      >
        ↗
      </span>
    </a>
  );
}

/**
 * The text-only tag, for the instrument chips.
 *
 * Not a link — see the note above about `<button>` nesting. The chip's tap
 * target stays "select this instrument", which is what a reader expects from a
 * row of selectable chips.
 */
export function BitgetChipTag({ ticker }: { ticker: string }) {
  const asset = getAsset(ticker);
  if (!asset?.bitget) return null;

  return (
    <span aria-hidden="true" className="block text-[0.6rem] font-normal leading-tight text-slate-500">
      {asset.bitget.symbol}
    </span>
  );
}
