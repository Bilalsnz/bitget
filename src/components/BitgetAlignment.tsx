/**
 * Bitget alignment.
 *
 * ## What this panel is, and what it deliberately is not
 *
 * The brief for this hackathon is a Bitget one, so the app should say plainly
 * where its subject matter meets Bitget's. It does that here — by explaining
 * the *rhythm* difference between the two markets, which is the whole reason a
 * desk named AfterHours exists — and by naming the tokenized counterpart each
 * instrument has on Bitget, on the cards where the instrument appears.
 *
 * ## Why the tickers in `assets.ts` are trustworthy and this code is not clever
 *
 * An earlier version of this panel named no symbols at all, on the grounds that
 * a mapping written from memory is a guess wearing a product fact's clothes.
 * That reasoning was right; the conclusion changed only because the mapping
 * stopped being written from memory. Every `bitget` entry in `lib/assets.ts` was
 * read off live exchange data — the symbol *and* the canonical market URL, so
 * neither can drift from a typo — and `bitget.test.ts` asserts the invariants
 * that keep it that way.
 *
 * The check earned its keep immediately: **AAPL has no tokenized counterpart on
 * Bitget.** The example everyone reaches for — `AAPL → rAAPL` — does not exist;
 * that symbol belongs to an unrelated project. So this panel states the coverage
 * rather than implying the pattern is total, and the app shows the counterpart
 * only where one was actually verified.
 *
 * ## The important limit
 *
 * The **mapping** is a static, dated list. A venue can list, delist or rename a
 * tokenized equity at any time and this page would not know, which is why it
 * carries the date it was verified.
 *
 * The **price** is not static. Since the desk began pricing the counterparts it
 * does call a Bitget endpoint — the public spot market endpoint, which needs no
 * account, no key and no credential of any kind, and returns a last-traded price
 * for one symbol. So the distinction this panel has to hold is no longer
 * "integration or not" but *which* integration: public market data, read-only,
 * versus an account or a trading API, of which there is still none. The two
 * sentences below say exactly that, and the older blanket claim — "no Bitget
 * integration" — was retired the moment it stopped being true. A panel whose job
 * is to be the honest one cannot keep a sentence that a later commit falsified.
 *
 * Server-rendered: this is static copy and ships no JavaScript.
 */

import { ASSETS } from '@/lib/assets';
import { weekSplit, WEEKLY_REGULAR_HOURS, HOURS_PER_WEEK } from '@/lib/tradingHours';

const BITGET_URL = 'https://www.bitget.com/';

/** The date the counterpart list was last read off live exchange data. */
const VERIFIED_ON = '19 September 2026';

export function BitgetAlignment() {
  const { open, closed } = weekSplit();
  // `flatMap` rather than `filter`: it narrows the type as it goes, so the
  // entries below are known to carry `bitget` without a non-null assertion.
  const pairs = ASSETS.flatMap((asset) =>
    asset.bitget ? [{ ticker: asset.ticker, ...asset.bitget }] : [],
  );
  const missing = ASSETS.filter((asset) => !asset.bitget).map((asset) => asset.ticker);

  return (
    <section
      className="mt-8 rounded-xl2 border border-accent-cyan/25 bg-gradient-to-br from-accent-cyan/[0.07] to-accent-violet/[0.05] p-4 sm:p-5"
      aria-labelledby="bitget-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bitget-heading" className="text-sm font-bold text-slate-50">
          Why a desk for the closed hours
        </h2>
        <span className="pill font-mono text-[0.65rem] text-slate-400">Bitget · 24/7</span>
      </div>

      {/* ---------------------------------------------------- the arithmetic */}
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Regular session', value: '6.5 h', sub: '09:30–16:00 ET' },
          { label: 'Trading days', value: '5', sub: 'Monday to Friday' },
          { label: 'Open per week', value: `${open}%`, sub: `${WEEKLY_REGULAR_HOURS} of ${HOURS_PER_WEEK} h` },
          { label: 'Closed per week', value: `${closed}%`, sub: 'evenings, nights, weekends' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <dt className="text-[0.65rem] font-medium uppercase tracking-wider text-slate-500">
              {stat.label}
            </dt>
            <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">
              {stat.value}
            </dd>
            <dd className="mt-0.5 text-[0.7rem] leading-tight text-slate-500">{stat.sub}</dd>
          </div>
        ))}
      </dl>

      {/* ------------------------------------------------------ the contrast */}
      <p className="mt-4 text-sm leading-relaxed text-slate-300">
        US equities are open for {open}% of the week. The other {closed}% is the part the name
        refers to — and the part{' '}
        <span className="font-semibold text-slate-100">Bitget</span>, which never closes, is built
        for. Where an instrument here has a tokenized counterpart there, its card names it and links
        to it.
      </p>

      {/* ------------------------------------------------------ coverage */}
      <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5">
        <p className="text-xs font-semibold text-slate-100">
          Tokenized counterparts, as verified on {VERIFIED_ON}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">
          {pairs.length} of the {ASSETS.length} instruments on this desk have one. Each opens that
          market on bitget.com.
        </p>
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {pairs.map((pair) => (
            <li key={pair.ticker}>
              <a
                href={pair.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${pair.ticker} → ${pair.symbol} on Bitget — opens bitget.com in a new tab`}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 font-mono text-[0.7rem] transition hover:border-accent-cyan/50 hover:text-slate-100"
              >
                <span className="text-slate-400">{pair.ticker}</span>
                <span aria-hidden="true" className="text-slate-600">
                  →
                </span>
                <span className="font-bold text-accent-cyan">{pair.symbol}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-xs leading-relaxed text-slate-400">
          {missing.join(', ')} — no counterpart found. Apple is the one people expect here; it is
          genuinely not offered.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          That mapping is a static list read off exchange data on {VERIFIED_ON}. It is not a live
          feed, and a venue can delist or rename one at any time without this page knowing. The
          price beside a counterpart is live — read from Bitget&rsquo;s public market endpoint when
          a card is built, and simply absent when that endpoint does not answer.
        </p>
      </div>

      {/*
        The non-claim, and the one sentence on this page that must never drift
        from the facts. It said "No Bitget integration" until the desk began
        pricing counterparts from Bitget's public endpoint — at which point the
        app *did* have one, and the sentence became a false statement printed on
        the panel whose whole purpose is honesty. The trading half of the claim
        is still true and still the load-bearing part; the integration half is
        now stated precisely instead of denied. Do not restore the blanket
        version: an app that reads a venue's prices and says it does not
        integrate with that venue has taught the reader to distrust every other
        label on the card, including the ones that are correct.
      */}
      <div className="mt-4 rounded-xl border border-verdict-reduce/35 bg-verdict-reduce/[0.07] p-3.5">
        <p className="text-xs font-semibold text-slate-100">
          Public market data only. Nothing here can trade.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">
          No Bitget account, no API key, no trading API, no way to move funds from this page. The
          tokenized price on a card comes from Bitget&rsquo;s public market endpoint, which requires
          no credential and accepts no order.
        </p>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        <a
          href={BITGET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent-cyan underline-offset-4 hover:underline"
        >
          Check tokenized listings on Bitget
        </a>
        <span className="ml-1.5">— opens on bitget.com.</span>
      </p>
    </section>
  );
}
