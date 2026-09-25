/**
 * Tests for the tokenized basis.
 *
 * The point of this module is one comparison, so the tests are mostly about
 * when it *refuses* to make it. Two of the inputs are real market numbers and
 * the arithmetic is trivial; what can actually go wrong is the module
 * computing a basis against the wrong reference and labelling it as though it
 * were the right one — a figure that looks completely ordinary on screen and
 * means something else. That is the failure this suite exists to catch.
 *
 * So the sessions here are built through the real `sessionFor`, not stubbed.
 * A test that hard-coded `phase: 'regular'` would prove the arithmetic and
 * nothing about the interaction that actually decides the outcome — which is
 * the same reasoning behind the end-to-end close tests in `bitget.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Quote, TokenizedQuote } from '../types';
import { basisPhrase, tokenizedBasis } from './basis';
import { sessionFor } from './session';

/** Mon 2026-09-14, 14:00 ET (EDT) — mid regular session. */
const MID_SESSION = Math.floor(Date.UTC(2026, 8, 14, 18, 0) / 1000);
/** Mon 2026-09-14, 16:00 ET — the closing auction print. */
const CLOSING_PRINT = Math.floor(Date.UTC(2026, 8, 14, 20, 0) / 1000);
/** The minute after, where genuine extended-hours prints begin. */
const AFTER_CLOSE = CLOSING_PRINT + 60;
/** Fri 2026-11-27, 13:00 ET (EST) — Black Friday, an early close. */
const HALF_DAY_CLOSE = Math.floor(Date.UTC(2026, 10, 27, 18, 0) / 1000);

/**
 * A complete `Quote` at a given instant. Built in full rather than cast from a
 * partial so the test cannot keep passing after the type gains a field the
 * basis secretly depends on.
 */
function quoteAt(unixSeconds: number, price: number): Quote {
  const session = sessionFor(unixSeconds);
  return {
    ticker: 'NVDA',
    price,
    previousClose: price,
    change: null,
    percent: null,
    open: null,
    high: null,
    low: null,
    timestamp: unixSeconds,
    asOf: new Date(unixSeconds * 1000).toISOString(),
    currency: 'USD',
    exchange: 'NASDAQ',
    session,
    afterHoursAvailable: false,
    movementBasis: 'test',
  };
}

function tokenizedAt(price: number): TokenizedQuote {
  return {
    symbol: 'rNVDA',
    pair: 'rNVDAUSDT',
    price,
    change24hPercent: null,
    timestamp: AFTER_CLOSE,
    asOf: new Date(AFTER_CLOSE * 1000).toISOString(),
    source: 'Bitget',
  };
}

describe('tokenizedBasis — the gap it is supposed to measure', () => {
  it('measures the tokenized market above the closing print', () => {
    // 412.50 against a 400.00 close is +3.125%.
    const basis = tokenizedBasis(tokenizedAt(412.5), quoteAt(CLOSING_PRINT, 400));

    assert.ok(basis, 'a regular-session reference must produce a basis');
    assert.equal(basis.position, 'above');
    assert.ok(Math.abs(basis.absolute - 12.5) < 1e-9);
    assert.ok(Math.abs(basis.percent - 3.125) < 1e-9);
    assert.equal(basis.referencePrice, 400);
    assert.equal(basis.referenceLabel, '16:00 EDT regular-session print');
  });

  it('measures a tokenized market trading below the print', () => {
    const basis = tokenizedBasis(tokenizedAt(388), quoteAt(CLOSING_PRINT, 400));

    assert.ok(basis);
    assert.equal(basis.position, 'below');
    // The magnitude is unsigned; the direction word carries the sign.
    assert.ok(Math.abs(basis.percent - -3) < 1e-9);
  });

  it('calls a gap inside the noise band level, not a direction', () => {
    // Half a basis point. The two legs are not sampled at the same instant and
    // the venues tick differently, so this is agreement rather than a signal —
    // and rendering "+0.00% above" would claim a precision neither leg has.
    const basis = tokenizedBasis(tokenizedAt(400.01), quoteAt(CLOSING_PRINT, 400));

    assert.ok(basis);
    assert.equal(basis.position, 'level');
    assert.equal(basisPhrase(basis), 'level with the 16:00 EDT regular-session print');
  });

  it('takes the percentage of the regular print, not of the tokenized price', () => {
    // The error worth pinning: dividing by the tokenized price is the same sign
    // and a smaller number, so it looks entirely plausible and is wrong. 12.50
    // over a 400.00 reference is 3.125%; over the tokenized 412.50 it is 3.03%.
    const basis = tokenizedBasis(tokenizedAt(412.5), quoteAt(CLOSING_PRINT, 400));

    assert.ok(basis);
    assert.ok(Math.abs(basis.percent - 3.125) < 1e-9, `expected 3.125%, got ${basis.percent}`);
    assert.equal(basis.percent.toFixed(2), '3.13');
  });

  it('names the early close on a half day, so the reference is never misread', () => {
    const basis = tokenizedBasis(tokenizedAt(412.5), quoteAt(HALF_DAY_CLOSE, 400));

    assert.ok(basis, 'a half-day close is still a regular-session print');
    assert.equal(basis.referenceLabel, '13:00 EST regular-session print');
    assert.equal(basisPhrase(basis).includes('16:00'), false);
  });
});

/**
 * The rule from the module header, which is the whole reason this suite exists.
 *
 * A basis is only meaningful against the regular session, because that is the
 * one print whose meaning is unambiguous. Every other session, and the answer
 * is nothing at all — not a differently-labelled comparison, not a fallback to
 * yesterday's close.
 */
describe('tokenizedBasis — it refuses rather than reinterprets', () => {
  it('is absent when the reference print is an extended-hours print', () => {
    const basis = tokenizedBasis(tokenizedAt(412.5), quoteAt(AFTER_CLOSE, 400));
    assert.equal(basis, null);
  });

  it('is absent mid-session, where the print is regular but is not the close', () => {
    // The case that makes `atRegularClose` worth having as its own field. A
    // 14:00 print is a regular-session print, so a rule written as "regular
    // session only" admits it — and then a gap measured *during* the session
    // carries the identical label, caption and heading as the since-the-close
    // move. On this desk a reader would take it for that every time.
    const basis = tokenizedBasis(tokenizedAt(412.5), quoteAt(MID_SESSION, 400));
    assert.equal(basis, null);
  });

  it('is absent when there was no tokenized quote to measure', () => {
    assert.equal(tokenizedBasis(null, quoteAt(CLOSING_PRINT, 400)), null);
    assert.equal(tokenizedBasis(undefined, quoteAt(CLOSING_PRINT, 400)), null);
  });

  it('is absent for a price that is not a price', () => {
    // Null, never zero. A zero basis is a claim that the two markets agree, and
    // these inputs support no claim at all.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        tokenizedBasis(tokenizedAt(bad), quoteAt(CLOSING_PRINT, 400)),
        null,
        `${bad} must not produce a basis`,
      );
    }
  });

  it('is absent when the reference price is unusable', () => {
    for (const bad of [0, -5, Number.NaN]) {
      assert.equal(
        tokenizedBasis(tokenizedAt(412.5), quoteAt(CLOSING_PRINT, bad)),
        null,
        `a reference of ${bad} must not produce a basis`,
      );
    }
  });
});

/**
 * The phrase, which is the part that travels.
 *
 * A basis figure copied into a group chat arrives without the card around it.
 * The phrase is what stops it reading as an after-hours move in the equity, so
 * the property to pin is that it always names its reference and never uses the
 * vocabulary of an equity's extended-hours print.
 */
describe('basisPhrase — the reference is never optional', () => {
  it('names the reference in every direction', () => {
    for (const price of [412.5, 388, 400]) {
      const basis = tokenizedBasis(tokenizedAt(price), quoteAt(CLOSING_PRINT, 400));
      assert.ok(basis);
      const phrase = basisPhrase(basis);
      assert.ok(
        phrase.includes('regular-session print'),
        `the phrase must name its reference, got: ${phrase}`,
      );
      assert.ok(phrase.includes('16:00 EDT'), `the phrase must name the time, got: ${phrase}`);
    }
  });

  it('never uses after-hours vocabulary for a tokenized figure', () => {
    for (const price of [412.5, 388, 400]) {
      const basis = tokenizedBasis(tokenizedAt(price), quoteAt(CLOSING_PRINT, 400));
      assert.ok(basis);
      const phrase = basisPhrase(basis).toLowerCase();
      for (const forbidden of ['after-hours', 'after hours', 'post-market', 'extended']) {
        assert.equal(
          phrase.includes(forbidden),
          false,
          `"${forbidden}" must never describe a tokenized basis, got: ${phrase}`,
        );
      }
    }
  });

  it('states the sign once, not twice', () => {
    const below = tokenizedBasis(tokenizedAt(388), quoteAt(CLOSING_PRINT, 400));
    assert.ok(below);
    // Not "-3.00% below", which says the same thing twice and reads as a stutter.
    assert.equal(basisPhrase(below), '3.00% below the 16:00 EDT regular-session print');
  });
});
