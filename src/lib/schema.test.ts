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
  findSessionMislabel,
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

  it('applies the session-label gate through the parsing wrapper too', () => {
    const raw = JSON.stringify(valid({ whatChanged: 'The after-hours print rose 1.75% on light volume.' }));
    assert.equal(parseAndValidateAnalysis(raw, 'AAPL').ok, false);
  });
});

/* ------------------------------------------- regular-session labelling rule */

describe('findSessionMislabel', () => {
  /*
   * The bug this rule exists for: the model wrote "Apple's after-hours print
   * rose 1.75%" from data that contains no after-hours print at all. The number
   * was right and the session was wrong.
   *
   * The rule is deliberately a heuristic rather than a ban on the vocabulary,
   * because telling the reader "this plan provides no after-hours quote" is the
   * honesty the product is built on. Both halves of that trade are pinned here:
   * assertions are caught, honest limitations are not.
   */

  it('catches a session label attached to a price or a move', () => {
    const assertions = [
      "Apple's after-hours print rose 1.75%.",
      'The after-hours price sits at $190.25.',
      'The stock gained 2% in after-hours trading.',
      'Shares moved sharply during extended-hours trading.',
      'The post-market move was the largest of the week.',
      'The pre-market quote implies a higher open.',
      'After-hours volume was unusually heavy.',
    ];

    for (const text of assertions) {
      assert.notEqual(findSessionMislabel(text), null, `should have caught: "${text}"`);
    }
  });

  it('accepts the honest limitation statements the app is built on', () => {
    const honest = [
      'This data plan provides no separate after-hours quote for US equities.',
      'The price is a regular-session print rather than an after-hours quote.',
      'Extended-hours trading is not reflected in this price.',
      'No after-hours print is available for this instrument.',
      'The move happened in the regular session, not in after-hours trading.',
      'This tool cannot show after-hours prices on its current data plan.',
      'The quote is the latest available print; extended-hours data is unavailable.',
    ];

    for (const text of honest) {
      assert.equal(findSessionMislabel(text), null, `should have permitted: "${text}"`);
    }
  });

  it('judges each sentence on its own', () => {
    // The subtle failure: a correct disclaimer in one sentence licensing an
    // assertion in the next. Sentence-level analysis is what stops that.
    const mixed =
      'This plan provides no after-hours quote. The after-hours print rose 1.75%.';

    const found = findSessionMislabel(mixed);
    assert.notEqual(found, null);
    assert.ok(found?.includes('1.75'));
  });

  it('does not fire on ordinary session words', () => {
    const clean = [
      'The regular session closed higher on above-average volume.',
      'The stock finished the day up 2.28% versus the previous close.',
      'Trading was quiet into the close with no obvious catalyst.',
    ];

    for (const text of clean) {
      assert.equal(findSessionMislabel(text), null, `should not have flagged: "${text}"`);
    }
  });

  it('returns null for empty and non-string input', () => {
    assert.equal(findSessionMislabel(''), null);
    assert.equal(findSessionMislabel(null as unknown as string), null);
  });
});

describe('validateAnalysis — the session-label gate', () => {
  const asserting = {
    whatChanged: "Apple's after-hours print rose 1.75% in a quiet session.",
  };

  it('rejects a regular-session price described as after-hours', () => {
    const result = validateAnalysis(valid(asserting), 'AAPL');

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        result.errors.some((error) => error.includes('after-hours')),
        'the error must name the rule that failed',
      );
    }
  });

  it('checks the reasons and the risks, not only whatChanged', () => {
    const reasons = valid().reasons;
    const risks = valid().risks;

    assert.equal(
      validateAnalysis(
        valid({ reasons: [reasons[0], reasons[1], 'The extended-hours move was unusually large.'] }),
        'AAPL',
      ).ok,
      false,
    );

    assert.equal(
      validateAnalysis(
        valid({ risks: [...risks.slice(0, 2), 'The post-market price may not hold.'] }),
        'AAPL',
      ).ok,
      false,
    );
  });

  it('permits the honest limitation in the same fields', () => {
    // The deterministic fallback says exactly this, so a gate that rejected it
    // would break the demo path — which is the path every judge without a key
    // sees.
    const result = validateAnalysis(
      valid({
        whatChanged:
          'The instrument closed higher on the session, on a print the data plan supplies as a regular-session close rather than a live extended-hours quote.',
      }),
      'AAPL',
    );

    assert.equal(result.ok, true);
  });

  it('lifts the rule when the snapshot genuinely carried the quote', () => {
    // The same text that is a false statement today would be a true one under a
    // data plan that supplies extended-hours prints, so the gate is conditional
    // on the data rather than permanent.
    const result = validateAnalysis(valid(asserting), 'AAPL', { afterHoursAvailable: true });

    assert.equal(result.ok, true);
  });

  it('applies by default, since the default data plan has no extended hours', () => {
    // Omitting the option must fail closed. A caller that forgets it should get
    // the strict behaviour, not the permissive one.
    assert.equal(validateAnalysis(valid(asserting), 'AAPL').ok, false);
  });
});
