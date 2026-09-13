/**
 * Tests for the model-output validation gate.
 *
 * This is the layer that decides whether anything a model produces is allowed
 * to reach a user, so the tests lean hard on the ways a model actually misbehaves:
 * prose instead of JSON, a plausible-but-wrong ticker, a confidence of 940, four
 * risks instead of three, markdown decoration around the payload.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  coerceConfidence,
  extractJsonObject,
  parseAndValidateAnalysis,
  sanitiseText,
  validateAnalysis,
} from './schema';

/** A minimal well-formed payload, spread over to build broken variants. */
function valid(overrides: Record<string, unknown> = {}) {
  return {
    ticker: 'AAPL',
    verdict: 'HOLD',
    confidence: 62,
    whatChanged: 'The instrument closed modestly higher on a quiet session with no obvious catalyst.',
    reasons: [
      'The move is small enough to read as ordinary drift rather than a directional signal.',
      'The last print finished mid-range, so neither side controlled the session.',
      'No recent headlines were retrieved, so this read rests on price structure alone.',
    ],
    risks: [
      'The next regular open can reprice this before any decision is acted on.',
      'The data plan supplies no separate extended-hours quote for this instrument.',
      'A single-name position carries company-specific risk that indexing would cushion.',
    ],
    suggestedExposure: 'SMALL',
    ...overrides,
  };
}

describe('sanitiseText', () => {
  it('strips markdown emphasis and list leaders', () => {
    assert.equal(sanitiseText('- **Strong** _move_ today'), 'Strong move today');
    assert.equal(sanitiseText('1. First item'), 'First item');
  });

  it('removes control characters but keeps normal punctuation', () => {
    // Built with fromCharCode rather than typed literally. A raw NUL or BEL
    // byte embedded in a source file is invisible in review, makes grep treat
    // the whole file as binary, and would silently decide whether this test
    // asserts anything at all.
    const withControls = `a${String.fromCharCode(0)}b${String.fromCharCode(7)}c`;
    assert.equal(sanitiseText(withControls), 'abc');
    assert.equal(sanitiseText('up 2.5% — solid'), 'up 2.5% — solid');
  });

  it('returns an empty string for non-strings', () => {
    assert.equal(sanitiseText(null), '');
    assert.equal(sanitiseText(42), '');
    assert.equal(sanitiseText({}), '');
  });
});

describe('coerceConfidence', () => {
  it('accepts the 0-100 integer form', () => {
    assert.equal(coerceConfidence(0), 0);
    assert.equal(coerceConfidence(73), 73);
    assert.equal(coerceConfidence(100), 100);
  });

  it('accepts a 0-1 probability and scales it', () => {
    assert.equal(coerceConfidence(0.62), 62);
    assert.equal(coerceConfidence(1), 100);
  });

  it('accepts a numeric string, with or without a percent sign', () => {
    assert.equal(coerceConfidence('73'), 73);
    assert.equal(coerceConfidence('73%'), 73);
  });

  it('rejects out-of-band values rather than clamping them', () => {
    // Clamping would turn a broken response into a confident-looking one.
    assert.equal(coerceConfidence(940), null);
    assert.equal(coerceConfidence(-5), null);
    assert.equal(coerceConfidence(Number.NaN), null);
    assert.equal(coerceConfidence(Number.POSITIVE_INFINITY), null);
  });

  it('rejects non-numeric input', () => {
    assert.equal(coerceConfidence('high'), null);
    assert.equal(coerceConfidence(null), null);
    assert.equal(coerceConfidence(undefined), null);
  });
});

describe('extractJsonObject', () => {
  it('parses a bare object', () => {
    assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
  });

  it('parses a fenced code block', () => {
    assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  });

  it('recovers an object wrapped in prose', () => {
    assert.deepEqual(extractJsonObject('Here is the analysis:\n{"a":1}\nHope that helps!'), {
      a: 1,
    });
  });

  it('returns null when there is no object to recover', () => {
    assert.equal(extractJsonObject('I cannot help with that.'), null);
    assert.equal(extractJsonObject(''), null);
    // An array is not the contract, even though it is valid JSON.
    assert.equal(extractJsonObject('[1,2,3]'), null);
  });
});

describe('validateAnalysis', () => {
  it('accepts a well-formed payload', () => {
    const result = validateAnalysis(valid(), 'AAPL');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.verdict, 'HOLD');
      assert.equal(result.value.confidence, 62);
      assert.equal(result.value.reasons.length, 3);
    }
  });

  it('normalises the verdict and exposure to upper case', () => {
    const result = validateAnalysis(valid({ verdict: 'hold', suggestedExposure: 'small' }), 'AAPL');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.verdict, 'HOLD');
      assert.equal(result.value.suggestedExposure, 'SMALL');
    }
  });

  it('rejects a response about a different ticker', () => {
    const result = validateAnalysis(valid({ ticker: 'TSLA' }), 'AAPL');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('TSLA')));
    }
  });

  it('rejects an unknown verdict', () => {
    assert.equal(validateAnalysis(valid({ verdict: 'STRONG_BUY' }), 'AAPL').ok, false);
  });

  it('rejects an unknown exposure', () => {
    assert.equal(validateAnalysis(valid({ suggestedExposure: 'ALL_IN' }), 'AAPL').ok, false);
  });

  it('rejects the wrong number of reasons or risks', () => {
    assert.equal(validateAnalysis(valid({ reasons: ['one', 'two'] }), 'AAPL').ok, false);
    assert.equal(validateAnalysis(valid({ risks: [] }), 'AAPL').ok, false);
  });

  it('rejects a bullet that is too short to be substantive', () => {
    const reasons = valid().reasons;
    assert.equal(
      validateAnalysis(valid({ reasons: [reasons[0], reasons[1], 'Up.'] }), 'AAPL').ok,
      false,
    );
  });

  it('rejects an over-long whatChanged', () => {
    assert.equal(validateAnalysis(valid({ whatChanged: 'x'.repeat(500) }), 'AAPL').ok, false);
  });

  it('rejects non-object input', () => {
    assert.equal(validateAnalysis('a string', 'AAPL').ok, false);
    assert.equal(validateAnalysis(null, 'AAPL').ok, false);
    assert.equal(validateAnalysis([1, 2], 'AAPL').ok, false);
  });

  it('stamps the expected ticker onto the validated value', () => {
    // The model omitting `ticker` should not produce an untickered analysis.
    const result = validateAnalysis(valid({ ticker: undefined }), 'NVDA');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.ticker, 'NVDA');
  });

  it('sanitises model formatting out of every text field', () => {
    const result = validateAnalysis(
      valid({
        whatChanged: '**AAPL** moved _sharply_ on the session.',
        reasons: [
          '# First reason about the move in detail',
          '## Second reason about the range in detail',
          '### Third reason about the volume in detail',
        ],
      }),
      'AAPL',
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(!result.value.whatChanged.includes('*'));
      assert.ok(!result.value.whatChanged.includes('_'));
      assert.ok(!result.value.reasons[0].startsWith('#'));
    }
  });
});

describe('parseAndValidateAnalysis', () => {
  it('parses and validates a fenced response end to end', () => {
    const raw = '```json\n' + JSON.stringify(valid()) + '\n```';
    const result = parseAndValidateAnalysis(raw, 'AAPL');
    assert.equal(result.ok, true);
  });

  it('fails cleanly on unparseable prose', () => {
    const result = parseAndValidateAnalysis('I am unable to provide that analysis.', 'AAPL');
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors[0].includes('parseable'));
  });
});
