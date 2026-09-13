/**
 * The data-provenance banner.
 *
 * Every research card carries this, above the verdict, because the single most
 * misleading thing this product could do is let a reader assume the price is a
 * live after-hours quote. The app is named for the question it answers, not for
 * the data it holds, and this banner is where that distinction is made
 * unmissable rather than inferred.
 *
 * It states three facts and nothing else: what the data is, who supplied it,
 * and exactly when it was printed. The timestamp is rendered in full — ET wall
 * clock, calendar day, and the raw ISO instant — because "recent" is not a
 * timestamp and a reader checking a brief against their broker needs the exact
 * one.
 *
 * Copy is asserted verbatim in tests. Changing the headline wording is a
 * product decision, not a styling one.
 */

import type { MarketSnapshot } from '@/lib/types';

/** The sentence the product promises on every card. */
export const REGULAR_SESSION_NOTICE = 'Regular-session data only. This is not true after-hours pricing.';

const EXACT_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

export function DataProvenance({ snapshot }: { snapshot: MarketSnapshot }) {
  const { quote } = snapshot;
  const exact = quote.asOf ? EXACT_TIME.format(new Date(quote.asOf)) : null;

  return (
    <section
      className="rounded-xl2 border border-verdict-reduce/35 bg-verdict-reduce/[0.07] p-4 sm:p-5"
      aria-labelledby="provenance-heading"
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-verdict-reduce/50 bg-verdict-reduce/15 font-bold text-verdict-reduce"
        >
          <span className="text-[0.7rem] leading-none">!</span>
        </span>

        <div className="min-w-0 flex-1">
          <h2 id="provenance-heading" className="text-sm font-bold leading-snug text-slate-50">
            {REGULAR_SESSION_NOTICE}
          </h2>

          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
            {quote.afterHoursAvailable
              ? 'The provider returned a distinguishable extended-hours print for this instrument.'
              : `This data plan does not provide an extended-hours price for US equities. The price below is the most recent regular-session print — it is not an after-hours quote, and this tool does not present it as one.`}
          </p>

          {/* The evidence: who, and exactly when. */}
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
              <dt className="text-[0.6rem] font-semibold uppercase tracking-wider text-slate-500">
                Data source
              </dt>
              <dd className="mt-0.5 text-xs font-semibold text-slate-200">
                {snapshot.dataSource}
                <span className="ml-1.5 font-normal text-slate-500">limited/delayed plan</span>
              </dd>
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
              <dt className="text-[0.6rem] font-semibold uppercase tracking-wider text-slate-500">
                Exact quote timestamp
              </dt>
              <dd className="mt-0.5 text-xs font-semibold text-slate-200">
                {quote.asOf ? (
                  // Machine-readable instant plus the ET wall clock, so the same
                  // fact is available to a reader, a screen reader and a script.
                  <time dateTime={quote.asOf} className="tabular-nums">
                    {exact}
                  </time>
                ) : (
                  'Timestamp unavailable'
                )}
                <span className="mt-0.5 block font-normal text-slate-500">
                  {quote.session.label} · {quote.session.etTime}, {quote.session.etDate}
                </span>
              </dd>
            </div>
          </dl>

          <p className="mt-2.5 text-[0.7rem] leading-relaxed text-slate-500">
            Movement basis: {quote.movementBasis}
          </p>
        </div>
      </div>
    </section>
  );
}
