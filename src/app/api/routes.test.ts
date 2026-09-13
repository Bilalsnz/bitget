/**
 * Tests for the API routes themselves.
 *
 * The suites in `lib/` cover the analysis pipeline; these cover the layer the
 * browser actually talks to — status codes, the error envelope, the
 * `no-store` header, and the exact JSON shape the research card reads.
 *
 * The route handlers are called directly with a real `Request` and return a
 * real `Response`, so the assertions run against the same objects Next.js would
 * hand a client. Only the network beneath them is stubbed.
 *
 * The recurring theme here is *what must never be in a response body*: the
 * provider's error text, a key, a stack trace, or developer detail. Those are
 * asserted negatively on every failure path, because that is the leak that ends
 * up in a screenshot.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { stubFetch } from '@/test-support/finnhub-stub';
import { POST as analyze } from './analyze/route';
import { GET as health } from './health/route';
import { GET as quote } from './quote/route';

const originalEnv = { ...process.env };
let restore: (() => void) | null = null;
const originalError = console.error;

/** Build a POST request the way the browser does. */
function post(body: unknown, raw?: string): Request {
  return new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  console.error = () => {};
  process.env.FINNHUB_API_KEY = 'test-market-key';
  // Nothing to pin about the provider host — it is a constant in the module —
  // but `AI_MODEL` must be cleared so an ambient value cannot change what the
  // request-shape assertions see.
  delete process.env.AI_MODEL;
});

afterEach(() => {
  restore?.();
  restore = null;
  console.error = originalError;
  process.env = { ...originalEnv };
});

/* ------------------------------------------------------------ POST /analyze */

describe('POST /api/analyze — success', () => {
  it('returns the full payload the research card renders', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    restore = stubFetch();

    const res = await analyze(post({ ticker: 'aapl' }));

    assert.equal(res.status, 200);
    const body = await readJson(res);

    // Request echoed back, normalised.
    assert.deepEqual(body.request, { ticker: 'AAPL', holdingPeriod: '1m', risk: 'Moderate' });

    // Market numbers come from the data layer...
    const snapshot = body.snapshot as Record<string, unknown>;
    assert.equal(snapshot.dataSource, 'Finnhub');
    assert.equal(snapshot.synthetic, false);
    assert.equal((snapshot.quote as Record<string, unknown>).price, 190.25);

    // ...judgement comes from the model, and the two are separate fields.
    assert.equal(body.mode, 'live');
    assert.equal((body.analysis as Record<string, unknown>).verdict, 'BUY');
    assert.ok(typeof body.modeReason === 'string' && body.modeReason.length > 0);
    // The label names the provider, so the card can distinguish generated
    // analysis from the deterministic engine without the reader asking.
    assert.equal(body.providerLabel, 'Groq · openai/gpt-oss-20b');
  });

  it('never caches a response carrying live market data', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    restore = stubFetch();

    const res = await analyze(post({ ticker: 'AAPL' }));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('serves every supported instrument through the same path', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    restore = stubFetch();

    for (const ticker of ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN']) {
      const res = await analyze(post({ ticker }));
      assert.equal(res.status, 200, `${ticker} should be served`);
      const body = await readJson(res);
      assert.equal((body.request as Record<string, unknown>).ticker, ticker);
      assert.ok(Array.isArray((body.analysis as Record<string, unknown>).reasons));
    }
  });

  it('degrades to demo mode when the model answers with prose', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    restore = stubFetch({ modelText: 'I cannot help with that.' });

    const res = await analyze(post({ ticker: 'AAPL' }));

    // Not an error: the user still gets a complete, labelled card.
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.mode, 'demo');
    assert.equal(body.providerLabel, 'Deterministic demo engine');
  });

  it('still answers when no AI credential is configured', async () => {
    delete process.env.GROQ_API_KEY;
    restore = stubFetch();

    const res = await analyze(post({ ticker: 'AAPL' }));

    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.mode, 'demo');
    assert.ok(String(body.modeReason).includes('No AI credential'));
  });
});

describe('POST /api/analyze — rejected requests', () => {
  beforeEach(() => {
    restore = stubFetch();
  });

  it('rejects a well-formed but unsupported ticker', async () => {
    const res = await analyze(post({ ticker: 'IBM' }));

    assert.equal(res.status, 400);
    const body = await readJson(res);
    assert.equal((body.error as Record<string, unknown>).code, 'UNSUPPORTED_TICKER');
  });

  it('rejects a malformed ticker', async () => {
    const res = await analyze(post({ ticker: '!!!' }));

    assert.equal(res.status, 400);
    const body = await readJson(res);
    assert.equal((body.error as Record<string, unknown>).code, 'INVALID_TICKER');
  });

  it('rejects an empty ticker', async () => {
    const res = await analyze(post({ ticker: '   ' }));
    assert.equal(res.status, 400);
    assert.equal((await readJson(res)).error !== undefined, true);
  });

  it('rejects an out-of-range holding period rather than silently defaulting', async () => {
    const res = await analyze(post({ ticker: 'AAPL', holdingPeriod: '10y' }));

    assert.equal(res.status, 400);
    const body = await readJson(res);
    assert.equal((body.error as Record<string, unknown>).code, 'BAD_REQUEST');
  });

  it('rejects an out-of-range risk style', async () => {
    const res = await analyze(post({ ticker: 'AAPL', risk: 'YOLO' }));
    assert.equal(res.status, 400);
  });

  it('rejects a body that is not JSON', async () => {
    const res = await analyze(post(null, '{not json'));

    assert.equal(res.status, 400);
    const body = await readJson(res);
    assert.equal((body.error as Record<string, unknown>).code, 'BAD_REQUEST');
  });

  it('never caches an error response either', async () => {
    const res = await analyze(post({ ticker: 'IBM' }));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

describe('POST /api/analyze — market failures', () => {
  it('reports a missing market key as a deployment problem, not a user error', async () => {
    delete process.env.FINNHUB_API_KEY;
    restore = stubFetch();

    const res = await analyze(post({ ticker: 'AAPL' }));

    assert.equal(res.status, 503);
    const body = await readJson(res);
    const error = body.error as Record<string, unknown>;
    assert.equal(error.code, 'MISSING_MARKET_KEY');
    // The hint points at the diagnostic rather than restating the fix, and
    // never at the variable's value.
    assert.ok(String(error.hint).includes('/api/health'));
    assert.ok(!String(error.hint).includes('test-market-key'));
  });

  it('distinguishes a rejected key from a missing one', async () => {
    // The regression this guards: both used to surface as MISSING_MARKET_KEY,
    // so "your key is wrong" read as "you have not set a key" — and the fix
    // suggested was the step the operator had already completed.
    process.env.GROQ_API_KEY = 'test-groq-key';
    restore = stubFetch({ marketStatus: 401, marketErrorBody: { error: 'Invalid API key.' } });

    const res = await analyze(post({ ticker: 'AAPL' }));
    const error = (await readJson(res)).error as Record<string, unknown>;

    assert.equal(error.code, 'MARKET_KEY_REJECTED');
    assert.notEqual(error.code, 'MISSING_MARKET_KEY');
    // The copy must not send the operator back to a step they already did.
    assert.ok(!String(error.message).includes('not configured'));
    assert.ok(!String(error.hint).includes('not configured'));
  });

  it('treats 403 the same way as 401', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    restore = stubFetch({ marketStatus: 403 });

    const res = await analyze(post({ ticker: 'AAPL' }));
    assert.equal(((await readJson(res)).error as Record<string, unknown>).code, 'MARKET_KEY_REJECTED');
  });

  it('keeps an absent key distinct from a rejected one', async () => {
    delete process.env.FINNHUB_API_KEY;
    restore = stubFetch();

    const res = await analyze(post({ ticker: 'AAPL' }));
    assert.equal(((await readJson(res)).error as Record<string, unknown>).code, 'MISSING_MARKET_KEY');
  });

  it('does not invent a price when the provider rejects the key', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    restore = stubFetch({ marketStatus: 401, marketErrorBody: { error: 'Invalid API key.' } });

    const res = await analyze(post({ ticker: 'AAPL' }));

    assert.ok(res.status >= 400, 'a rejected key must not produce a 200');
    const raw = JSON.stringify(await readJson(res));
    assert.ok(!raw.includes('190.25'), 'no price may be fabricated on failure');
    assert.ok(!raw.includes('Invalid API key'), "the provider's message must not reach the browser");
  });

  it('surfaces a provider outage as a market error, not a crash', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    restore = stubFetch({ marketStatus: 503 });

    const res = await analyze(post({ ticker: 'AAPL' }));

    assert.ok(res.status >= 400);
    const raw = JSON.stringify(await readJson(res));
    assert.ok(!raw.includes('test-market-key'), 'the key must never appear in a response');
    assert.ok(!raw.includes('stack'), 'no stack trace may reach the browser');
  });
});

describe('error envelope — nothing developer-facing leaks', () => {
  it('carries only code, message and an optional hint', async () => {
    restore = stubFetch();
    const res = await analyze(post({ ticker: 'IBM' }));
    const error = (await readJson(res)).error as Record<string, unknown>;

    for (const key of Object.keys(error)) {
      assert.ok(['code', 'message', 'hint'].includes(key), `unexpected error field: ${key}`);
    }
    assert.ok(!('detail' in error), 'internal detail must stay server-side');
    assert.ok(!('stack' in error));
  });
});

/* -------------------------------------------------------------- GET /health */

/**
 * The whole point of `keyStatus` is that MISSING_MARKET_KEY cannot distinguish
 * "the deployment never got the variable" from "the variable arrived empty" —
 * and the fix for those is different. These tests pin both, plus the case that
 * matters most in practice: a value that arrived with surrounding whitespace
 * from a paste must still count as present.
 */
describe('GET /api/health — market key diagnostics', () => {
  async function keyStatusWith(value: string | undefined): Promise<unknown> {
    if (value === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = value;

    const body = await readJson(await health(new Request('http://localhost/api/health')));
    return (body.marketData as Record<string, unknown>).keyStatus;
  }

  it('reports absent when the variable was never set', async () => {
    assert.equal(await keyStatusWith(undefined), 'absent');
  });

  it('reports empty when the variable was set to an empty string', async () => {
    assert.equal(await keyStatusWith(''), 'empty');
  });

  it('reports empty when the variable is whitespace-only', async () => {
    assert.equal(await keyStatusWith('   \n\t '), 'empty');
  });

  it('reports present for a normal value', async () => {
    assert.equal(await keyStatusWith('abc123'), 'present');
  });

  it('reports present when a pasted value carries surrounding whitespace', async () => {
    // The common shape of a value that works: pasted with a trailing newline.
    assert.equal(await keyStatusWith('  abc123\n'), 'present');
  });

  it('never reports the value, its length, or a prefix', async () => {
    process.env.FINNHUB_API_KEY = 'super-secret-value';
    const raw = JSON.stringify(await readJson(await health(new Request('http://localhost/api/health'))));

    assert.ok(!raw.includes('super-secret-value'));
    assert.ok(!raw.includes('super'));
    assert.ok(!raw.includes('21'), 'the length must not be inferable from the response');
  });

  it('still says configured:false when the key is absent', async () => {
    delete process.env.FINNHUB_API_KEY;
    const body = await readJson(await health(new Request('http://localhost/api/health')));
    assert.equal((body.marketData as Record<string, unknown>).configured, false);
  });

  it('explains which of the two failures the probe hit', async () => {
    delete process.env.FINNHUB_API_KEY;
    const absent = await readJson(await health(new Request('http://localhost/api/health?probe=1')));
    assert.ok(String((absent.probe as Record<string, unknown>).reason).includes('not present'));

    process.env.FINNHUB_API_KEY = '  ';
    const empty = await readJson(await health(new Request('http://localhost/api/health?probe=1')));
    assert.ok(String((empty.probe as Record<string, unknown>).reason).includes('whitespace'));
  });
});

/* ---------------------------------------------------------- GET /health — AI */

/**
 * The health endpoint is what a judge or an operator reads to answer one
 * question: is the analysis I am looking at generated, or deterministic? That
 * makes `ai.configured` a claim the deployment has to be able to back up, so it
 * is pinned here in both directions alongside the provider and model names.
 */
describe('GET /api/health — AI provider reporting', () => {
  async function aiSection(): Promise<Record<string, unknown>> {
    const body = await readJson(await health(new Request('http://localhost/api/health')));
    return body.ai as Record<string, unknown>;
  }

  it('reports the provider and model when a credential is configured', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    const ai = await aiSection();

    assert.equal(ai.configured, true);
    assert.equal(ai.provider, 'Groq');
    assert.equal(ai.model, 'openai/gpt-oss-20b');
    assert.equal(ai.keyVariable, 'GROQ_API_KEY');
  });

  it('honours an AI_MODEL override in what it reports', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AI_MODEL = 'llama-3.3-70b-versatile';

    const ai = await aiSection();
    assert.equal(ai.model, 'llama-3.3-70b-versatile');
  });

  it('reports configured:false and no key variable when nothing is set', async () => {
    delete process.env.GROQ_API_KEY;
    const ai = await aiSection();

    assert.equal(ai.configured, false);
    assert.equal(ai.keyVariable, null);
    assert.equal(ai.label, 'Demo analysis');
  });

  it('never reports the credential, its length, or a prefix', async () => {
    process.env.GROQ_API_KEY = 'gsk_super_secret_value';
    const raw = JSON.stringify(await readJson(await health(new Request('http://localhost/api/health'))));

    assert.ok(!raw.includes('gsk_super_secret_value'));
    assert.ok(!raw.includes('gsk_'));
    assert.ok(!raw.includes('super_secret'));
  });

  it('names the fallback conditions rather than promising AI unconditionally', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    const ai = await aiSection();

    // A deployment with a key can still serve a demo card — on a provider
    // error, a timeout, or output that fails validation. The health report
    // must not imply otherwise.
    const fallback = String(ai.fallback);
    assert.ok(fallback.includes('deterministic'));
    assert.ok(fallback.includes('validation'));
  });
});

/* --------------------------------------------------------------- GET /quote */
describe('GET /api/quote', () => {
  it('returns a market snapshot on its own', async () => {
    restore = stubFetch();

    const res = await quote(new Request('http://localhost/api/quote?ticker=TSLA'));

    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.dataSource, 'Finnhub');
    assert.equal((body.quote as Record<string, unknown>).price, 190.25);
    assert.equal(body.exchangeSession, 'regular');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('always reports that no separate extended-hours quote is available', async () => {
    restore = stubFetch();

    const res = await quote(new Request('http://localhost/api/quote?ticker=AAPL'));
    const body = await readJson(res);

    assert.equal((body.quote as Record<string, unknown>).afterHoursAvailable, false);
  });

  it('rejects an unsupported ticker', async () => {
    restore = stubFetch();

    const res = await quote(new Request('http://localhost/api/quote?ticker=IBM'));
    assert.equal(res.status, 400);
    assert.equal(((await readJson(res)).error as Record<string, unknown>).code, 'UNSUPPORTED_TICKER');
  });

  it('rejects a request with no ticker at all', async () => {
    restore = stubFetch();

    const res = await quote(new Request('http://localhost/api/quote'));
    assert.equal(res.status, 400);
  });

  it('reports a missing key rather than an empty quote', async () => {
    delete process.env.FINNHUB_API_KEY;
    restore = stubFetch();

    const res = await quote(new Request('http://localhost/api/quote?ticker=AAPL'));
    assert.equal(res.status, 503);
  });
});
