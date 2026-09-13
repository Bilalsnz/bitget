/**
 * The market snapshot panel — every number the analysis was based on.
 *
 * This panel is the product's evidence table. If a figure is not here, the
 * analysis was not allowed to cite it. Nothing in this component is generated
 * by a model; it is a direct rendering of `MarketSnapshot`.
 */

import type { MarketSnapshot } from '@/lib/types';

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return MONEY.format(value);
}

function signedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function signedMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${MONEY.format(Math.abs(value))}`;
}

/** Coarse "how stale is this" label. Never claims more precision than it has. */
function relativeFrom(iso: string | null): string {
  if (!iso) return 'timestamp unavailable';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'timestamp unavailable';

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
      <dt className="text-[0.65rem] font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-1 font-mono text-sm font-semibold tabular-nums ${tone ?? 'text-slate-200'}`}>
        {value}
      </dd>
    </div>
  );
}

export function MarketSnapshotPanel({ snapshot }: { snapshot: MarketSnapshot }) {
  const { quote } = snapshot;

  const up = (quote.percent ?? 0) > 0;
  const down = (quote.percent ?? 0) < 0;
  const changeTone = up ? 'text-pos' : down ? 'text-neg' : 'text-slate-300';

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="snapshot-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="snapshot-heading" className="label">
          Market snapshot
        </h2>
        <p className="text-[0.7rem] text-slate-500">
          Source: <span className="text-slate-400">{snapshot.dataSource}</span>
        </p>
      </div>

      {/* Price and move — the headline numbers. */}
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="font-mono text-4xl font-bold tabular-nums text-slate-50">
          {money(quote.price)}
        </p>
        <p className={`font-mono text-lg font-semibold tabular-nums ${changeTone}`}>
          {signedMoney(quote.change)}
          <span className="ml-2">{signedPercent(quote.percent)}</span>
        </p>
        <span className="pill ml-auto font-mono">{quote.ticker}</span>
      </div>

      <p className="mt-1.5 text-xs text-slate-500">
        {quote.session.label} · print timestamped {quote.session.etTime} ({quote.session.etDate}) ·{' '}
        {relativeFrom(quote.asOf)}
      </p>

      {/* The evidence table. */}
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Prev close" value={money(quote.previousClose)} />
        <Stat label="Open" value={money(quote.open)} />
        <Stat label="Day high" value={money(quote.high)} />
        <Stat label="Day low" value={money(quote.low)} />
      </dl>

      {/*
        What the percentage is actually measured against. On a product named
        "AfterHours" this sentence is load-bearing: it is the difference between
        an honest label and an implied claim.
      */}
      <p className="mt-3 text-xs leading-relaxed text-slate-400">{quote.movementBasis}</p>

      {/* The explicit after-hours honesty notice. */}
      <div
        className={`mt-3 rounded-xl border p-3 ${
          quote.afterHoursAvailable
            ? 'border-verdict-buy/40 bg-verdict-buy/[0.07]'
            : 'border-verdict-reduce/40 bg-verdict-reduce/[0.07]'
        }`}
      >
        <p className="text-xs font-semibold text-slate-200">
          {quote.afterHoursAvailable
            ? 'Extended-hours quote available'
            : 'No separate after-hours quote available'}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {quote.afterHoursAvailable
            ? 'The provider returned a distinguishable extended-hours print for this instrument.'
            : 'This data plan does not provide an extended-hours price for US equities. The price above is the most recent available print — it is not an after-hours quote, and this tool will not present it as one.'}
        </p>
      </div>

      {/* Anything the data layer flagged as degraded. */}
      {snapshot.notes.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {snapshot.notes.map((note) => (
            <li key={note} className="flex gap-2 text-xs leading-relaxed text-slate-400">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
