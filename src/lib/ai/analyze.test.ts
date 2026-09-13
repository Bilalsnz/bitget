/**
 * End-to-end tests for the analysis orchestrator.
 *
 * These exercise the real pipeline — market adapter → prompt → model client →
 * structured parse → validation → mode selection — with `fetch` stubbed at the
 * network boundary. Stubbing at `fetch` rather than mocking our own modules is
 * deliberate: the Anthropic SDK uses `fetch` underneath, so a single seam
 * covers both providers and nothing in our code is replaced by a fake. What is
 * tested is what ships.
 *
 * The fixtures and the stub live in `@/test-support/finnhub-stub` because the
 * route suite needs the identical provider. Two private copies of "what
 * Finnhub returns" is how one suite starts asserting against a fiction.
 *
 * The cases that matter most are the degradations. A live call that works is
 * pleasant; a live call that returns *plausible garbage* is the scenario that
 * decides whether this product can be trusted, so it gets the most attention.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AppError } from '../errors';
import { sessionFor } from '../market/session';
import { validateAnalysis } from '../schema';
import { REQUEST, TIMESTAMP, modelAnalysis, stubFetch } from '@/test-support/finnhub-stub';
import { runAnalysis } from './analyze';

let restoreFetch: (() => void) | null = null;
const originalEnv = { ...process.env };
let logged: unknown[][] = [];
const originalError = console.error;

beforeEach(() => {
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  process.env.FINNHUB_API_KEY = 'test-market-key';
  // Pin the SDK's base URL so the stub below matches regardless of ambient
  // configuration. The SDK honours ANTHROPIC_BASE_URL, and a developer machine
  // or CI runner may legitimately have it pointed at a gateway — without this,
  // the suite would pass or fail based on the machine it runs on.
  process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  console.error = originalError;
  process.env = { ...originalEnv };
});

/** Build a snapshot through the real adapter, with the network stubbed. */
async function snapshot() {
  const { getMarketSnapshot } = await import('../market/finnhub');
  return getMarketSnapshot('AAPL');
}

/* -------------------------------------------------------------------- tests */

describe('runAnalysis — no AI credential', () => {
  it('answers with the labelled demo engine', async () => {
    delete process.env.AI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    restoreFetch = stubFetch();

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.ok(result.modeReason.includes('No AI credential'));
    assert.equal(result.providerLabel, 'Deterministic demo engine');
  });

  it('still grounds the demo analysis in real snapshot numbers', async () => {
    delete process.env.AI_API_KEY;
    restoreFetch = stubFetch();

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.ok(result.analysis.whatChanged.includes('$190.25'));
    assert.equal(validateAnalysis(result.analysis, 'AAPL').ok, true);
  });
});

describe('runAnalysis — live model', () => {
  it('returns live mode when the model produces valid output', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch();

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'live');
    assert.equal(result.analysis.verdict, 'BUY');
    assert.equal(result.analysis.confidence, 71);
    assert.ok(result.providerLabel.includes('claude-opus-5'));
    assert.ok(result.modeReason.includes('market snapshot'));
  });

  it('recovers a fenced JSON response', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch({ modelText: '```json\n' + modelAnalysis() + '\n```' });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'live');
  });
});

describe('runAnalysis — model misbehaviour degrades to demo', () => {
  it('falls back when the model returns prose instead of JSON', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch({ modelText: 'I am not able to provide investment analysis.' });

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.ok(result.modeReason.includes('unusable response'));
    // The demo engine still produced a complete, valid card.
    assert.equal(validateAnalysis(result.analysis, 'AAPL').ok, true);
  });

  it('falls back when the model answers about the wrong ticker', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch({ modelText: modelAnalysis({ ticker: 'TSLA' }) });

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.equal(result.analysis.ticker, 'AAPL', 'must not surface the wrong ticker');
  });

  it('falls back when the model returns an out-of-band confidence', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch({ modelText: modelAnalysis({ confidence: 940 }) });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'demo');
  });

  it('falls back when the model returns the wrong number of risks', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch({ modelText: modelAnalysis({ risks: ['Only one risk.'] }) });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'demo');
  });

  it('falls back when the model refuses the request', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch({ modelText: '', modelStopReason: 'refusal' });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'demo');
  });

  it('logs the failure detail server-side without exposing it to the user', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch({ modelText: modelAnalysis({ ticker: 'TSLA' }) });

    const result = await runAnalysis(REQUEST, await snapshot());

    // Developer detail went to the log...
    assert.ok(logged.length > 0, 'expected a server-side log entry');
    // ...and nowhere near the response.
    assert.ok(!JSON.stringify(result).includes('validation'));
    assert.ok(!result.modeReason.includes('TSLA'));
  });
});

describe('runAnalysis — market data failures are fatal', () => {
  it('propagates the market error rather than inventing a price', async () => {
    process.env.AI_API_KEY = 'test-ai-key';
    restoreFetch = stubFetch({ marketStatus: 503 });

    await assert.rejects(
      async () => runAnalysis(REQUEST, await snapshot()),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MARKET_UNAVAILABLE');
        return true;
      },
    );
  });
});

describe('getMarketSnapshot — integration', () => {
  it('assembles a snapshot from the stubbed provider', async () => {
    restoreFetch = stubFetch();
    const snap = await snapshot();

    assert.equal(snap.quote.ticker, 'AAPL');
    assert.equal(snap.quote.price, 190.25);
    assert.equal(snap.quote.previousClose, 186);
    assert.equal(snap.dataSource, 'Finnhub');
    assert.equal(snap.synthetic, false);
    assert.equal(snap.headlines.length, 1);
    assert.equal(snap.exchangeSession, 'regular');
  });

  it('never claims a separate extended-hours quote is available', async () => {
    restoreFetch = stubFetch();
    const snap = await snapshot();

    assert.equal(snap.quote.afterHoursAvailable, false);
    assert.ok(snap.notes.some((note) => note.includes('extended-hours quote')));
  });

  it('derives the session from the quote timestamp, not the wall clock', async () => {
    restoreFetch = stubFetch();
    const snap = await snapshot();

    assert.equal(snap.quote.session.phase, sessionFor(TIMESTAMP).phase);
    assert.equal(snap.quote.session.phase, 'regular');
  });
});
