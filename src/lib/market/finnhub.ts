/**
 * Finnhub market-data adapter.
 *
 * SERVER ONLY. This module reads `process.env.FINNHUB_API_KEY` and must never
 * be imported from a client component. The key is sent to Finnhub in a request
 * header (not the query string) so it cannot leak into a Referer, a proxy log
 * or a screenshot of a URL bar.
 *
 * ## On after-hours data — read this before changing anything
 *
 * Verified against Finnhub's own OpenAPI spec and live pricing table
 * (2026-09-13):
 *
 *   - The free tier has **no** extended-hours price endpoint. Every endpoint
 *     that could supply one — `/stock/candle`, `/stock/tick`, `/stock/bbo`,
 *     `/stock/bidask` — is marked "Premium Access Required", and stock candles
 *     have been premium since 2023. There is no free OHLC replacement either.
 *   - `/quote` is therefore regular-session data. Its documented fields are
 *     `o,h,l,c,pc,d,dp`; the `t` timestamp we rely on is present in Finnhub's
 *     own published sample response but is undocumented.
 *   - The undocumented `trade=true` query param has been reported to expose
 *     pre/post-market prints (GitHub issue #476) but is also reported to return
 *     stale quotes, and Finnhub has never documented it. We do not use it.
 *
 * So we do the only honest thing available:
 *   1. Take the price and timestamp exactly as given.
 *   2. Derive the session from *the timestamp itself* (see market/session.ts).
 *   3. Ask `/stock/market-status` — which IS free — what session the exchange
 *      reports right now, and say so when it disagrees with the quote.
 *   4. Set `afterHoursAvailable = false` and say so in the UI.
 *
 * We never synthesise an extended-hours print, and we never relabel a
 * regular-session price as an after-hours move.
 */

import { getAsset } from '../assets';
import { AppError, toAppError } from '../errors';
import { fetchTokenizedQuote } from './bitget';
import { movementBasisFor, sessionFor } from './session';
import type { Headline, MarketSnapshot, Quote, SessionPhase, TokenizedQuote } from '../types';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const REQUEST_TIMEOUT_MS = 8_000;
const DATA_SOURCE = 'Finnhub';

/* ------------------------------------------------------------------- utils */

/**
 * How the market credential appears to *this running process*.
 *
 * A boolean is not enough here. "Never set" and "set to an empty or
 * whitespace-only value" both stop the app fetching a price, but they have
 * different causes and different fixes — and they are indistinguishable from
 * the outside, because both surface as `MISSING_MARKET_KEY`. That ambiguity is
 * precisely the report an operator files after adding the variable and
 * redeploying: the app says the key is missing, and gives them no way to tell
 * which of the two they are looking at.
 *
 * Returns a word. Never the value, its length, or any prefix of it.
 */
export type MarketKeyStatus = 'absent' | 'empty' | 'present';

export function marketKeyStatus(): MarketKeyStatus {
  const raw = process.env.FINNHUB_API_KEY;
  if (raw === undefined || raw === null) return 'absent';
  return raw.trim() ? 'present' : 'empty';
}

function apiKey(): string {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) {
    // Only consulted on the failure path, so the happy path pays nothing.
    const status = marketKeyStatus();
    throw new AppError(
      'MISSING_MARKET_KEY',
      status === 'absent'
        ? 'FINNHUB_API_KEY is not present in this process environment.'
        : 'FINNHUB_API_KEY is present but empty or whitespace-only.',
    );
  }
  return key;
}

/** Exposed so the health route can report configuration without leaking values. */
export function hasMarketKey(): boolean {
  return marketKeyStatus() === 'present';
}

async function finnhubGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${FINNHUB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        // Header auth keeps the token out of URLs, logs and Referer headers.
        'X-Finnhub-Token': apiKey(),
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    // AbortError → timeout; anything else is transport-level.
    throw toAppError(err, 'MARKET_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    // Present but refused — NOT the same as absent, and it must not be reported
    // as absent. Both used to raise MISSING_MARKET_KEY, so an operator who had
    // already set the variable was told to go and set it: a loop with no exit,
    // because the one action the message suggested was the one they had just
    // taken. Finnhub's own message ("Invalid API key.") is kept in `detail`,
    // server-side, and never reaches the browser.
    throw new AppError(
      'MARKET_KEY_REJECTED',
      `Finnhub refused the configured key (HTTP ${response.status}).`,
    );
  }
  if (response.status === 429) {
    throw new AppError('MARKET_RATE_LIMITED', 'Finnhub returned HTTP 429.');
  }
  if (!response.ok) {
    throw new AppError('MARKET_UNAVAILABLE', `Finnhub returned HTTP ${response.status}.`);
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new AppError('MARKET_BAD_RESPONSE', `Finnhub body was not JSON: ${String(err)}`);
  }
}

function num(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim() !== '') {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/* ---------------------------------------------------------------- endpoints */

type FinnhubQuote = {
  c?: unknown; // current / last price
  d?: unknown; // change vs previous close
  dp?: unknown; // percent change vs previous close
  h?: unknown; // session high
  l?: unknown; // session low
  o?: unknown; // session open
  pc?: unknown; // previous close
  t?: unknown; // unix seconds
};

type FinnhubProfile = {
  name?: unknown;
  ticker?: unknown;
  exchange?: unknown;
  currency?: unknown;
};

type FinnhubNewsItem = {
  headline?: unknown;
  source?: unknown;
  url?: unknown;
  datetime?: unknown;
};

type FinnhubMarketStatus = {
  exchange?: unknown;
  session?: unknown;
  holiday?: unknown;
};

/* -------------------------------------------------------------- public API */

/**
 * Fetch and normalise a quote.
 *
 * Finnhub signals "unknown symbol" by returning an all-zero payload rather
 * than an HTTP error, so a zero price with a zero timestamp is treated as
 * "no data" and surfaced as an unavailable market rather than as a real $0.00.
 */
export async function fetchQuote(ticker: string): Promise<Quote> {
  const raw = await finnhubGet<FinnhubQuote>('/quote', { symbol: ticker });

  const price = num(raw.c);
  const previousClose = num(raw.pc);
  const timestamp = num(raw.t);

  const noData =
    (price === null || price === 0) &&
    (timestamp === null || timestamp === 0) &&
    (previousClose === null || previousClose === 0);

  if (noData) {
    throw new AppError('MARKET_BAD_RESPONSE', `Finnhub returned an empty quote payload for ${ticker}.`);
  }

  // Prefer Finnhub's own change fields; recompute only when they are absent and
  // we have both operands. We never estimate a change we cannot derive.
  let change = num(raw.d);
  let percent = num(raw.dp);
  if ((change === null || percent === null) && price !== null && previousClose) {
    change = change ?? price - previousClose;
    percent = percent ?? ((price - previousClose) / previousClose) * 100;
  }

  const session = timestamp !== null && timestamp > 0
    ? sessionFor(timestamp)
    : // No timestamp: describe it as closed rather than implying live activity.
      sessionFor(0);

  const hasTimestamp = timestamp !== null && timestamp > 0;

  return {
    ticker,
    price: price ?? 0,
    previousClose,
    change,
    percent,
    open: num(raw.o),
    high: num(raw.h),
    low: num(raw.l),
    timestamp: hasTimestamp ? timestamp : null,
    asOf: hasTimestamp ? new Date((timestamp as number) * 1000).toISOString() : null,
    currency: 'USD',
    exchange: null,
    session,
    // The free tier gives us no way to substantiate an extended-hours print.
    afterHoursAvailable: false,
    movementBasis: movementBasisFor(session),
  };
}

/** Company profile. Optional enrichment — failure is non-fatal. */
export async function fetchProfile(ticker: string): Promise<Partial<Quote> & { name?: string }> {
  try {
    const raw = await finnhubGet<FinnhubProfile>('/stock/profile2', { symbol: ticker });
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined;
    const exchange = typeof raw.exchange === 'string' && raw.exchange.trim() ? raw.exchange.trim() : null;
    const currency = typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim() : 'USD';
    return { ...(name ? { name } : {}), exchange, currency };
  } catch {
    // Profile is decoration; a miss must not break the research card.
    return {};
  }
}

/** Recent company headlines. Failure is non-fatal and reported as a note. */
export async function fetchHeadlines(ticker: string, days = 5): Promise<Headline[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const raw = await finnhubGet<FinnhubNewsItem[]>('/company-news', {
    symbol: ticker,
    from: iso(from),
    to: iso(to),
  });

  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const headline = typeof item.headline === 'string' ? item.headline.trim() : '';
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      const source = typeof item.source === 'string' && item.source.trim() ? item.source.trim() : 'Unknown source';
      const datetime = num(item.datetime);
      if (!headline || !url || datetime === null) return null;
      return {
        headline,
        source,
        url,
        datetime: new Date(datetime * 1000).toISOString(),
      } satisfies Headline;
    })
    .filter((h): h is Headline => h !== null)
    // Newest first, capped so the prompt stays small and cheap.
    .sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime))
    .slice(0, 6);
}

/**
 * What session the exchange itself reports *right now*.
 *
 * This endpoint is free (verified — `premium: null` in Finnhub's spec) and it
 * is the only authoritative word we get on session state. Note carefully that
 * it describes the present moment, not the moment the quote was printed, so it
 * is never used to label a quote — only to explain a quote that is older than
 * the current session. That distinction is the whole point: it lets us answer
 * "what changed after the close?" honestly when our data plan cannot show an
 * after-hours price.
 *
 * Non-fatal by design — returns null on any failure.
 */
export async function fetchExchangeSession(): Promise<SessionPhase | null> {
  try {
    const raw = await finnhubGet<FinnhubMarketStatus>('/stock/market-status', { exchange: 'US' });
    const session = typeof raw.session === 'string' ? raw.session.trim().toLowerCase() : '';
    switch (session) {
      case 'pre-market':
        return 'pre-market';
      case 'regular':
        return 'regular';
      // Finnhub names the evening window "post-market"; we call it after-hours.
      case 'post-market':
        return 'after-hours';
      default:
        // Includes an explicit null, which the docs define as "market closed".
        return 'closed';
    }
  } catch {
    return null;
  }
}

/**
 * Assemble everything the research card needs for one ticker.
 *
 * Quote failure is fatal (we cannot analyse without a price); profile,
 * headlines and exchange session all degrade gracefully.
 */
export async function getMarketSnapshot(ticker: string): Promise<MarketSnapshot> {
  const notes: string[] = [];

  const quote = await fetchQuote(ticker);

  // The tokenized counterpart is a second, independent source, so it is
  // fetched alongside the rest rather than after them — a slow crypto venue
  // must not add its latency to a card that already has its price.
  //
  // It is also the only dependency here that is *allowed* to fail silently.
  // `fetchTokenizedQuote` returns null for every failure, and this desk is
  // complete without it: an instrument with no verified counterpart, or a
  // venue that did not answer, simply shows no tokenized price.
  const counterpart = getAsset(ticker)?.bitget?.pair;

  const [profile, headlines, exchangeSession, tokenized] = await Promise.all([
    fetchProfile(ticker),
    fetchHeadlines(ticker).catch(() => {
      notes.push('Recent headlines were unavailable from the data source for this request.');
      return [] as Headline[];
    }),
    fetchExchangeSession(),
    counterpart
      ? fetchTokenizedQuote(counterpart)
      : Promise.resolve(null as TokenizedQuote | null),
  ]);

  if (!quote.afterHoursAvailable) {
    notes.push(
      'The configured data source does not provide a separate extended-hours quote, so the price shown is the most recent available print.',
    );
  }

  // The case that actually matters for this product: the exchange is trading
  // extended hours *right now*, but the newest print our plan can see predates
  // that window. Saying so plainly is more useful than silence, and it is the
  // truthful version of "here is what happened after the close".
  if (
    exchangeSession === 'after-hours' &&
    quote.session.phase !== 'after-hours' &&
    quote.session.phase !== 'pre-market'
  ) {
    notes.push(
      `The US market is currently in its post-market session, but the most recent quote available on this data plan is from the ${quote.session.label.toLowerCase()} (${quote.session.etTime}). This deployment cannot show a live after-hours price.`,
    );
  } else if (exchangeSession === 'pre-market' && quote.session.phase !== 'pre-market') {
    notes.push(
      `The US market is currently in its pre-market session, but the most recent quote available on this data plan is from the ${quote.session.label.toLowerCase()} (${quote.session.etTime}). This deployment cannot show a live pre-market price.`,
    );
  } else if (exchangeSession === 'regular' && quote.session.phase !== 'regular') {
    notes.push(
      `The US market is open for regular trading right now, but the most recent quote this data plan returned is timestamped ${quote.session.etTime} (${quote.session.label.toLowerCase()}).`,
    );
  }

  return {
    quote: {
      ...quote,
      exchange: profile.exchange ?? null,
      currency: profile.currency ?? quote.currency,
    },
    headlines,
    exchangeSession,
    tokenized,
    dataSource: DATA_SOURCE,
    synthetic: false,
    notes,
  };
}
