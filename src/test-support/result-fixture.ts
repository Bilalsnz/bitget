/**
 * A complete `ResearchResult` for the tests that exercise the brief serialiser
 * and the local history — neither of which needs a network, a model or a key.
 *
 * Shared rather than copied per suite, for the same reason the Finnhub/Groq
 * stub is shared: two private fixtures drift, and then one suite is asserting
 * against a shape the app no longer produces.
 *
 * Two decisions worth naming:
 *
 *   - It is typed as `ResearchResult`, so TypeScript fails the build if the real
 *     domain type grows a field this does not have. A fixture that can silently
 *     fall behind the thing it stands in for is worse than no fixture.
 *   - The session fields are produced by calling the real `sessionFor` and
 *     `movementBasisFor` rather than by typing plausible-looking strings. The
 *     after-hours labelling rules are read off exactly those strings, so a
 *     hand-written "16:00 EDT" here would be testing the fixture, not the app.
 */

import { movementBasisFor, sessionFor } from '@/lib/market/session';
import type { ResearchResult } from '@/lib/types';

import { TIMESTAMP } from './finnhub-stub';

/** Build a result. Every field is overridable so a test can break one thing. */
export function sampleResult(overrides: Partial<ResearchResult> = {}): ResearchResult {
  const session = sessionFor(TIMESTAMP);

  return {
    request: { ticker: 'AAPL', holdingPeriod: '1m', risk: 'Moderate' },
    snapshot: {
      quote: {
        ticker: 'AAPL',
        price: 190.25,
        previousClose: 186,
        change: 4.25,
        percent: 2.28,
        open: 187,
        high: 191.1,
        low: 186.5,
        timestamp: TIMESTAMP,
        asOf: new Date(TIMESTAMP * 1000).toISOString(),
        currency: 'USD',
        exchange: 'NASDAQ',
        session,
        // The truth for this data plan, and the case every labelling rule is
        // written for. A test that needs the other branch overrides it.
        afterHoursAvailable: false,
        movementBasis: movementBasisFor(session),
      },
      headlines: [
        {
          headline: 'Apple announces a modest buyback expansion',
          source: 'Example Wire',
          url: 'https://example.com/aapl-buyback',
          datetime: new Date(TIMESTAMP * 1000).toISOString(),
        },
      ],
      exchangeSession: 'closed',
      dataSource: 'Finnhub',
      synthetic: false,
      notes: [],
    },
    analysis: {
      ticker: 'AAPL',
      verdict: 'HOLD',
      confidence: 62,
      whatChanged:
        'The instrument finished the session higher, with the move concentrated in the final hour.',
      reasons: [
        'The advance held above the previous close into the bell rather than fading late.',
        'Volume was unremarkable, so the move reads as drift rather than a repricing.',
        'No headline in the retrieved set explains the size of the move.',
      ],
      risks: [
        'A single session of gains says little about the weeks that follow it.',
        'The next regular open can reprice this before any decision is acted on.',
        'This data plan supplies no separate extended-hours quote for the instrument.',
      ],
      suggestedExposure: 'SMALL',
    },
    mode: 'demo',
    providerLabel: 'Deterministic demo engine',
    modeReason: 'No AI credential is configured on this deployment.',
    ...overrides,
  };
}
