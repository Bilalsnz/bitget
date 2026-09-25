/**
 * The research card — the whole answer, assembled in reading order.
 *
 * Order matters and is deliberate: what moved → what the tool thinks → why →
 * what would prove it wrong → how much exposure that supports → the evidence →
 * the sources. A reader who stops after the first screen still has the verdict
 * and the number behind it.
 *
 * The card contains no trading control of any kind. The strongest thing it can
 * say is a stance; the decision and the action stay with the reader.
 */

import { getAsset } from '@/lib/assets';
import { RESEARCH_NOTICE } from '@/lib/disclaimers';
import { HOLDING_PERIODS, type ResearchResult } from '@/lib/types';

import { BriefActions } from './BriefActions';
import { BitgetCounterpart } from './BitgetCounterpart';
import { ConfidenceMeter, ExposureBadge, ModeIndicator, VerdictBadge } from './Indicators';
import { MarketSnapshotPanel } from './MarketSnapshotPanel';

const HEADLINE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function Bullets({
  heading,
  items,
  tone,
  marker,
}: {
  heading: string;
  items: string[];
  tone: 'reason' | 'risk';
  marker: string;
}) {
  const markerClass =
    tone === 'reason'
      ? 'border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan'
      : 'border-verdict-reduce/40 bg-verdict-reduce/10 text-verdict-reduce';

  return (
    <section>
      <h3 className="label">{heading}</h3>
      <ol className="mt-2.5 space-y-2.5">
        {items.map((item, index) => (
          <li key={item} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold ${markerClass}`}
            >
              {index + 1}
            </span>
            <p className="text-sm leading-relaxed text-slate-300">{item}</p>
          </li>
        ))}
      </ol>
      {/* Numbers above are decorative ordering; this keeps the marker text out
          of the reading order for screen readers, which read the list anyway. */}
      <span className="sr-only">{marker}</span>
    </section>
  );
}

export function ResearchCard({ result }: { result: ResearchResult }) {
  const { request, snapshot, analysis } = result;
  const asset = getAsset(request.ticker);
  const holding = HOLDING_PERIODS.find((period) => period.id === request.holdingPeriod);

  return (
    <article className="animate-fade-up space-y-4">
      {/* ------------------------------------------------------ identity */}
      <header className="panel-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight text-slate-50">
              <span className="font-mono">{request.ticker}</span>
              {asset ? (
                <span className="ml-2 text-base font-normal text-slate-400">{asset.name}</span>
              ) : null}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {holding?.label ?? request.holdingPeriod} · {holding?.hint} · {request.risk} risk profile
            </p>
            {asset?.bitget ? (
              <div className="mt-2.5">
                <BitgetCounterpart
                  ticker={request.ticker}
                  tokenized={snapshot.tokenized}
                  basis={snapshot.tokenizedBasis}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <ModeIndicator
            mode={result.mode}
            providerLabel={result.providerLabel}
            reason={result.modeReason}
          />
        </div>
      </header>

      {/* ------------------------------------------- verdict and sizing */}
      <div className="grid gap-3 sm:grid-cols-3">
        <VerdictBadge verdict={analysis.verdict} ticker={request.ticker} />
        <ConfidenceMeter confidence={analysis.confidence} />
        <ExposureBadge exposure={analysis.suggestedExposure} />
      </div>

      {/* The research-only notice, next to the verdict it qualifies. */}
      <p className="text-center text-xs font-medium text-slate-400">{RESEARCH_NOTICE}</p>

      {/* ------------------------------------------------- what changed */}
      <section className="panel p-4 sm:p-5">
        <h3 className="label">What changed</h3>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-slate-200">
          {analysis.whatChanged}
        </p>
      </section>

      {/* -------------------------------------------------- reasons/risks */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="panel p-4 sm:p-5">
          <Bullets
            heading="Why"
            items={analysis.reasons}
            tone="reason"
            marker="Supporting reasons"
          />
        </div>

        <div className="panel p-4 sm:p-5">
          <Bullets
            heading="What would prove this wrong"
            items={analysis.risks}
            tone="risk"
            marker="Risks to this view"
          />
        </div>
      </div>

      {/* -------------------------------------------------- take it with you */}
      {/* The only controls on this card, and both move text rather than money.
          The copy path serialises through `lib/brief.ts`, so the brief carries
          the notices wherever it is pasted. */}
      <section className="panel p-4 sm:p-5">
        <h3 className="label">Take this brief with you</h3>
        <div className="mt-3">
          <BriefActions result={result} />
        </div>
      </section>

      {/* ------------------------------------------------------- evidence */}
      <MarketSnapshotPanel snapshot={snapshot} />

      {/* ------------------------------------------------------ headlines */}
      <section className="panel p-4 sm:p-5">
        <h3 className="label">Recent headlines</h3>

        {snapshot.headlines.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            No recent headlines were retrieved for {request.ticker} from {snapshot.dataSource}.
            {result.mode === 'demo'
              ? ' The demo engine does not read news, and makes no claim about it.'
              : ' The analysis above therefore makes no claim about news.'}
          </p>
        ) : (
          <>
            <ul className="mt-2.5 space-y-2.5">
              {snapshot.headlines.map((headline) => (
                <li key={headline.url} className="border-l-2 border-white/10 pl-3">
                  <a
                    href={headline.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium leading-snug text-slate-200 underline-offset-4 hover:text-accent-cyan hover:underline"
                  >
                    {headline.headline}
                  </a>
                  <p className="mt-1 text-[0.7rem] text-slate-500">
                    {headline.source} ·{' '}
                    {Number.isFinite(Date.parse(headline.datetime))
                      ? HEADLINE_TIME.format(new Date(headline.datetime))
                      : 'date unavailable'}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Headlines are shown exactly as published by {snapshot.dataSource}, to a maximum of
              six. They open on the publisher&rsquo;s site.
            </p>
          </>
        )}
      </section>

    </article>
  );
}
