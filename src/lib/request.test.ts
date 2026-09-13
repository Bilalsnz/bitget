/**
 * Tests for the HTTP boundary.
 *
 * The distinction these tests protect is the one that was nearly lost: a
 * well-formed symbol we simply do not cover ("IBM") is a different situation
 * from something that is not a symbol at all ("!!!"). Telling someone that IBM
 * is not a ticker symbol would be both wrong and annoying, so the two paths are
 * asserted separately.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AppError, type ErrorCode } from './errors';
import { parseResearchRequest, parseTicker } from './request';

/** Run `fn`, returning the AppError code it threw (or a sentinel). */
function codeOf(fn: () => unknown): ErrorCode | 'NO_THROW' | 'NOT_APP_ERROR' {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.code : 'NOT_APP_ERROR';
  }
  return 'NO_THROW';
}

describe('parseTicker', () => {
  it('accepts a canonical ticker', () => {
    assert.equal(parseTicker('AAPL'), 'AAPL');
  });

  it('normalises case and surrounding whitespace', () => {
    assert.equal(parseTicker('aapl'), 'AAPL');
    assert.equal(parseTicker('  nvda  '), 'NVDA');
    assert.equal(parseTicker('msft.'), 'MSFT');
  });

  it('rejects input that is not symbol-shaped', () => {
    assert.equal(codeOf(() => parseTicker('')), 'INVALID_TICKER');
    assert.equal(codeOf(() => parseTicker('   ')), 'INVALID_TICKER');
    assert.equal(codeOf(() => parseTicker('!!!')), 'INVALID_TICKER');
    assert.equal(codeOf(() => parseTicker('a'.repeat(40))), 'INVALID_TICKER');
  });

  it('rejects non-string input', () => {
    assert.equal(codeOf(() => parseTicker(null)), 'INVALID_TICKER');
    assert.equal(codeOf(() => parseTicker(42)), 'INVALID_TICKER');
    assert.equal(codeOf(() => parseTicker(['AAPL'])), 'INVALID_TICKER');
  });

  it('distinguishes an unsupported symbol from a malformed one', () => {
    // IBM is a perfectly good ticker symbol; we just do not cover it.
    assert.equal(codeOf(() => parseTicker('IBM')), 'UNSUPPORTED_TICKER');
    assert.equal(codeOf(() => parseTicker('ZZZZ')), 'UNSUPPORTED_TICKER');
  });
});

describe('parseResearchRequest', () => {
  it('parses a complete request', () => {
    assert.deepEqual(
      parseResearchRequest({ ticker: 'tsla', holdingPeriod: '3m', risk: 'Aggressive' }),
      { ticker: 'TSLA', holdingPeriod: '3m', risk: 'Aggressive' },
    );
  });

  it('applies defaults for absent optional fields', () => {
    assert.deepEqual(parseResearchRequest({ ticker: 'AAPL' }), {
      ticker: 'AAPL',
      holdingPeriod: '1m',
      risk: 'Moderate',
    });
  });

  it('rejects an unknown holding period rather than defaulting it', () => {
    // Silently substituting a different horizon would change the answer the
    // user asked for without telling them.
    assert.equal(codeOf(() => parseResearchRequest({ ticker: 'AAPL', holdingPeriod: '10y' })), 'BAD_REQUEST');
  });

  it('rejects an unknown risk profile rather than defaulting it', () => {
    assert.equal(codeOf(() => parseResearchRequest({ ticker: 'AAPL', risk: 'YOLO' })), 'BAD_REQUEST');
  });

  it('rejects a body that is not an object', () => {
    assert.equal(codeOf(() => parseResearchRequest(null)), 'BAD_REQUEST');
    assert.equal(codeOf(() => parseResearchRequest('AAPL')), 'BAD_REQUEST');
    assert.equal(codeOf(() => parseResearchRequest(['AAPL'])), 'BAD_REQUEST');
  });

  it('propagates the ticker error code from the ticker field', () => {
    assert.equal(codeOf(() => parseResearchRequest({ ticker: 'IBM' })), 'UNSUPPORTED_TICKER');
  });
});

describe('AppError', () => {
  it('never puts developer detail in the response body', () => {
    const error = new AppError('MARKET_UNAVAILABLE', 'Finnhub returned HTTP 500 with body {"secret":"x"}');
    const body = error.toBody();

    assert.equal(body.error.message, 'Market data is temporarily unavailable. Try again in a moment.');
    assert.ok(!JSON.stringify(body).includes('secret'));
    assert.ok(!JSON.stringify(body).includes('Finnhub'));
  });

  it('maps each code to a distinct, non-empty message', () => {
    const codes: ErrorCode[] = [
      'INVALID_TICKER',
      'UNSUPPORTED_TICKER',
      'MISSING_MARKET_KEY',
      'MARKET_UNAVAILABLE',
      'MARKET_RATE_LIMITED',
      'MARKET_BAD_RESPONSE',
      'AI_UNAVAILABLE',
      'AI_BAD_RESPONSE',
      'BAD_REQUEST',
      'TIMEOUT',
      'NETWORK',
      'UNKNOWN',
    ];

    const messages = codes.map((code) => new AppError(code).toBody().error.message);
    for (const message of messages) assert.ok(message.length > 0);
    assert.equal(new Set(messages).size, codes.length, 'each code needs its own copy');
  });
});
