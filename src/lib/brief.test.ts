/**
 * Tests for the brief serialiser and the shape guard.
 *
 * The serialiser decides what leaves the app when a reader taps "Copy brief" or
 * "Share brief". That makes these tests about honesty as much as formatting: a
 * brief arrives in a group chat stripped of every banner and footnote the card
 * had, so the text itself has to carry the provenance line and the disclaimer.
 * If someone "tidies up" the output later, these fail.
 *
 * The guard is tested from both sides. It must accept everything the app really
 * produces — checked in one case by running the actual pipeline — and reject the
 * specific ways a stored entry goes bad: a missing `session`, a verdict outside
 * the enum, `headlines` that is not an array.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REQUEST } from '@/test-support/finnhub-stub';
import { sampleResult } from '@/test-support/result-fixture';
import { briefSummary, briefTitle, briefToText, isResearchResult } from './brief';
import { REGULAR_SESSION_NOTICE, RESEARCH_NOTICE } from './disclaimers';

const result = sampleResult();

/**
 * A deliberately broken payload.
 *
 * Typed as `unknown` at the call site because that is what the guard is for —
 * it exists to be handed things that do not match `ResearchResult`, and a test
 * that had to satisfy the compiler to construct its input could not express the
 * failures that matter.
 */
function broken(mutate: (draft: Record<string, unknown>) => void): unknown {
  const draft = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  mutate(draft);
  return draft;
}

/** Reach into a draft's snapshot.quote, which is where the interesting fields are. */
function quoteOf(draft: Record<string, unknown>): Record<string, unknown> {
  return (draft.snapshot as Record<string, unknown>).quote as Record<string, unknown>;
}

describe('isResearchResult', () => {
  it('accepts a complete result', () => {
    assert.equal(isResearchResult(result), true);
  });

  it('accepts what the real pipeline produces', async () => {
    // The fixture above is hand-built, and a hand-built fixture can drift into
    // agreeing with a guard that no longer matches reality. This runs the real
    // adapter and the real analyser instead, so the guard is checked against
    // the payload it will actually meet in production.
    const { stubFetch } = await import('@/test-support/finnhub-stub');
    const restore = stubFetch({});
    const original = {
      market: process.env.FINNHUB_API_KEY,
      ai: process.env.GROQ_API_KEY,
    };
    process.env.FINNHUB_API_KEY = 'test-market-key';
    // No AI credential, so the deterministic engine answers. The guard is about
    // the payload's shape, which is identical either way, and this keeps the
    // test off the network.
    delete process.env.GROQ_API_KEY;

    try {
      const { getMarketSnapshot } = await import('./market/finnhub');
      const { runAnalysis } = await import('./ai/analyze');

      const produced = await runAnalysis(REQUEST, await getMarketSnapshot('AAPL'));

      assert.equal(isResearchResult(produced), true);

      // And again after a JSON round trip. That is not belt-and-braces: the
      // guard never sees the in-memory object in production. It sees what the
      // API route serialised and the browser parsed, and what localStorage gave
      // back. A field that is `undefined` in memory but required by the guard
      // would vanish over the wire and take every card down — passing the first
      // assertion and failing this one is exactly that bug.
      const overTheWire: unknown = JSON.parse(JSON.stringify(produced));
      assert.equal(isResearchResult(overTheWire), true);
    } finally {
      restore();
      if (original.market === undefined) delete process.env.FINNHUB_API_KEY;
      else process.env.FINNHUB_API_KEY = original.market;
      if (original.ai === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = original.ai;
    }
  });

  it('rejects a missing quote session', () => {
    // The card reads `quote.session.label` directly. Without the guard this is
    // a thrown render that takes the whole desk down, not a blank field.
    const payload = broken((draft) => {
      delete quoteOf(draft).session;
    });

    assert.equal(isResearchResult(payload), false);
  });

  it('rejects a verdict outside the enum', () => {
    // `verdict` indexes a style map; an unknown value reads a property of
    // undefined and throws on the first style class.
    const payload = broken((draft) => {
      (draft.analysis as Record<string, unknown>).verdict = 'MAYBE';
    });

    assert.equal(isResearchResult(payload), false);
  });

  it('rejects an exposure outside the enum', () => {
    const payload = broken((draft) => {
      (draft.analysis as Record<string, unknown>).suggestedExposure = 'ALL_IN';
    });

    assert.equal(isResearchResult(payload), false);
  });

  it('rejects headlines that are not an array of headlines', () => {
    const payload = broken((draft) => {
      (draft.snapshot as Record<string, unknown>).headlines = [{ headline: 'no url or source' }];
    });

    assert.equal(isResearchResult(payload), false);
  });

  it('rejects a non-finite price', () => {
    // NaN survives JSON round-tripping as null, and null is not a price. Either
    // way the guard has to say no rather than render "$NaN".
    const payload = broken((draft) => {
      quoteOf(draft).price = null;
    });

    assert.equal(isResearchResult(payload), false);
  });

  it('rejects primitives, null and arrays', () => {
    for (const value of [null, undefined, 42, 'brief', [], [{ ...result }]]) {
      assert.equal(
        isResearchResult(value),
        false,
        `expected ${JSON.stringify(value) ?? String(value)} to be rejected`,
      );
    }
  });

  it('accepts an empty headlines list', () => {
    // A real and common outcome — the free news endpoint returns nothing for
    // many tickers, and the card has a whole branch for it.
    const payload = broken((draft) => {
      (draft.snapshot as Record<string, unknown>).headlines = [];
    });

    assert.equal(isResearchResult(payload), true);
  });
});

describe('briefTitle', () => {
  it('names the instrument, the stance and the horizon', () => {
    assert.equal(briefTitle(result), 'AAPL · HOLD · 1 month');
  });

  it('falls back to the raw period id when the label is unknown', () => {
    const odd = sampleResult({
      request: { ticker: 'AAPL', holdingPeriod: 'fortnight' as never, risk: 'Moderate' },
    });
    assert.equal(briefTitle(odd), 'AAPL · HOLD · fortnight');
  });
});

describe('briefSummary', () => {
  it('states the stance and disclaims it in the same breath', () => {
    const summary = briefSummary(result);

    assert.ok(summary.includes('AAPL'));
    assert.ok(summary.includes('HOLD'));
    assert.ok(summary.includes('62/100'));
    // The line most likely to be read on its own, so the disclaimer is in it.
    assert.ok(summary.includes(RESEARCH_NOTICE));
  });
});

describe('briefToText', () => {
  const text = briefToText(result);

  it('carries the regular-session notice verbatim', () => {
    // Asserted against the shared constant rather than a retyped string: there
    // is one wording, in `lib/disclaimers.ts`, and the copied brief has to
    // match the card exactly or the two drift apart.
    assert.ok(text.includes(REGULAR_SESSION_NOTICE));
  });

  it('carries the research-only notice verbatim', () => {
    assert.ok(text.includes(RESEARCH_NOTICE));
  });

  it('carries the evidence, not just the conclusion', () => {
    assert.ok(text.includes('$190.25'));
    assert.ok(text.includes('Data source: Finnhub'));
    // The exact instant, so a reader can check it against their broker.
    assert.ok(text.includes(`Quote timestamp: ${result.snapshot.quote.asOf}`));
    assert.ok(text.includes('Change vs previous close: +$4.25 (+2.28%)'));
  });

  it('names the session the print belongs to', () => {
    const { session } = result.snapshot.quote;
    assert.ok(text.includes(`Session at print: ${session.label} · ${session.etTime}, ${session.etDate}`));
  });

  it('calls the price a regular-session print, never an after-hours quote', () => {
    assert.ok(text.includes('Price (latest available regular-session print)'));
    assert.equal(/after-hours quote: /i.test(text), false);
  });

  it('labels the analysis source', () => {
    assert.ok(text.includes('Demo analysis · Deterministic demo engine'));
    assert.ok(text.includes(result.modeReason));
  });

  it('lists headlines as published, with their source', () => {
    assert.ok(text.includes('[Example Wire] Apple announces a modest buyback expansion'));
  });

  it('says so plainly when there are no headlines', () => {
    const quiet = sampleResult();
    const withNone = { ...quiet, snapshot: { ...quiet.snapshot, headlines: [] } };

    assert.ok(briefToText(withNone).includes('No headlines were retrieved from Finnhub'));
  });

  it('numbers the reasons and the risks separately', () => {
    // Both lists restart at 1 — a single running counter would make the risks
    // read as a continuation of the reasons.
    const reasonBlock = text.slice(text.indexOf('WHY'), text.indexOf('WHAT WOULD PROVE THIS WRONG'));
    const riskBlock = text.slice(text.indexOf('WHAT WOULD PROVE THIS WRONG'));

    assert.ok(reasonBlock.includes('1. '));
    assert.ok(reasonBlock.includes('3. '));
    assert.ok(riskBlock.includes('1. '));
    assert.ok(riskBlock.includes('3. '));
  });

  it('renders a missing number as unavailable rather than as zero', () => {
    // Zero is a real value and "unavailable" is not the same claim. A dashboard
    // that prints "$0.00" for a missing previous close is stating a fact it
    // does not have.
    const gap = sampleResult();
    const quote = {
      ...gap.snapshot.quote,
      previousClose: null,
      change: null,
      percent: null,
    };
    const out = briefToText({ ...gap, snapshot: { ...gap.snapshot, quote } });

    assert.ok(out.includes('Change vs previous close: unavailable (unavailable)'));
    assert.equal(out.includes('+$0.00'), false);
  });

  it('describes a live analysis as live', () => {
    const live = sampleResult({ mode: 'live', providerLabel: 'Groq · openai/gpt-oss-20b' });
    assert.ok(briefToText(live).includes('Live AI analysis · Groq · openai/gpt-oss-20b'));
  });

  it('never claims a trading capability', () => {
    // A blunt scan for the vocabulary this product must never acquire. The
    // notice legitimately contains the word "trading" in "No trading.", so the
    // check is for the offer rather than the words.
    for (const phrase of ['Buy now', 'Sell now', 'Place order', 'Connect Bitget', 'Deposit']) {
      assert.equal(text.includes(phrase), false, `brief must not offer "${phrase}"`);
    }
  });
});

describe('briefToText — the extended-hours branch', () => {
  it('does not claim a plan limitation the provider did not have', () => {
    const withExtended = sampleResult();
    const quote = { ...withExtended.snapshot.quote, afterHoursAvailable: true };
    const out = briefToText({ ...withExtended, snapshot: { ...withExtended.snapshot, quote } });

    assert.ok(out.includes('Extended-hours quote'));
    // The session notice describes *this plan's* limit, so it must not outlive
    // the limit: with a real extended-hours print it would be a false
    // statement, and it is dropped rather than left standing.
    assert.equal(out.includes(REGULAR_SESSION_NOTICE), false);
    // The research-only notice is not conditional — it describes what the
    // product is, not what one provider returned on one day.
    assert.ok(out.includes(RESEARCH_NOTICE));
  });
});
