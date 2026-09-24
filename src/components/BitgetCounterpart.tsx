/**
 * The tokenized counterpart of a US ticker, where one was verified.
 *
 * ## What this is allowed to say
 *
 * It names the counterpart (`NVDA → rNVDA`), links to that market, and — since
 * the desk began pricing it — shows what that market is trading at. Every one
 * of those is read off live exchange data; nothing here is inferred from the
 * ticker's shape.
 *
 * ## The distinction this component exists to hold
 *
 * `rNVDA` is **not** NVDA. It is a separate tokenized instrument that tracks
 * NVDA's price, on a crypto venue's order book rather than an exchange's tape.
 * So this component must never let its figure read as NVDA's price, and in
 * particular never as NVDA's *after-hours* price — the one mislabelling this
 * whole product is built to prevent (see `lib/market/finnhub.ts`).
 *
 * That is why the price is labelled with the venue and the instrument every
 * time it appears, and why a caption states plainly that the two are different
 * things. It is also why the number is never merged into `Quote` upstream: a
 * shared field is how two instruments become one "price".
 *
 * ## Why a tokenized price is worth showing at all
 *
 * This desk cannot see extended hours — its data plan has no post-market
 * quote. Tokenized equities trade 24/7, so while the US tape is closed this
 * market is still producing prices. That makes it a genuine second signal for
 * the question the product asks, and a *different* one: it is not a substitute
 * for an after-hours print, and it is never presented as one.
 *
 * ## When there is no price
 *
 * `tokenized` is absent for most instruments and for every instrument when the
 * venue does not answer. When it is absent the badge renders exactly as it did
 * before — name and link, no figure — because an absent price is a smaller
 * failure than a stale or invented one. Nothing here carries a number forward
 * from a previous render.
 *
 * ## Two variants, because of HTML
 *
 * The instrument chips in the form are `<button>` elements — the whole chip is
 * the tap target that selects an instrument. An `<a>` may not be nested inside
 * a `<button>`, and a link inside one would also be ambiguous to a screen
 * reader: is this tap "select NVDA" or "leave for bitget.com"? So the chip gets
 * `BitgetChipTag`, which stays text only, and the tappable `BitgetCounterpart`
 * lives on the card, where the reader is looking at one instrument and a link
 * has an unambiguous meaning.
 *
 * Both variants render nothing at all when no counterpart was verified. The
 * absence is the honest output — see the note in `lib/assets.ts`.
 */

import { getAsset } from '@/lib/assets';
import type { TokenizedQuote } from '@/lib/types';

const NEW_TAB_HINT = 'opens bitget.com in a new tab';

const PRICE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Coarse freshness, matching the snapshot panel. Never claims precision it lacks. */
function relativeFrom(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * The tappable badge, for the research card.
 *
 * Renders `null` for an instrument with no verified counterpart, and for any
 * ticker the app does not cover (a reader can type one).
 */
export function BitgetCounterpart({
  ticker,
  tokenized,
}: {
  ticker: string;
  tokenized?: TokenizedQuote | null;
}) {
  const asset = getAsset(ticker);
  if (!asset?.bitget) return null;

  const { symbol, url } = asset.bitget;

  // Only ever display a price that is provably for *this* instrument's pair.
  // If the venue answered with a different market, showing it here would put
  // an unrelated number under this ticker — the one error a reader cannot see.
  const priced = tokenized && tokenized.pair === asset.bitget.pair ? tokenized : null;

  const change = priced?.change24hPercent ?? null;
  const changeTone = change === null ? '' : change > 0 ? 'text-pos' : change < 0 ? 'text-neg' : '';
  const freshness = priced ? relativeFrom(priced.asOf) : null;

  return (
    <div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={
          `${ticker} has a tokenized counterpart on Bitget: ${symbol}, which trades 24/7.` +
          (priced
            ? ` Currently ${PRICE.format(priced.price)} on that market. This is a separate tokenized instrument, not a share.`
            : '') +
          ` ${NEW_TAB_HINT}.`
        }
        className="group inline-flex min-h-[36px] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-accent-cyan/30 bg-accent-cyan/[0.07] px-2.5 py-1.5 transition hover:border-accent-cyan/55 hover:bg-accent-cyan/[0.12]"
      >
        <span aria-hidden="true" className="font-mono text-xs text-slate-500">
          →
        </span>
        <span aria-hidden="true" className="font-mono text-xs font-bold text-accent-cyan">
          {symbol}
        </span>

        {priced ? (
          <span aria-hidden="true" className="font-mono text-xs font-semibold tabular-nums text-slate-100">
            {PRICE.format(priced.price)}
          </span>
        ) : null}

        {priced && change !== null ? (
          <span aria-hidden="true" className={`font-mono text-xs tabular-nums ${changeTone}`}>
            {change > 0 ? '+' : ''}
            {change.toFixed(2)}% 24h
          </span>
        ) : null}

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

      {/*
        Shown only alongside a figure, because a figure is the only thing that
        can be mistaken for NVDA's own price. The provenance line names the
        venue and the instant; the caption says what the instrument is. Both
        are load-bearing, and neither is decoration.
      */}
      {priced ? (
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-slate-500">
          <span className="text-slate-400">{priced.source}</span>
          {freshness ? <> · {freshness}</> : null} · tokenized instrument, not a share — not{' '}
          {ticker}&rsquo;s price, and not an after-hours print for {ticker}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The text-only tag, for the instrument chips.
 *
 * Not a link — see the note above about `<button>` nesting. The chip's tap
 * target stays "select this instrument", which is what a reader expects from a
 * row of selectable chips. It carries no price for the same reason: a figure
 * on a chip that means "pick me" reads as an offer.
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
