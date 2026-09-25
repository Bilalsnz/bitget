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
 * ## Two casings, and they are not interchangeable
 *
 * This venue spells the same market two ways, and the difference cost a
 * production failure:
 *
 *   - **The API symbol is uppercase** — `RNVDAUSDT`. This is what the tickers
 *     endpoint matches rows on, and what CoinGecko records as the market's
 *     `base` (`base: "RNVDA", target: "USDT"`, `market: bitget`).
 *   - **The market URL is lowercase-`r`** — `bitget.com/spot/rNVDAUSDT`. The
 *     same CoinGecko record returns that URL beside the uppercase base, so both
 *     forms are attested and they genuinely differ.
 *
 * The canonical pair in `lib/assets.ts` is the *URL* form, because that is what
 * a reader sees and taps. The API form is derived here, at the request
 * boundary, by uppercasing — one place, one reason.
 *
 * The bug: this module queried and matched on the canonical form, so a live
 * response came back as `RNVDAUSDT`, matched nothing, and the badge showed no
 * price. `?probe=bitget` reported `no-matching-row` on the deployment while
 * every test passed, because **the fixture encoded the same wrong assumption**
 * — it carried `symbol: 'rTSLAUSDT'`, invented here rather than read from the
 * venue. A fixture that agrees with the code's mistake cannot catch it.
 *
 * So the match is now case-insensitive rather than exact-uppercase. The
 * evidence says uppercase, and uppercasing is what we send; but if the venue
 * ever answers in another casing, a case-insensitive comparison finds the row
 * where a second hardcoded spelling would quietly miss it again.
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

/**
 * Where a lookup stopped, for operators only.
 *
 * The production contract is `TokenizedQuote | null` and stays that way — the
 * reader gets a price or nothing, and never a reason. This type exists because
 * "no price" has six quite different causes and they are indistinguishable from
 * the outside: the endpoint could be unreachable, blocked by an egress rule,
 * answering with an error envelope, returning a different symbol, or returning
 * a price this module refuses. Diagnosing that from a missing number is
 * guesswork, and the one thing worse than an absent feature is an absent
 * feature nobody can explain.
 *
 * Reported through `/api/health?probe=bitget`. Every field here describes
 * public market data or a transport outcome; none of it is a credential,
 * because this module has no credential to leak.
 */
export type BitgetProbe =
  | {
      ok: true;
      quote: TokenizedQuote;
      httpStatus: number;
      rowCount: number;
      /** The venue's own spelling of the matched row, e.g. `RNVDAUSDT`. */
      venueSymbol: string | null;
    }
  | { ok: false; stage: BitgetFailureStage; httpStatus: number | null; detail: string };

export type BitgetFailureStage =
  /** The caller passed something that is not a pair — a bare ticker, say. */
  | 'rejected-pair'
  /** fetch() threw: DNS, TLS, timeout, blocked egress. */
  | 'transport'
  /** A response arrived, but not a 2xx. */
  | 'http'
  /** Body was not the documented `{ code, data[] }` envelope. */
  | 'envelope'
  /**
   * Envelope was fine; no row matched this symbol, compared case-insensitively.
   *
   * The comparison being case-insensitive matters: this stage is what a casing
   * mismatch reported as before the venue's uppercase spelling was known, and
   * it was indistinguishable from a genuinely absent market.
   */
  | 'no-matching-row'
  /** Row found; `lastPr` was missing, non-numeric or not positive. */
  | 'unusable-price';

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
  const probe = await probeTokenizedPair(pair);
  return probe.ok ? probe.quote : null;
}

/**
 * The same lookup, reporting where it stopped.
 *
 * One implementation behind both entry points on purpose: a probe with its own
 * copy of the parsing would be able to disagree with the code it is meant to be
 * diagnosing, which is the failure mode of every second implementation ever
 * written.
 */
export async function probeTokenizedPair(pair: string): Promise<BitgetProbe> {
  // Cheap guard against being handed a ticker by mistake. A pair that looks
  // like a bare equity symbol is a caller bug, and fetching it would price
  // something unrelated.
  //
  // Case-insensitive, because this guard is about *shape* — does it look like
  // an rStock pair at all — and not about which of the venue's two spellings
  // arrived. It still rejects `NVDA`, `rNVDA` and `rNVDAUSDC`, which are the
  // cases that would fetch some other market's price.
  if (!/^r[A-Z0-9]+USDT$/i.test(pair)) {
    return { ok: false, stage: 'rejected-pair', httpStatus: null, detail: `not a rStock/USDT pair: ${pair}` };
  }

  // The venue matches on the uppercase symbol; the canonical pair is the URL
  // form. See the header — these differ, and assuming otherwise blanked the
  // badge in production.
  const apiSymbol = pair.toUpperCase();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${BITGET_BASE}/api/v2/spot/market/tickers?symbol=${encodeURIComponent(apiSymbol)}`,
      { signal: controller.signal, headers: { accept: 'application/json' }, cache: 'no-store' },
    );

    if (!res.ok) {
      return {
        ok: false,
        stage: 'http',
        httpStatus: res.status,
        detail: `HTTP ${res.status} from the tickers endpoint`,
      };
    }

    const body = (await res.json()) as BitgetEnvelope;
    if (body?.code !== '00000' || !Array.isArray(body.data)) {
      return {
        ok: false,
        stage: 'envelope',
        httpStatus: res.status,
        // `code` and `msg` are short, non-sensitive status strings. Truncated
        // anyway: this is being shown to whoever opens the health route, and an
        // upstream body is not ours to echo at whatever length it likes.
        detail: `code=${String(body?.code).slice(0, 40)} msg=${String(body?.msg).slice(0, 80)}`,
      };
    }

    const rows = body.data as Record<string, unknown>[];
    // Case-insensitive on purpose. The evidence says the venue answers in
    // uppercase and that is what we send, but a second hardcoded spelling is
    // exactly what failed here — see the header.
    const row = rows.find(
      (t) => typeof t?.symbol === 'string' && t.symbol.toUpperCase() === apiSymbol,
    );
    if (!row) {
      return {
        ok: false,
        stage: 'no-matching-row',
        httpStatus: res.status,
        // Names what was asked for *and* what came back. The first version
        // reported only the former, which is why a casing mismatch was
        // indistinguishable from a genuinely absent market for as long as it
        // was — the one fact that would have identified it was the one fact
        // not printed. Symbols are public market data; sampled and truncated,
        // because an upstream body is not ours to echo at whatever length it
        // likes.
        detail:
          rows.length === 0
            ? `no rows returned for ${apiSymbol}`
            : `rows returned but none named ${apiSymbol}; venue symbols seen: ${rows
                .slice(0, 3)
                .map((t) => JSON.stringify(t?.symbol).slice(0, 30))
                .join(', ')}`,
      };
    }

    const price = num(row.lastPr);
    if (price === null || price <= 0) {
      return {
        ok: false,
        stage: 'unusable-price',
        httpStatus: res.status,
        detail: `lastPr=${JSON.stringify(row.lastPr).slice(0, 40)}`,
      };
    }

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
      ok: true,
      httpStatus: res.status,
      rowCount: rows.length,
      // What the venue itself calls this market, as it appeared in the matched
      // row. Reported because the two spellings differ here, and a probe that
      // withheld the venue's own would be unable to diagnose the mismatch that
      // produced this code.
      venueSymbol: typeof row.symbol === 'string' ? row.symbol : null,
      quote: {
        symbol: pair.replace(/USDT$/, ''),
        pair,
        price,
        change24hPercent,
        timestamp: hasTimestamp ? Math.floor((ms as number) / 1000) : null,
        asOf: hasTimestamp ? new Date(ms as number).toISOString() : null,
        source: DATA_SOURCE,
      },
    };
  } catch (err) {
    // Timeout, DNS failure, TLS error, blocked egress, malformed JSON — all
    // identical to the reader, all worth separating for an operator.
    return {
      ok: false,
      stage: 'transport',
      httpStatus: null,
      detail: `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}
