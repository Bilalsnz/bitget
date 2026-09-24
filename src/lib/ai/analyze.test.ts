/**
 * End-to-end tests for the analysis orchestrator.
 *
 * These exercise the real pipeline — market adapter → prompt → provider call →
 * structured parse → validation → mode selection — with `fetch` stubbed at the
 * network boundary. Stubbing at `fetch` rather than mocking our own modules is
 * deliberate: the provider calls `fetch` directly, so a single seam covers both
 * upstreams and nothing in our code is replaced by a fake. What is tested is
 * what ships.
 *
 * The fixtures and the stub live in `@/test-support/finnhub-stub` because the
 * route suite needs the identical providers. Two private copies of "what Groq
 * returns" is how one suite starts asserting against a fiction.
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

/** Every provider request body, in the order it was sent. */
let sent: Record<string, unknown>[] = [];

/**
 * Install the stub and record what the provider layer actually sends.
 *
 * Recording the outbound body is how the "no fabrication" rule gets tested from
 * the side that matters: it is not enough that the *output* avoids invented
 * numbers, the prompt has to carry the real ones in the first place.
 */
function stubWith(options: Parameters<typeof stubFetch>[0] = {}): void {
  restoreFetch = stubFetch({ ...options, onProviderRequest: (body) => sent.push(body) });
}

/** The user message of the nth provider request. */
function userMessage(index = 0): string {
  const messages = (sent[index]?.messages ?? []) as Array<{ role: string; content: string }>;
  return messages.find((m) => m.role === 'user')?.content ?? '';
}

/** The system message of the nth provider request. */
function systemMessage(index = 0): string {
  const messages = (sent[index]?.messages ?? []) as Array<{ role: string; content: string }>;
  return messages.find((m) => m.role === 'system')?.content ?? '';
}

beforeEach(() => {
  logged = [];
  sent = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  process.env.FINNHUB_API_KEY = 'test-market-key';
  // The stub matches on the provider host, and the provider host is a constant,
  // so there is nothing to pin here — but `AI_MODEL` must be cleared, or an
  // ambient value would change what the assertions about the request body see.
  delete process.env.AI_MODEL;
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
    delete process.env.GROQ_API_KEY;
    stubWith();

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.ok(result.modeReason.includes('No AI credential'));
    assert.equal(result.providerLabel, 'Deterministic demo engine');
    // Nothing was sent anywhere: no credential means no outbound call at all.
    assert.equal(sent.length, 0);
  });

  it('still grounds the demo analysis in real snapshot numbers', async () => {
    delete process.env.GROQ_API_KEY;
    stubWith();

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.ok(result.analysis.whatChanged.includes('$190.25'));
    assert.equal(validateAnalysis(result.analysis, 'AAPL').ok, true);
  });
});

describe('runAnalysis — live model', () => {
  it('returns live mode when the model produces valid output', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith();

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'live');
    assert.equal(result.analysis.verdict, 'BUY');
    assert.equal(result.analysis.confidence, 71);
    // The label names the provider and the model, so the card can say which
    // model produced the judgement without the reader visiting /api/health.
    assert.ok(result.providerLabel.includes('Groq'));
    assert.ok(result.providerLabel.includes('openai/gpt-oss-20b'));
    assert.ok(result.modeReason.includes('market snapshot'));
  });

  it('asks for structured output with the schema, at the configured model', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith();

    await runAnalysis(REQUEST, await snapshot());

    assert.equal(sent.length, 1);
    assert.equal(sent[0].model, 'openai/gpt-oss-20b');

    const format = sent[0].response_format as Record<string, unknown>;
    assert.equal(format.type, 'json_schema');
    const jsonSchema = format.json_schema as Record<string, unknown>;
    assert.equal(jsonSchema.strict, true);
    assert.ok(jsonSchema.schema, 'the request must carry the actual schema');
  });

  it('sends the real snapshot numbers rather than leaving the model to supply them', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith();

    await runAnalysis(REQUEST, await snapshot());
    const prompt = userMessage();

    // Every one of these is a figure from the quote fixture. If the prompt
    // stopped carrying them, the model would be free to recall them instead.
    for (const figure of ['190.25', '186.00', '191.10', '186.50', '2.28%']) {
      assert.ok(prompt.includes(figure), `prompt should carry the real figure ${figure}`);
    }
    // The session range is computed in our layer, not by the model.
    assert.ok(prompt.includes('Session range:'));
    // And the holding period and risk profile are part of the request.
    assert.ok(prompt.includes('1 month'));
    assert.ok(prompt.includes('Moderate'));
  });

  it('carries the retrieved headlines into the prompt', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith();

    await runAnalysis(REQUEST, await snapshot());
    const prompt = userMessage();

    assert.ok(prompt.includes('Apple announces a thing'));
    assert.ok(prompt.includes('Example Wire'));
  });

  it('tells the model not to invent a price when none was retrieved', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith();

    await runAnalysis(REQUEST, await snapshot());

    // The data plan supplies no extended-hours quote, and the prompt must say
    // so explicitly rather than leaving the model to assume one exists.
    assert.ok(userMessage().includes('A separate extended-hours quote is available: no'));
  });

  it('recovers a fenced JSON response', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ modelText: '```json\n' + modelAnalysis() + '\n```' });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'live');
  });
});

describe('runAnalysis — the price is never labelled as after-hours', () => {
  /**
   * The bug these pin: the model described a correct regular-session price as
   * an "after-hours print". The number was right and the session was wrong —
   * which is the more dangerous failure of the two, because a plausible figure
   * under a wrong label does not look like an error.
   *
   * Three layers, each asserted separately, because they fail independently:
   * the system prompt carries the rule, the data block carries it next to the
   * numbers it governs, and the final task line restates it.
   */
  async function livePrompt() {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith();
    await runAnalysis(REQUEST, await snapshot());
  }

  it('bans the wording in the system prompt', async () => {
    await livePrompt();
    const system = systemMessage();

    for (const banned of ['after-hours print', 'after-hours price', 'after-hours move', 'post-market']) {
      assert.ok(system.includes(banned), `system prompt must name the banned phrase "${banned}"`);
    }
    assert.ok(system.includes('regular-session'));
    assert.ok(system.includes('latest available print'));
  });

  it('still permits stating the limitation honestly', async () => {
    await livePrompt();
    const system = systemMessage();

    // The fix must not silence the honest caveat — only the mislabelling.
    assert.ok(
      system.includes('cannot') && system.includes('extended-hours trading'),
      'the prompt must keep allowing the honest limitation statement',
    );
  });

  it('puts the rule in the data block beside the prices it governs', async () => {
    await livePrompt();
    const prompt = userMessage();

    assert.ok(prompt.includes('REGULAR-SESSION move'));
    assert.ok(prompt.includes('LATEST AVAILABLE PRINT'));
    assert.ok(prompt.includes('move versus the previous close'));
  });

  it('restates it in the final task line', async () => {
    await livePrompt();
    const prompt = userMessage();

    assert.ok(
      prompt.includes('not an after-hours price'),
      'the last instruction the model reads must carry the constraint',
    );
  });

  it('carries the constraint in the schema descriptions', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith();
    await runAnalysis(REQUEST, await snapshot());

    const schema = (sent[0].response_format as Record<string, unknown>).json_schema as Record<string, unknown>;
    const properties = (schema.schema as Record<string, unknown>).properties as Record<string, { description: string }>;

    for (const field of ['whatChanged', 'reasons', 'risks']) {
      assert.ok(
        properties[field].description.includes('after-hours'),
        `${field} description must carry the vocabulary constraint`,
      );
    }
  });

  it('drops the constraint entirely if the data plan ever supplies the quote', async () => {
    // The rule is conditional on the same field the reader sees. If a data
    // source ever does provide an extended-hours print, the prohibition must
    // disappear rather than become a false statement of its own.
    stubWith();
    const snap = await snapshot();
    const withExtendedHours = { ...snap, quote: { ...snap.quote, afterHoursAvailable: true } };

    const { buildUserPrompt } = await import('./prompt');
    const prompt = buildUserPrompt(REQUEST, withExtendedHours);

    assert.ok(!prompt.includes('REGULAR-SESSION move'));
    assert.ok(!prompt.includes('not an after-hours price'));
  });
});

describe('runAnalysis — provider transport behaviour', () => {
  it('retries without the schema when the provider rejects the response format', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ providerStatusSequence: [400, 200] });

    const result = await runAnalysis(REQUEST, await snapshot());

    // The retry is invisible to the reader: they get a live analysis, not a
    // degraded card, because the fallback still asked for JSON.
    assert.equal(result.mode, 'live');
    assert.equal(sent.length, 2);
    assert.equal((sent[0].response_format as Record<string, unknown>).type, 'json_schema');
    assert.equal((sent[1].response_format as Record<string, unknown>).type, 'json_object');
  });

  it('does not retry a 400 that is unrelated to the schema', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ providerStatus: 400, providerErrorBody: { error: { message: 'model_not_found' } } });

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.equal(sent.length, 1, 'a genuine bad request must not be repeated');
  });

  it('degrades to demo when the credential is refused', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ providerStatus: 401, providerErrorBody: { error: { message: 'Invalid API Key' } } });

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.ok(result.modeReason.includes('unavailable'));
    // The provider's own words never reach the reader.
    assert.ok(!JSON.stringify(result).includes('Invalid API Key'));
  });

  it('degrades to demo when rate limited', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ providerStatus: 429 });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'demo');
  });

  it('calls a rate limit a rate limit, not an outage', async () => {
    // The two used to share a code, so the reader was told the engine "was
    // unavailable" when in fact it was answering fine and asking us to slow
    // down. On a free tier that is the most common reason anyone sees the demo
    // engine at all — and it is the one cause that is transient, expected, and
    // fixed by waiting. Reporting it as an outage made a working fallback read
    // as a broken product.
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ providerStatus: 429 });

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.ok(
      result.modeReason.includes('rate-limiting'),
      `a 429 must be described as rate limiting, got: ${result.modeReason}`,
    );
    // And still says which engine actually answered, which is the point of the
    // whole fallback. Naming the cause must not cost the disclosure.
    assert.equal(result.providerLabel, 'Deterministic demo engine');
    // The provider's own words stay server-side, as everywhere else.
    assert.ok(!JSON.stringify(result).includes('429'));
  });

  it('still calls a genuine outage an outage', async () => {
    // The split must not have swallowed the case it was split from.
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ providerStatus: 503 });

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.ok(result.modeReason.includes('unavailable'));
    assert.equal(result.modeReason.includes('rate-limiting'), false);
  });

  it('degrades to demo when the provider answers with something that is not JSON', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    restoreFetch = stubFetch();

    // Bypass the JSON helper so the body is genuinely unparseable.
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('groq.com')) {
        return new Response('<html>gateway error</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return original(input, init);
    }) as typeof fetch;

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'demo');
    assert.ok(result.modeReason.includes('unusable response'));
  });

  it('degrades to demo when the response carries no message content', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ providerBody: { choices: [] } });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'demo');
  });
});

describe('runAnalysis — model misbehaviour degrades to demo', () => {
  it('falls back when the model returns prose instead of JSON', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ modelText: 'I am not able to provide investment analysis.' });

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.ok(result.modeReason.includes('unusable response'));
    // The demo engine still produced a complete, valid card.
    assert.equal(validateAnalysis(result.analysis, 'AAPL').ok, true);
  });

  it('falls back when the model answers about the wrong ticker', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ modelText: modelAnalysis({ ticker: 'TSLA' }) });

    const result = await runAnalysis(REQUEST, await snapshot());

    assert.equal(result.mode, 'demo');
    assert.equal(result.analysis.ticker, 'AAPL', 'must not surface the wrong ticker');
  });

  it('falls back when the model returns an out-of-band confidence', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ modelText: modelAnalysis({ confidence: 940 }) });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'demo');
  });

  it('falls back when the model returns the wrong number of risks', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ modelText: modelAnalysis({ risks: ['Only one risk.'] }) });

    const result = await runAnalysis(REQUEST, await snapshot());
    assert.equal(result.mode, 'demo');
  });

  it('logs the failure detail server-side without exposing it to the user', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ modelText: modelAnalysis({ ticker: 'TSLA' }) });

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
    process.env.GROQ_API_KEY = 'test-groq-key';
    stubWith({ marketStatus: 503 });

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
    stubWith();
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
    stubWith();
    const snap = await snapshot();

    assert.equal(snap.quote.afterHoursAvailable, false);
    assert.ok(snap.notes.some((note) => note.includes('extended-hours quote')));
  });

  it('derives the session from the quote timestamp, not the wall clock', async () => {
    stubWith();
    const snap = await snapshot();

    assert.equal(snap.quote.session.phase, sessionFor(TIMESTAMP).phase);
    assert.equal(snap.quote.session.phase, 'regular');
  });
});
