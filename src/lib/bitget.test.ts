/**
 * Tests for the Bitget counterpart mapping in `lib/assets.ts`.
 *
 * This is a small, static mapping, and that is exactly the kind of data that
 * rots quietly: someone "fixes" a symbol from memory, a URL is hand-edited, an
 * instrument that was never verified gets a counterpart because the pattern
 * looked obvious. None of that would fail a typecheck, and all of it would be a
 * false product claim on a page judged by the company being claimed about.
 *
 * So the assertions here are less about behaviour than about provenance. A
 * counterpart has to be internally consistent (the symbol matches the ticker,
 * the URL matches the symbol) and the set has to match the list that was
 * actually verified. Adding an entry means deliberately updating this file,
 * which is the point: it should be a decision, not a diff that slips through.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ASSETS, getAsset } from './assets';

/**
 * The instruments whose Bitget counterpart was confirmed against live exchange
 * data on 2026-09-19, and the ones that were not.
 *
 * AAPL's absence is the interesting part and it is asserted on purpose. The
 * natural assumption — and the one the original request made — is that Apple,
 * being the most obvious US ticker, has an obvious `rAAPL`. It does not. That
 * symbol is held by an unrelated project, and no Apple rStock exists in the
 * issuer's lineup, so `AAPL → rAAPL` is precisely the plausible-looking wrong
 * answer this project must not print.
 */
const VERIFIED = [
  'TSLA',
  'NVDA',
  'MSFT',
  'AMZN',
  'META',
  'GOOGL',
  'NFLX',
  'AMD',
  'COIN',
  'MSTR',
  'SPY',
] as const;

const UNVERIFIED = ['AAPL'] as const;

describe('the Bitget counterpart mapping', () => {
  it('is populated for every instrument that was verified', () => {
    for (const ticker of VERIFIED) {
      const asset = getAsset(ticker);
      assert.ok(asset, `${ticker} should be a covered instrument`);
      assert.ok(asset.bitget, `${ticker} should carry a verified counterpart`);
    }
  });

  it('is absent for every instrument that was not', () => {
    for (const ticker of UNVERIFIED) {
      const asset = getAsset(ticker);
      assert.ok(asset, `${ticker} should still be a covered instrument`);
      assert.equal(
        asset.bitget,
        undefined,
        `${ticker} has no verified counterpart — do not add one without a listing to point at`,
      );
    }
  });

  it('has no entry outside the verified list', () => {
    const mapped = ASSETS.filter((asset) => asset.bitget).map((asset) => asset.ticker);
    assert.deepEqual(
      [...mapped].sort(),
      [...VERIFIED].sort(),
      'the set of instruments with a counterpart changed — confirm it against live data first',
    );
  });

  it('covers every instrument in exactly one of the two lists', () => {
    // Guards the case that actually bites: a new instrument added to the desk
    // with neither a verified counterpart nor an explicit "not verified" note.
    const accounted = new Set<string>([...VERIFIED, ...UNVERIFIED]);
    for (const asset of ASSETS) {
      assert.ok(
        accounted.has(asset.ticker),
        `${asset.ticker} is on the desk but is in neither list — verify it and record the result`,
      );
    }
    assert.equal(accounted.size, ASSETS.length);
  });
});

describe('each counterpart is internally consistent', () => {
  it('derives the symbol from the ticker, with no independent spelling', () => {
    // The symbol carries no information the ticker does not, so a mismatch can
    // only ever be a typo — `rNVDA` vs `RNVDA` vs `rNVDAX`.
    for (const asset of ASSETS) {
      if (!asset.bitget) continue;
      assert.equal(
        asset.bitget.symbol,
        `r${asset.ticker}`,
        `${asset.ticker}: symbol should be r + ticker`,
      );
    }
  });

  it('points at the canonical market page for that exact symbol', () => {
    for (const asset of ASSETS) {
      if (!asset.bitget) continue;
      assert.equal(
        asset.bitget.url,
        `https://www.bitget.com/spot/${asset.bitget.symbol}USDT`,
        `${asset.ticker}: URL should be the canonical market page for its own symbol`,
      );
    }
  });

  it('stores the traded pair, and it agrees with the symbol and the URL', () => {
    // `pair` is what a price request sends, so it is the one field here that
    // reaches a live endpoint. It is stored rather than built by appending
    // "USDT" to the symbol at the call site, because a pair assembled by string
    // concatenation is a guess — and a guessed pair comes back as *some other
    // market's* price rather than as an error, which is the one failure a
    // reader could not detect. Pinning all three spellings to each other means
    // a hand-edit to any one of them fails here rather than on the card.
    for (const asset of ASSETS) {
      if (!asset.bitget) continue;
      const { symbol, pair, url } = asset.bitget;

      assert.equal(pair, `${symbol}USDT`, `${asset.ticker}: pair should be symbol + USDT`);
      assert.equal(
        new URL(url).pathname,
        `/spot/${pair}`,
        `${asset.ticker}: the market page and the pair should name the same market`,
      );
    }
  });

  it('links nowhere but bitget.com over https', () => {
    for (const asset of ASSETS) {
      if (!asset.bitget) continue;
      const url = new URL(asset.bitget.url);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, 'www.bitget.com');
    }
  });

  it('never maps two instruments to the same symbol', () => {
    const symbols = ASSETS.flatMap((asset) => (asset.bitget ? [asset.bitget.symbol] : []));
    assert.equal(new Set(symbols).size, symbols.length);
  });
});
