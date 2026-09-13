/**
 * Tests for the deterministic demo engine.
 *
 * The most important test in this file is the first one: the demo engine's
 * output must pass the *same* validator that gates model output. That is what
 * makes "one contract, one validator" true rather than aspirational — if the
 * fallback ever drifted into producing four risks or a 600-character summary,
 * these tests would catch it before a user saw it.
 *
 * The rest guard the engine's honesty properties: it cites only numbers it was
 * given, and it never claims to have read news it did not retrieve.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sessionFor } from '../market/session';
import { validateAnalysis } from '../schema';
import type { MarketSnapshot, Quote, ResearchRequest } from '../types';
import { buildFallbackAnalysis } from './fallback';

/** Monday 2026-09-14, 14:00 ET — inside the regular session. */
const TIMESTAMP = Math.floor(Date.UTC(2026, 8, 14, 18, 0) / 1000);

const REQUEST: ResearchRequest = { ticker: 'AAPL', holdingPeriod: '1m', risk: 'Moderate' };

function snapshot(
  quoteOverrides: Partial<Quote> = {},
  snapshotOverrides: Partial<MarketSnapshot> = {},
): MarketSnapshot {
  const quote: Quote = {
    ticker: 'AAPL',
    price: 190,
    previousClose: 186,
    change: 4,
    percent: 2.15,
    open: 187,
    high: 191,
    low: 186.5,
    timestamp: TIMESTAMP,
    asOf: new Date(TIMESTAMP * 1000).toISOString(),
    currency: 'USD',
    exchange: 'NASDAQ',
    session: sessionFor(TIMESTAMP),
    afterHoursAvailable: false,
    movementBasis: 'Change versus the previous regular-session close.',
    ...quoteOverrides,
  };

  return {
    quote,
    headlines: [],
    exchangeSession: null,
    dataSource: 'Finnhub',
    synthetic: false,
    notes: [],
    ...snapshotOverrides,
  };
}

describe('buildFallbackAnalysis — output contract', () => {
  it('always produces output that passes the model-output validator', () => {
    const cases: MarketSnapshot[] = [
      snapshot(),
      snapshot({ percent: -4.8, change: -9.2, price: 176.8 }),
      snapshot({ percent: 0.12 }),
      snapshot({ percent: null, change: null, previousClose: null }),
      snapshot({ percent: -0.5 }),
      snapshot({ open: null, high: null, low: null }),
      snapshot({ timestamp: null, asOf: null }),
      snapshot({}, { headlines: [] }),
    ];

    for (const [index, sample] of cases.entries()) {
      const analysis = buildFallbackAnalysis(REQUEST, sample);
      const validation = validateAnalysis(analysis, 'AAPL');
      assert.equal(
        validation.ok,
        true,
        `case ${index} failed validation: ${validation.ok ? '' : validation.errors.join('; ')}`,
      );
    }
  });

  it('is deterministic — the same snapshot yields identical output', () => {
    const sample = snapshot();
    assert.deepEqual(
      buildFallbackAnalysis(REQUEST, sample),
      buildFallbackAnalysis(REQUEST, sample),
    );
  });

  it('reports the requested ticker rather than the one in the snapshot', () => {
    const analysis = buildFallbackAnalysis({ ...REQUEST, ticker: 'NVDA' }, snapshot());
    assert.equal(analysis.ticker, 'NVDA');
  });
});

describe('buildFallbackAnalysis — verdicts', () => {
  it('rates a strong gain as BUY for a moderate profile', () => {
    assert.equal(buildFallbackAnalysis(REQUEST, snapshot({ percent: 2.15 })).verdict, 'BUY');
  });

  it('rates a sharp loss as AVOID', () => {
    const analysis = buildFallbackAnalysis(REQUEST, snapshot({ percent: -4.8 }));
    assert.equal(analysis.verdict, 'AVOID');
    assert.equal(analysis.suggestedExposure, 'SKIP');
  });

  it('rates a flat session as HOLD', () => {
    assert.equal(buildFallbackAnalysis(REQUEST, snapshot({ percent: 0.2 })).verdict, 'HOLD');
  });

  it('shifts one notch down for a conservative profile', () => {
    // +2.15% is one notch up; conservative subtracts one, landing on HOLD.
    const analysis = buildFallbackAnalysis({ ...REQUEST, risk: 'Conservative' }, snapshot({ percent: 2.15 }));
    assert.equal(analysis.verdict, 'HOLD');
  });

  it('shifts one notch up for an aggressive profile', () => {
    const analysis = buildFallbackAnalysis({ ...REQUEST, risk: 'Aggressive' }, snapshot({ percent: -2.15 }));
    assert.equal(analysis.verdict, 'HOLD');
  });

  it('never exceeds MEDIUM exposure', () => {
    const analysis = buildFallbackAnalysis({ ...REQUEST, risk: 'Aggressive' }, snapshot({ percent: 9 }));
    assert.equal(analysis.suggestedExposure, 'MEDIUM');
  });

  it('caps a MEDIUM call at SMALL for a short holding period', () => {
    const strong = snapshot({ percent: 5 });
    assert.equal(
      buildFallbackAnalysis({ ...REQUEST, risk: 'Aggressive' }, strong).suggestedExposure,
      'MEDIUM',
    );
    assert.equal(
      buildFallbackAnalysis({ ...REQUEST, risk: 'Aggressive', holdingPeriod: 'short' }, strong)
        .suggestedExposure,
      'SMALL',
    );
  });
});

describe('buildFallbackAnalysis — honesty properties', () => {
  it('does not state a percentage when there is no prior close', () => {
    const analysis = buildFallbackAnalysis(
      REQUEST,
      snapshot({ percent: null, change: null, previousClose: null }),
    );

    assert.ok(analysis.whatChanged.includes('cannot be stated'));
    // No stray percentage sign anywhere in a card with no computable move.
    assert.ok(!analysis.whatChanged.includes('%'));
    assert.equal(analysis.verdict, 'HOLD');
  });

  it('never claims to have read the news it retrieved', () => {
    const withHeadlines = snapshot(
      {},
      {
        headlines: [
          {
            headline: 'Example Corp reports quarterly results',
            source: 'Example Wire',
            url: 'https://example.com/a',
            datetime: new Date(TIMESTAMP * 1000).toISOString(),
          },
        ],
      },
    );

    const analysis = buildFallbackAnalysis(REQUEST, withHeadlines);
    const newsReason = analysis.reasons.find((reason) => reason.includes('headline'));
    assert.ok(newsReason, 'expected a reason describing headline coverage');
    assert.ok(
      newsReason.includes('does not read'),
      'the engine must state that it does not interpret headline content',
    );
  });

  it('says so when no headlines were retrieved', () => {
    const analysis = buildFallbackAnalysis(REQUEST, snapshot());
    assert.ok(analysis.reasons.some((reason) => reason.includes('No recent company headlines')));
  });

  it('discloses that no separate extended-hours quote exists', () => {
    const analysis = buildFallbackAnalysis(REQUEST, snapshot({ afterHoursAvailable: false }));
    assert.ok(
      analysis.risks.some((risk) => risk.includes('most recent available print')),
      'expected a risk describing the missing extended-hours quote',
    );
  });

  it('cites the price it was given, verbatim', () => {
    const analysis = buildFallbackAnalysis(REQUEST, snapshot({ price: 123.45, previousClose: 120 }));
    assert.ok(analysis.whatChanged.includes('$123.45'));
    assert.ok(analysis.whatChanged.includes('$120.00'));
  });

  it('keeps confidence at or below the demo ceiling', () => {
    const analysis = buildFallbackAnalysis({ ...REQUEST, risk: 'Aggressive' }, snapshot({ percent: 25 }));
    assert.ok(analysis.confidence <= 82, `confidence ${analysis.confidence} exceeded the demo ceiling`);
  });
});
