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
import { fetchTokenizedQuote, probeTokenizedPair } from './bitget';
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

/**
 * The probe, which exists so "no price" can be explained.
 *
 * `fetchTokenizedQuote` collapses six quite different outcomes into one `null`,
 * and that is right for the reader — the badge shows a figure or it shows
 * nothing. But when the figure is missing on a deployment that should have one,
 * a bare `null` says only that something went wrong, and the candidates range
 * from "the venue is down" (nobody's fault) to "our parse is wrong about the
 * response shape" (entirely our fault, and invisible from the outside).
 *
 * So each stage is asserted separately here. A probe that reported `null` for
 * all of them would be no more useful than the thing it is diagnosing.
 *
 * This matters more than usual for this adapter, because the endpoint could not
 * be reached from the environment it was written in. The probe is the only way
 * to find out whether the response shape matches what this module expects, and
 * `'ok'` here is the path that has never run against the real venue.
 */
/**
 * The casing bug, which this suite could not see.
 *
 * In production the badge showed no price and `?probe=bitget` reported
 * `no-matching-row`: the venue answers with `RNVDAUSDT`, this module asked for
 * and matched on `rNVDAUSDT`, and every test here passed — because the fixture
 * carried the same invented spelling. The suite agreed with the code's
 * assumption, which is the one thing a fixture must never do.
 *
 * So these assert the two things that were invisible before: the spelling that
 * goes out on the wire, and that the returned row is matched regardless of how
 * the venue spells it. Both need `onBitgetRequest` — an assertion on the parsed
 * quote cannot see a wrong request, because a wrong request parses to nothing.
 */
describe('the venue spells it in uppercase, and the request must say so', () => {
  it('queries the uppercase symbol, not the URL spelling', async () => {
    // The canonical pair is the URL form, lowercase `r` — that is what a reader
    // taps and what the badge displays. The API form is not the same string.
    const sent: string[] = [];
    restore = stubFetch({ onBitgetRequest: (url) => sent.push(url) });

    await fetchTokenizedQuote(PAIR);

    assert.equal(sent.length, 1, 'exactly one upstream request');
    assert.ok(
      sent[0].includes('symbol=RTSLAUSDT'),
      `the request must carry the venue's uppercase symbol, got: ${sent[0]}`,
    );
    assert.equal(
      sent[0].includes('symbol=rTSLAUSDT'),
      false,
      'the lowercase-r form is the URL spelling and is not what this endpoint matches on',
    );
  });

  it('still reports the canonical pair and display symbol', async () => {
    // The casing fix must not leak into what a reader sees. `RTSLA` is not the
    // instrument's name on this desk; `rTSLA` is, and it is what the market URL
    // beside it uses.
    restore = stubFetch();

    const quote = await fetchTokenizedQuote(PAIR);

    assert.equal(quote?.pair, 'rTSLAUSDT');
    assert.equal(quote?.symbol, 'rTSLA');
  });

  it('matches the row even if the venue answers in another casing', async () => {
    // The evidence says uppercase, and uppercase is what we send. But a second
    // hardcoded spelling is precisely what failed here, so the comparison is
    // case-insensitive rather than a swap from one assumption to another.
    restore = stubFetch({ tokenizedSymbol: 'rtslausdt' });

    const quote = await fetchTokenizedQuote(PAIR);

    assert.equal(quote?.price, 412.5, 'a differently-cased row must still match');
    // And the reader still sees the canonical forms, not the venue's.
    assert.equal(quote?.pair, 'rTSLAUSDT');
    assert.equal(quote?.symbol, 'rTSLA');
  });

  it('reports the venue spelling and what it saw when nothing matches', async () => {
    // The diagnostic that would have shortened this bug to one request. The old
    // failure detail named only what was asked for, so a casing mismatch and a
    // genuinely absent market produced the same sentence.
    restore = stubFetch({ tokenized: 'ok' });
    const ok = await probeTokenizedPair(PAIR);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.venueSymbol, 'RTSLAUSDT');

    restore();
    restore = stubFetch({ tokenized: 'wrong' });
    const missing = await probeTokenizedPair(PAIR);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.stage, 'no-matching-row');
      assert.ok(
        missing.detail.includes('RSOMEONEELSEUSDT'),
        `the detail must name what the venue returned, got: ${missing.detail}`,
      );
      assert.ok(missing.detail.includes('RTSLAUSDT'), 'and what was asked for');
    }
  });
});

describe('probeTokenizedPair — naming the failure', () => {
  it('reports where the lookup stopped for each transport outcome', async () => {
    const cases = [
      { mode: 'error' as const, stage: 'http', httpStatus: 400 },
      { mode: 'garbage' as const, stage: 'envelope', httpStatus: 200 },
      { mode: 'wrong' as const, stage: 'no-matching-row', httpStatus: 200 },
      { mode: 'throw' as const, stage: 'transport', httpStatus: null },
    ];

    for (const { mode, stage, httpStatus } of cases) {
      restore = stubFetch({ tokenized: mode });
      const probe = await probeTokenizedPair(PAIR);
      restore();
      restore = null;

      assert.equal(probe.ok, false, `${mode} must not report ok`);
      if (probe.ok) continue;
      assert.equal(probe.stage, stage, `${mode} must be attributed to ${stage}`);
      assert.equal(probe.httpStatus, httpStatus);
      assert.ok(probe.detail.length > 0, `${mode} must carry a detail an operator can read`);
    }
  });

  it('names the row problem when a good envelope carries another market', async () => {
    // The distinction that earns the probe its keep: `wrong` is a *successful*
    // response, so "the venue is fine, we did not recognise the symbol" is a
    // very different conclusion from "the venue is down".
    restore = stubFetch({ tokenized: 'wrong' });
    const probe = await probeTokenizedPair(PAIR);

    assert.equal(probe.ok, false);
    if (probe.ok) return;
    assert.equal(probe.stage, 'no-matching-row');
    assert.ok(probe.detail.includes('none named'));
  });

  it('rejects something that is not a pair, without making a request', async () => {
    // No stub installed: if this reached the network the test would throw on
    // "Unexpected fetch", so the assertion doubles as proof nothing was called.
    const probe = await probeTokenizedPair('NVDA');

    assert.equal(probe.ok, false);
    if (probe.ok) return;
    assert.equal(probe.stage, 'rejected-pair');
  });

  it('reports the price and the row count on success', async () => {
    restore = stubFetch();
    const probe = await probeTokenizedPair(PAIR);

    assert.equal(probe.ok, true);
    if (!probe.ok) return;
    assert.equal(probe.httpStatus, 200);
    assert.equal(probe.rowCount, 1);
    assert.equal(probe.quote.price, 412.5);
  });

  it('agrees with the production entry point, always', async () => {
    // The probe and `fetchTokenizedQuote` share one implementation precisely so
    // they cannot disagree — a probe with its own parsing could report health
    // while the badge stayed blank, which is the worst possible outcome for a
    // diagnostic.
    for (const mode of ['ok', 'error', 'garbage', 'wrong', 'throw'] as const) {
      restore = stubFetch({ tokenized: mode });
      const probe = await probeTokenizedPair(PAIR);
      const quote = await fetchTokenizedQuote(PAIR);
      restore();
      restore = null;

      assert.equal(
        quote === null,
        !probe.ok,
        `${mode}: probe said ${probe.ok ? 'ok' : 'failed'} but the adapter returned ${quote === null ? 'null' : 'a quote'}`,
      );
    }
  });
});

/**
 * The evening case, end to end: the sentence that reaches the reader.
 *
 * This is the production bug of 2026-09-24, reproduced as a test. A card opened
 * in the evening showed a chip reading "After-hours · print timestamped 16:00
 * EDT" under a notice reading "Regular-session data only (not live
 * after-hours)" — because the quote endpoint stamps the closing auction print
 * at exactly 16:00, and the classifier treated the close as exclusive.
 *
 * The classifier's own tests cover `sessionFor` in isolation. These cover the
 * sentence `finnhub.ts` assembles from the derived session *and* the exchange's
 * own status, which is the thing a reader actually reads and the only place the
 * contradiction was visible. A unit test on the classifier alone would have
 * passed while the card contradicted itself.
 */
describe('a card built after the close', () => {
  /** 16:00 ET on Monday 2026-09-14, during EDT (UTC−4). */
  const CLOSING_PRINT = Math.floor(Date.UTC(2026, 8, 14, 20, 0) / 1000);

  // These tests need a configured market key, and leaving one set would make
  // later tests depend on declaration order. Cleaned up rather than assumed,
  // because "it happens to be last in the file" is not a property anyone
  // maintains on purpose.
  afterEach(() => {
    delete process.env.FINNHUB_API_KEY;
  });

  it('calls the closing print the regular session, not after-hours', async () => {
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch({ quoteTimestamp: CLOSING_PRINT, exchangeSession: 'after-hours' });
    const snapshot = await getMarketSnapshot('TSLA');

    assert.equal(snapshot.quote.session.phase, 'regular');
    assert.equal(snapshot.quote.session.label, 'Regular session');
    // The exact wording the reader saw, and the exact word that was wrong.
    assert.equal(snapshot.quote.session.etTime, '16:00 EDT');
  });

  it('describes the newest available print without contradicting itself', async () => {
    // The pre-market case from the reported card: the exchange is in
    // pre-market, the newest print this plan can see is yesterday's close.
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch({ quoteTimestamp: CLOSING_PRINT, exchangeSession: 'pre-market' });
    const snapshot = await getMarketSnapshot('TSLA');

    const note = snapshot.notes.find((n) => n.includes('pre-market session'));
    assert.ok(note, 'the pre-market note must be present');
    assert.ok(
      note.includes('from the regular session (16:00 EDT)'),
      `the note must name the regular session, got: ${note}`,
    );
    // The old wording, which called the close an after-hours print.
    assert.equal(note.includes('from the after-hours'), false);
  });

  it('still says post-market when the print really is post-close', async () => {
    // The fix must not have swallowed genuine extended-hours labelling: a
    // 16:01 print is after-hours and has to stay that way.
    const oneMinuteLater = CLOSING_PRINT + 60;
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch({ quoteTimestamp: oneMinuteLater, exchangeSession: 'after-hours' });
    const snapshot = await getMarketSnapshot('TSLA');

    assert.equal(snapshot.quote.session.phase, 'after-hours');
    assert.ok(snapshot.quote.movementBasis.includes('after the 16:00 ET close'));
  });

  /**
   * The basis, at the same level and for the same reason as the tests above.
   *
   * `basis.test.ts` drives the derivation directly. These drive it through the
   * real adapter, because the thing that decides whether a basis exists at all
   * is not the arithmetic — it is what `sessionFor` made of the print the
   * provider actually returned. A unit test with a hand-built `SessionInfo`
   * would pass while the assembled snapshot showed nothing.
   *
   * The magnitudes here are synthetic and deliberately unrelated: the tokenized
   * fixture (412.50) and the equity fixture (190.25) were written independently
   * as plausible-looking values, not as a coherent pair. So these assert on
   * presence and on the named reference, never on how big the gap is.
   */
  it('attaches a basis when the print is the close', async () => {
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch({ quoteTimestamp: CLOSING_PRINT, exchangeSession: 'after-hours' });
    const snapshot = await getMarketSnapshot('TSLA');

    assert.ok(snapshot.tokenized, 'the fixture answers, so there is a tokenized price');
    assert.ok(snapshot.tokenizedBasis, 'a closing print must produce a basis');
    assert.equal(snapshot.tokenizedBasis.referenceLabel, '16:00 EDT regular-session print');
    assert.equal(snapshot.tokenizedBasis.referencePrice, snapshot.quote.price);
  });

  it('attaches no basis when the print is mid-session, not the close', async () => {
    // The rule that `atRegularClose` exists for. A 14:00 print is a
    // regular-session print and a gap against it is a different quantity — so
    // the snapshot must carry no basis rather than one wearing the close's name.
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch({ quoteTimestamp: TIMESTAMP, exchangeSession: 'regular' });
    const snapshot = await getMarketSnapshot('TSLA');

    assert.equal(snapshot.quote.session.phase, 'regular');
    assert.equal(snapshot.quote.session.atRegularClose, false);
    assert.equal(snapshot.tokenizedBasis, null);
    // And the price is unaffected — only the derived field is withheld.
    assert.ok(snapshot.tokenized);
  });

  it('attaches no basis when the venue did not answer', async () => {
    process.env.FINNHUB_API_KEY = 'test-market-key';
    restore = stubFetch({ quoteTimestamp: CLOSING_PRINT, tokenized: 'error' });
    const snapshot = await getMarketSnapshot('TSLA');

    assert.equal(snapshot.tokenized, null);
    assert.equal(snapshot.tokenizedBasis, null);
    // The card is still complete without either.
    assert.equal(snapshot.quote.price, 190.25);
  });
});
