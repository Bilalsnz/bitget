/**
 * Bitget alignment.
 *
 * ## What this panel is, and what it deliberately is not
 *
 * The brief for this hackathon is a Bitget one, so the app should say plainly
 * where its subject matter meets Bitget's. It does that here — by explaining
 * the *rhythm* difference between the two markets, which is the whole reason a
 * desk named AfterHours exists.
 *
 * What it does not do is name a tokenized symbol for each instrument. The
 * temptation is real and the payoff looks free: `NVDA → rNVDA` next to every
 * ticker reads like an integration. It is not one. This app has no Bitget API
 * client, no listing feed and no way to know which equities a venue has
 * tokenized today, or under what symbol. A mapping written from memory would be
 * a guess presented as a product fact — and the audience best equipped to spot
 * a wrong ticker is the sponsor reading the submission.
 *
 * So the panel states three things it can stand behind, and says so when it
 * cannot:
 *
 *   1. The arithmetic. US equities are open 390 minutes a day, five days a
 *      week — around a fifth of the week. Derived in `lib/tradingHours.ts` from
 *      the same constants the session classifier uses, so it cannot drift.
 *   2. The contrast. Crypto venues do not close. That is true of the market as
 *      a category and is not a claim about any specific listing.
 *   3. The limit. Whether a given instrument has a tokenized counterpart, and
 *      what it is called, is a question for Bitget — with a link, so the reader
 *      can go and check rather than take our word for it.
 *
 * The non-integration notice is the load-bearing part. Every other sentence
 * here is context; that one is the difference between a product and a pretence.
 *
 * Server-rendered: this is static copy and ships no JavaScript.
 */

import { weekSplit, WEEKLY_REGULAR_HOURS, HOURS_PER_WEEK } from '@/lib/tradingHours';

const BITGET_URL = 'https://www.bitget.com/';

export function BitgetAlignment() {
  const { open, closed } = weekSplit();

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
      <div className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-300">
        <p>
          US equity markets keep office hours. Everything this desk researches — the close, the
          move against the previous close, the gap before the next open — happens inside that
          {' '}
          {open}% of the week. The other {closed}% is the part the name refers to.
        </p>

        <p>
          Crypto venues work the opposite rhythm: they do not close for the night, the weekend, or
          the holiday. <span className="font-semibold text-slate-100">Bitget</span> runs on that
          continuous schedule, which is the same twenty-four-hour premise this desk is built
          around — a market where the hours between one equity session and the next are not dead
          time but the main event.
        </p>

        <p>
          Tokenized-equity products, where an exchange lists them, are designed to follow that
          continuous schedule rather than the equity one. Whether a particular instrument has such
          a counterpart, and what symbol it carries, is something to confirm with Bitget directly —
          this app does not read Bitget&rsquo;s listings and will not guess a ticker for you.
        </p>
      </div>

      {/* -------------------------------------------------- the non-claim */}
      <div className="mt-4 rounded-xl border border-verdict-reduce/35 bg-verdict-reduce/[0.07] p-3.5">
        <p className="text-xs font-semibold text-slate-100">
          No Bitget integration. Nothing here can trade.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">
          AfterHours AI holds no Bitget account, calls no Bitget trading API, and has no listing
          feed. There is no order button, no wallet and no way to move funds from this page. Every
          price shown comes from the equity data source named on each card, not from Bitget.
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
