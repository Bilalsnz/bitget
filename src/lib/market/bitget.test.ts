/**
 * Tests for the Bitget tokenized-equity adapter.
 *
 * The theme here is the *failure* paths, which is the opposite of most suites
 * in this project. Every other upstream is load-bearing: if Finnhub does not
 * answer, the desk has nothing to say. This one is optional by design, so the
 * behaviour that needs pinning is not "does it parse a good payload" — it is
 * "what does it do when the payload is bad, missing, or for the wrong market".
 *
 * The answer has to be `null` in every case, because `null` renders as no
 * tokenized price, and the alternative — a number that is wrong, stale, or
 * belongs to another instrument — is the failure a reader cannot detect.
 *
 * The `'wrong'` case is the one worth the most attention. A payload for a
 * different symbol is a *successful* HTTP response carrying a perfectly
 * plausible price; nothing about it looks like an error. If the adapter trusted
 * the array's first element instead of matching the symbol, that price would
 * appear under this ticker and no one would ever know.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { TIMESTAMP, stubFetch } from '@/test-support/finnhub-stub';
import { fetchTokenizedQuote } from './bitget';
import { getMarketSnapshot } from './finnhub';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

const PAIR = 'rTSLAUSDT';

describe('fetchTokenizedQuote — the happy path', () => {
  it('prices a verified pair and attributes it to the venue', async () => {
    restore = stubFetch();

    const quote = await fetchTokenizedQuote(PAIR);

    assert.ok(quote, 'a well-formed payload must produce a quote');
    assert.equal(quote.pair, PAIR);
    // The symbol is the pair minus its quote currency — what the badge shows.
    assert.equal(quote.symbol, 'rTSLA');
    assert.equal(quote.price, 412.5);
    assert.equal(quote.source, 'Bitget');
    assert.equal(quote.timestamp, TIMESTAMP);
    assert.equal(quote.asOf, new Date(TIMESTAMP * 1000).toISOString());
  });

  it('accepts the string numbers the venue actually sends', async () => {
    // Every numeric field in Bitget's payload is a JSON string. Parsing them as
    // numbers without coercion yields NaN, which would render as "$NaN" or
    // silently drop the figure — so this is worth its own assertion.
    restore = stubFetch();

    const quote = await fetchTokenizedQuote(PAIR);
    assert.equal(typeof quote?.price, 'number');
    assert.ok(Number.isFinite(quote?.price));
  });
});

describe('fetchTokenizedQuote — the 24h change is derived, not read', () => {
  it('computes the change from the 24h open and the last price', async () => {
    // 412.50 against an open of 400.00 is +3.125%.
    restore = stubFetch();

    const quote = await fetchTokenizedQuote(PAIR);
    assert.ok(quote);
    assert.ok(
      quote.change24hPercent !== null && Math.abs(quote.change24hPercent - 3.125) < 1e-9,
      `expected +3.125%, got ${quote.change24hPercent}`,
    );
  });

  it('reports no change when the venue omits the 24h open', async () => {
    // The alternative to a missing open is guessing the units of the venue's
    // own `change24h` field, and a ratio read as a percentage is a 100x error
    // that looks entirely plausible. A blank is the honest output.
    restore = stubFetch();
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: '00000',
          msg: 'success',
          data: [{ symbol: PAIR, lastPr: '412.50', ts: String(TIMESTAMP * 1000) }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    try {
      const quote = await fetchTokenizedQuote(PAIR);
      assert.equal(quote?.change24hPercent, null);
      // The price itself is still good — only the derived field is withheld.
      assert.equal(quote?.price, 412.5);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('fetchTokenizedQuote — every failure is a null, never a number', () => {
  it('returns null for a non-200 response', async () => {
    restore = stubFetch({ tokenized: 'error' });
    assert.equal(await fetchTokenizedQuote(PAIR), null);
  });

  it('returns null for a 200 that is not a ticker payload', async () => {
    restore = stubFetch({ tokenized: 'garbage' });
    assert.equal(await fetchTokenizedQuote(PAIR), null);
  });

  it('returns null when the payload is for a different market', async () => {
    // The dangerous one: a valid response, a real price, the wrong instrument.
    restore = stubFetch({ tokenized: 'wrong' });
    assert.equal(await fetchTokenizedQuote(PAIR), null);
  });

  it('returns null when the request itself throws', async () => {
    // Network down, DNS failure, TLS error, abort — all the same to a reader.
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('ENETUNREACH');
    }) as typeof fetch;

    try {
      assert.equal(await fetchTokenizedQuote(PAIR), null);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects a bare equity ticker instead of pricing something unrelated', async () => {
    // A caller passing `NVDA` where a pair belongs is a bug, and the venue
    // would answer it with some other market's price. The shape guard means
    // the request is never made — asserted by the stub, which throws on any
    // fetch this test does not expect.
    restore = stubFetch();

    for (const notAPair of ['NVDA', 'rNVDA', 'rNVDAUSDC', '', 'rNVDAUSDT ']) {
      assert.equal(
        await fetchTokenizedQuote(notAPair),
        null,
        `expected ${JSON.stringify(notAPair)} to be refused`,
      );
    }
  });
});

/**
 * The wiring, not the parsing: a snapshot for an instrument *with* a verified
 * counterpart should carry its tokenized price, and one without should be
 * completely unaffected. The second case is the common one — AAPL has no
 * counterpart, and most instruments would have no price even if they did.
 */
describe('getMarketSnapshot — the tokenized price rides along, or does not', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('attaches the tokenized price for an instrument that has a counterpart', async () => {
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch();

    const snapshot = await getMarketSnapshot('TSLA');

    assert.equal(snapshot.tokenized?.price, 412.5);
    assert.equal(snapshot.tokenized?.symbol, 'rTSLA');
    // The equity quote is untouched by it — the two are separate fields, and
    // merging them is how a tokenized price becomes a share price.
    assert.equal(snapshot.quote.price, 190.25);
    assert.equal(snapshot.quote.ticker, 'TSLA');
  });

  it('leaves an instrument with no verified counterpart untouched', async () => {
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch();

    // AAPL's absence is pinned in `lib/bitget.test.ts`; here it just means no
    // request is made and no figure appears.
    const snapshot = await getMarketSnapshot('AAPL');

    assert.equal(snapshot.tokenized, null);
    assert.equal(snapshot.quote.price, 190.25);
  });

  it('still returns a complete snapshot when the venue is down', async () => {
    // The property that matters most: a crypto venue having a bad day must not
    // take down a card whose actual job is to price a US equity.
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch({ tokenized: 'error' });

    const snapshot = await getMarketSnapshot('TSLA');

    assert.equal(snapshot.tokenized, null);
    assert.equal(snapshot.quote.price, 190.25);
    assert.equal(snapshot.synthetic, false);
    assert.ok(snapshot.headlines.length > 0, 'the rest of the snapshot is unaffected');
  });
});
