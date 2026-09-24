/**
 * Shared test fixtures and a `fetch` stub.
 *
 * Not application code — nothing in `src/app` or `src/lib` imports this, so it
 * is absent from the production build. It exists so the integration suite and
 * the route suite describe the *same* providers. Two suites with two private
 * copies of "what Finnhub returns" is how one of them quietly starts testing a
 * fiction the provider never sends.
 *
 * The seam is `globalThis.fetch`, not our own modules. Both the market adapter
 * and the AI provider call `fetch` directly, so one stub covers everything and
 * nothing that ships is replaced by a fake.
 *
 * Every response *shape* here is taken from the provider's published contract —
 * Finnhub's OpenAPI spec, Groq's chat-completions reference. The *values* are
 * fixtures. That distinction matters: these tests prove the pipeline handles the
 * shapes correctly, and prove nothing at all about what a live endpoint would
 * return today.
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

/**
 * A Bitget v2 spot-tickers response, in the venue's own envelope.
 *
 * Shape taken from Bitget's published v2 contract: a `code`/`msg`/`data`
 * envelope where `data` is an array of price rows, and — the detail that
 * matters for parsing — **every number is a string**.
 *
 * `rTSLA` is the pair here rather than `rNVDA` because the shared `REQUEST`
 * fixture is AAPL, which deliberately has no counterpart; tests that exercise
 * this path ask for an instrument that has one.
 *
 * The 24h open is what the change is derived from, so the fixture carries an
 * open that differs from `lastPr` by a known amount: +3.125%.
 */
export const TOKENIZED_BODY = {
  code: '00000',
  msg: 'success',
  requestTime: TIMESTAMP * 1000,
  data: [
    {
      symbol: 'rTSLAUSDT',
      lastPr: '412.50',
      open24h: '400.00',
      high24h: '415.00',
      low24h: '398.00',
      ts: String(TIMESTAMP * 1000),
    },
  ],
};

/**
 * Wrap a body the way Groq's OpenAI-compatible chat-completions endpoint does.
 *
 * The differences from other chat APIs are the ones that actually reach our
 * parser: content is `choices[0].message.content` — a plain string, not an
 * array of typed blocks — and there is no `stop_reason`, so a refusal arrives
 * as ordinary prose and is caught by validation rather than by a field.
 */
export function groqCompletion(text: string) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: TIMESTAMP,
    model: 'openai/gpt-oss-20b',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 900, completion_tokens: 220, total_tokens: 1_120 },
    system_fingerprint: 'fp_test',
  };
}

/**
 * A model answer that satisfies the strict schema.
 *
 * It is also a specification of the behaviour we want: the third reason
 * *interprets* the supplied headline rather than noting that one exists. A
 * fixture that merely counted headlines would quietly bless the weaker output.
 */
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
      'The one retrieved headline describes a product announcement, which supports the move without implying an earnings surprise.',
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
  /** Returned as the model message content. A string is used verbatim. */
  modelText?: string;
  /** HTTP status for the model call. Applies to every call. */
  providerStatus?: number;
  /**
   * HTTP statuses for successive model calls, consumed in order before
   * `providerStatus` applies. This is what makes the schema-rejection retry
   * observable: `[400, 200]` fails once and then succeeds.
   */
  providerStatusSequence?: number[];
  /** Body for a failing model call. Defaults to a schema-shaped error. */
  providerErrorBody?: unknown;
  /** Replaces the whole model response body, for malformed-shape tests. */
  providerBody?: unknown;
  /** Called with each model request body, in order, as it is sent. */
  onProviderRequest?: (body: Record<string, unknown>) => void;
  /** Make the market data call fail with this HTTP status. */
  marketStatus?: number;
  /** Raw body for a failing market call, when a specific payload matters. */
  marketErrorBody?: unknown;
  /**
   * Unix seconds to stamp the quote with, overriding the fixture's 14:00 EDT.
   *
   * Exists so the *session boundary* is testable end to end. The classifier's
   * unit tests cover `sessionFor` in isolation, but the sentence a reader
   * actually sees is assembled in `finnhub.ts` from the derived session and the
   * exchange's own status — and that sentence is where a mislabelled close used
   * to reach production.
   */
  quoteTimestamp?: number;
  /** What `/stock/market-status` reports for `session`, e.g. 'pre-market'. */
  exchangeSession?: string;
  /**
   * How the Bitget tokenized-ticker endpoint behaves.
   *
   *   - `'ok'`      — a well-formed payload (the default)
   *   - `'error'`   — a non-200 response
   *   - `'garbage'` — a 200 carrying something that is not a ticker payload
   *   - `'wrong'`   — a 200 for a *different* market than the one requested
   *   - `'throw'`   — the fetch itself rejects, as a blocked or slow host does
   *
   * `'wrong'` is the one worth having: it is the only failure that would put
   * an unrelated price under a ticker without looking like an error.
   */
  tokenized?: 'ok' | 'error' | 'garbage' | 'wrong' | 'throw';
};

/**
 * Replace `globalThis.fetch` for the duration of a test.
 *
 * Returns a restore function; call it from `afterEach` so a failing assertion
 * cannot leave the global stubbed for the next test.
 */
export function stubFetch(options: StubOptions = {}): () => void {
  const original = globalThis.fetch;
  const remaining = [...(options.providerStatusSequence ?? [])];

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
        ? options.quoteTimestamp === undefined
          ? QUOTE_BODY
          : { ...QUOTE_BODY, t: options.quoteTimestamp }
        : url.includes('/stock/profile2')
          ? PROFILE_BODY
          : url.includes('/company-news')
            ? NEWS_BODY
            : url.includes('/stock/market-status')
              ? options.exchangeSession === undefined
                ? MARKET_STATUS_BODY
                : { ...MARKET_STATUS_BODY, session: options.exchangeSession }
              : {};

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('groq.com')) {
      if (typeof init?.body === 'string') {
        options.onProviderRequest?.(JSON.parse(init.body) as Record<string, unknown>);
      }

      const status = remaining.length > 0 ? (remaining.shift() as number) : (options.providerStatus ?? 200);
      if (status !== 200) {
        return new Response(
          JSON.stringify(
            // The default names the schema, because a 400 that does is the one
            // the provider layer is allowed to retry. A test wanting a *fatal*
            // 400 must pass its own body.
            options.providerErrorBody ?? { error: { message: 'response_format json_schema is not supported' } },
          ),
          { status, headers: { 'content-type': 'application/json' } },
        );
      }

      const body = options.providerBody ?? groqCompletion(options.modelText ?? modelAnalysis());
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // The tokenized-equity venue. Keyless, and the only upstream here whose
    // failure is tolerated by design — so the stub models its failure modes
    // explicitly rather than leaning on the "unexpected fetch" throw below,
    // which the adapter would swallow and no test would ever see.
    if (url.includes('api.bitget.com')) {
      const mode = options.tokenized ?? 'ok';
      if (mode === 'error') {
        return new Response(JSON.stringify({ code: '40004', msg: 'bad request' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (mode === 'garbage') {
        return new Response(JSON.stringify({ code: '00000', msg: 'success', data: 'nope' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (mode === 'throw') {
        // A transport failure: DNS, TLS, a blocked egress rule, or the abort
        // timer. Modelled as a rejection because that is what the adapter's
        // catch block actually receives.
        throw new Error('simulated transport failure');
      }
      if (mode === 'wrong') {
        return new Response(
          JSON.stringify({
            ...TOKENIZED_BODY,
            data: [{ ...TOKENIZED_BODY.data[0], symbol: 'rSOMEONEELSEUSDT' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(TOKENIZED_BODY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}
