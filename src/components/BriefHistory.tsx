'use client';

/**
 * The reader's own recent briefs.
 *
 * This is the one part of the app that persists anything, and it persists
 * nothing but the briefs themselves, on the reader's own device. There is no
 * account to attach them to and no server to send them to — which is why the
 * section says so out loud rather than leaving the reader to guess.
 *
 * The rows are deliberately terse: ticker, stance, when it was saved. A saved
 * brief is a record of what the tool said at that moment, not a live view, so
 * nothing here re-renders a price — a stale number presented as current is the
 * exact failure this product is built to avoid. Opening a row shows the brief
 * as it was written, timestamped.
 *
 * A row's accessible name is the full one-line summary. The visual row is
 * fragmented across several small elements, which reads fine on screen and
 * terribly in a screen reader; the summary restores the whole sentence.
 */

import { getAsset } from '@/lib/assets';
import { briefSummary } from '@/lib/brief';
import { savedAtLabel, type BriefEntry } from '@/lib/history';
import { HOLDING_PERIODS } from '@/lib/types';

import { verdictTone } from './Indicators';

export function BriefHistory({
  entries,
  activeId,
  onOpen,
  onClear,
}: {
  entries: BriefEntry[];
  /** The brief currently on screen, so the row can say so instead of "Open". */
  activeId: string | null;
  onOpen: (entry: BriefEntry) => void;
  onClear: () => void;
}) {
  // Nothing to show is nothing to render. With the auto-run on first load there
  // is always at least one entry by the time this could be seen, so an empty
  // state would only ever appear after an explicit clear — where a lingering
  // empty box would be noise.
  if (entries.length === 0) return null;

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="history-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="history-heading" className="label">
          Your recent briefs
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="min-h-[36px] rounded-lg px-2 text-xs font-medium text-slate-500 underline-offset-4 transition hover:text-slate-300 hover:underline"
        >
          Clear history
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {entries.map((entry) => {
          const { request, analysis } = entry.result;
          const asset = getAsset(request.ticker);
          const period = HOLDING_PERIODS.find((p) => p.id === request.holdingPeriod);
          const tone = verdictTone(analysis.verdict);
          const active = entry.id === activeId;

          return (
            <li key={entry.id}>
              <div
                className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                  active
                    ? 'border-accent-cyan/35 bg-accent-cyan/[0.07]'
                    : 'border-white/[0.07] bg-white/[0.03]'
                }`}
              >
                {/*
                  The dot is decoration; the verdict word next to it is the
                  signal. Colour alone never carries meaning in this UI.
                */}
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
                />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-mono font-bold text-slate-100">{request.ticker}</span>
                    <span className={`font-semibold ${tone.text}`}>{analysis.verdict}</span>
                    <span className="text-xs font-normal text-slate-500">
                      {analysis.confidence}/100
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {asset ? `${asset.name} · ` : ''}
                    {period?.label ?? request.holdingPeriod} · {request.risk} ·{' '}
                    {savedAtLabel(entry.savedAt)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  aria-label={`Open the ${briefSummary(entry.result)}`}
                  className="min-h-[44px] shrink-0 rounded-xl border border-white/12 bg-white/[0.05] px-3.5 text-xs font-semibold text-slate-200 transition active:scale-[0.98] hover:border-white/25 hover:text-slate-50"
                >
                  {active ? 'Showing' : 'Open'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[0.7rem] leading-relaxed text-slate-500">
        Saved in this browser only — nothing is uploaded and no account is involved. A saved brief
        is a record of what the tool said when it was written, not a live price.
      </p>
    </section>
  );
}
