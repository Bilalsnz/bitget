/**
 * Shared test fixtures and a `fetch` stub.
 *
 * Not application code — nothing in `src/app` or `src/lib` imports this, so it
 * is absent from the production build. It exists so the integration suite and
 * the route suite describe the *same* provider. Two suites with two private
 * copies of "what Finnhub returns" is how one of them quietly starts testing a
 * fiction the provider never sends.
 *
 * The seam is `globalThis.fetch`, not our own modules. The Anthropic SDK uses
 * `fetch` underneath, so one stub covers both providers and nothing that ships
 * is replaced by a fake.
 */

import type { ResearchRequest } from '@/lib/types';

/** Monday 2026-09-14, 14:00 ET — comfortably inside the regular session. */
export const TIMESTAMP = Math.floor(Date.UTC(2026, 8, 14, 18, 0) / 1000);

export const REQUEST: ResearchRequest = { ticker: 'AAPL', holdingPeriod: '1m', risk: 'Moderate' };

/** The documented `/quote` fields. `t` is present in Finnhub's own sample. */
export const QUOTE_BODY = {
  c: 190.25,
  d: 4.25,
  dp: 2.28,
  h: 191.1,
  l: 186.5,
  o: 187.0,
  pc: 186.0,
  t: TIMESTAMP,
};

export const PROFILE_BODY = { name: 'Apple Inc', exchange: 'NASDAQ/NMS (GLOBAL MARKET)', currency: 'USD' };

export const NEWS_BODY = [
  {
    headline: 'Apple announces a thing',
    source: 'Example Wire',
    url: 'https://example.com/story',
    datetime: TIMESTAMP,
  },
];

export const MARKET_STATUS_BODY = { exchange: 'US', session: 'regular', holiday: null };

/** Wrap a body the way the Anthropic Messages API would return it. */
export function anthropicMessage(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/** A model answer that satisfies the strict schema. */
export function modelAnalysis(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ticker: 'AAPL',
    verdict: 'BUY',
    confidence: 71,
    whatChanged:
      'AAPL closed 2.28% higher at $190.25, holding the upper part of the session range into the close.',
    reasons: [
      'The 2.28% move is large enough to change the near-term picture rather than being drift.',
      'The last print finished near the session high, so buyers held control into the close.',
      'One recent headline was retrieved, though its content is not summarised here.',
    ],
    risks: [
      'The next regular open can reprice this before any decision is acted upon.',
      'The data plan supplies no separate extended-hours quote for this instrument.',
      'A single-name position carries company-specific risk that indexing would cushion.',
    ],
    suggestedExposure: 'MEDIUM',
    ...overrides,
  });
}

export type StubOptions = {
  /** Returned by the model call. A string is used as the text block verbatim. */
  modelText?: string;
  modelStopReason?: string;
  /** Make the market data call fail with this HTTP status. */
  marketStatus?: number;
  /** Raw body for a failing market call, when a specific payload matters. */
  marketErrorBody?: unknown;
};

/**
 * Replace `globalThis.fetch` for the duration of a test.
 *
 * Returns a restore function; call it from `afterEach` so a failing assertion
 * cannot leave the global stubbed for the next test.
 */
export function stubFetch(options: StubOptions = {}): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('finnhub.io')) {
      const status = options.marketStatus ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify(options.marketErrorBody ?? { error: 'boom' }), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }

      const body = url.includes('/quote')
        ? QUOTE_BODY
        : url.includes('/stock/profile2')
          ? PROFILE_BODY
          : url.includes('/company-news')
            ? NEWS_BODY
            : url.includes('/stock/market-status')
              ? MARKET_STATUS_BODY
              : {};

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('anthropic.com')) {
      void init;
      return new Response(
        JSON.stringify(anthropicMessage(options.modelText ?? modelAnalysis(), options.modelStopReason)),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}
