/**
 * Loading state.
 *
 * A skeleton rather than a spinner: it shows the shape of the answer that is
 * coming, which makes the wait feel shorter and tells the user what to expect.
 * The status line names the real steps rather than pretending to know progress.
 */

export function LoadingResearch({ ticker }: { ticker: string }) {
  return (
    <div className="panel-raised animate-fade-up overflow-hidden p-4 sm:p-5" aria-busy="true">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="relative flex h-2.5 w-2.5 shrink-0"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-cyan opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-cyan" />
        </span>

        <p className="text-sm font-semibold text-slate-200">
          Researching {ticker}
        </p>
      </div>

      <p className="mt-1.5 text-xs text-slate-500" role="status">
        Fetching the latest quote, session context and recent headlines, then running the analysis.
      </p>

      {/* Skeleton blocks, one per section the result will contain. */}
      <div className="mt-5 space-y-3">
        {[
          'h-20',
          'h-16',
          'h-24',
          'h-28',
        ].map((height, index) => (
          <div
            key={height}
            className={`relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] ${height}`}
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <div className="absolute inset-0 -translate-x-full animate-sweep bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
          </div>
        ))}
      </div>
    </div>
  );
}
