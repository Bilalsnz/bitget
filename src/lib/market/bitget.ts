/**
 * Bitget tokenized-equity adapter.
 *
 * SERVER ONLY, and — unlike `finnhub.ts` — **keyless on purpose**. This reads
 * no environment variable and sends no credential, because Bitget's public
 * spot market endpoint needs none. That is the whole reason it is usable here:
 * it adds a second real data source to the desk without a second secret to
 * manage, leak or rotate.
 *
 * ## What this is, and what it is not
 *
 * Bitget lists tokenized US equities under an `r` prefix — NVDA trades as
 * `rNVDA`, paired against USDT. Those pairings are recorded in `lib/assets.ts`
 * and were read off live exchange data; this module prices them.
 *
 * The line this module exists to hold: **a tokenized price is not a print on
 * the underlying equity.** `rNVDA` is a separate instrument that tracks NVDA's
 * price. It is not a share, it carries no voting right and no dividend in the
 * way the equity does, and it trades on a crypto venue's order book rather
 * than on an exchange's tape. Nothing returned here may be labelled as NVDA's
 * price, NVDA's after-hours price, or an after-hours print of any kind. The
 * UI is responsible for that naming, and the reasoning is in
 * `components/BitgetCounterpart.tsx`.
 *
 * ## Why a tokenized price is interesting to an after-hours product
 *
 * This desk's central limitation is that its data plan cannot see extended
 * hours (see the header of `finnhub.ts`). Tokenized equities trade 24/7, so
 * while the US tape is closed this market is still producing prices. That
 * makes it a genuine second signal for the question this product asks — and it
 * is a *different* signal, not a substitute, which is exactly why the two are
 * labelled separately rather than merged into one "price".
 *
 * ## Failure is the expected case, and it is not an error
 *
 * The endpoint below could not be exercised from the environment this was
 * written in, so the module is built to assume nothing about it:
 *
 *   - any outcome other than a well-formed payload with a positive numeric
 *     price returns `null`, and `null` renders as *no tokenized price*;
 *   - it never throws, so a Bitget outage cannot take down a research card
 *     that has a perfectly good Finnhub quote behind it;
 *   - it never estimates, interpolates or carries over a previous value.
 *
 * The failure mode is therefore an absent feature, never a wrong number. That
 * asymmetry is deliberate: an absent price costs the reader nothing, and a
 * fabricated one is the bug this project exists to avoid.
 */

import type { TokenizedQuote } from '../types';

const BITGET_BASE = 'https://api.bitget.com';
const REQUEST_TIMEOUT_MS = 8_000;
const DATA_SOURCE = 'Bitget';

/** Bitget wraps every v2 response in this envelope. */
type BitgetEnvelope = {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
};

function num(input: unknown): number | null {
  const value = typeof input === 'string' ? Number(input) : input;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Price the tokenized counterpart of a US ticker.
 *
 * `pair` is the exchange pair from `lib/assets.ts` (e.g. `rNVDAUSDT`), not a
 * ticker — this module never constructs one, because a symbol built by string
 * concatenation is a guess, and a guessed symbol returns *some other market's*
 * price rather than an error.
 *
 * Returns `null` for every failure path. Callers must treat `null` as "this
 * deployment has no tokenized price for this instrument", not as zero.
 */
export async function fetchTokenizedQuote(pair: string): Promise<TokenizedQuote | null> {
  // Cheap guard against being handed a ticker by mistake. A pair that looks
  // like a bare equity symbol is a caller bug, and fetching it would price
  // something unrelated.
  if (!/^r[A-Z0-9]+USDT$/.test(pair)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${BITGET_BASE}/api/v2/spot/market/tickers?symbol=${encodeURIComponent(pair)}`,
      { signal: controller.signal, headers: { accept: 'application/json' }, cache: 'no-store' },
    );

    if (!res.ok) return null;

    const body = (await res.json()) as BitgetEnvelope;
    if (body?.code !== '00000' || !Array.isArray(body.data)) return null;

    // The tickers endpoint is documented to return a single-element array for
    // a `symbol` filter, but matching on the symbol is safer than trusting the
    // index: being handed another market's price is the one failure that would
    // be invisible to the reader.
    const row = (body.data as Record<string, unknown>[]).find((t) => t?.symbol === pair);
    if (!row) return null;

    const price = num(row.lastPr);
    if (price === null || price <= 0) return null;

    // The 24h change is *derived*, not read.
    //
    // Bitget publishes a `change24h` field, but its unit is ambiguous across
    // the API's own examples — a ratio (0.0182) and a percentage (1.82) are
    // not distinguishable from the value alone, and reading one as the other
    // is a 100x error that looks entirely plausible on screen. Rather than
    // guess, the change is computed from two prices whose meaning is not in
    // doubt: the 24h open and the last price.
    //
    // When the open is missing or zero there is no change to report, and the
    // field stays null. A blank is smaller than a wrong number.
    const open24h = num(row.open24h);
    const change24hPercent =
      open24h !== null && open24h > 0 ? ((price - open24h) / open24h) * 100 : null;

    // `ts` is milliseconds since epoch. Treated as optional: a price with no
    // timestamp is still a price, but the UI must then not imply freshness.
    const ms = num(row.ts);
    const hasTimestamp = ms !== null && ms > 0;

    return {
      symbol: pair.replace(/USDT$/, ''),
      pair,
      price,
      change24hPercent,
      timestamp: hasTimestamp ? Math.floor((ms as number) / 1000) : null,
      asOf: hasTimestamp ? new Date(ms as number).toISOString() : null,
      source: DATA_SOURCE,
    };
  } catch {
    // Timeout, DNS failure, TLS error, malformed JSON — all identical here,
    // and all mean the same thing to the reader: no tokenized price today.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
