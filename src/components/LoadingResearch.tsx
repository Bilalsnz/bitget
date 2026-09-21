/**
 * Loading state.
 *
 * A skeleton rather than a spinner: it shows the shape of the answer that is
 * coming, which makes the wait feel shorter and tells the user what to expect.
 *
 * The blocks are laid out in the same rhythm as the real card — data-honesty
 * banner, verdict tiles, prose, two columns — so the page does not jump when
 * the result lands. A generic stack of grey rectangles would technically fill
 * the space, but it would also promise nothing about what is arriving.
 *
 * The status line names the real steps rather than faking a progress bar: the
 * wait is one round trip, and there is no honest percentage to show.
 */

/** Widths are percentages so the text lines look like text, not like boxes. */
function SkeletonPanel({
  widths,
  delay = 0,
  className = '',
}: {
  widths: number[];
  delay?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden rounded-xl2 border border-white/[0.06] bg-white/[0.03] p-4 sm:p-5 ${className}`}
    >
      <div className="space-y-2.5">
        {widths.map((width, index) => (
          <div
            key={`${width}-${index}`}
            className="h-3 rounded-full bg-white/[0.06]"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>

      <div
        className="absolute inset-0 -translate-x-full animate-sweep bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
        style={{ animationDelay: `${delay}ms` }}
      />
    </div>
  );
}

export function LoadingResearch({ ticker }: { ticker: string }) {
  return (
    <div className="animate-fade-up space-y-4" aria-busy="true">
      <div className="panel-raised p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-cyan opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-cyan" />
          </span>

          <p className="text-sm font-semibold text-slate-200">Researching {ticker}</p>
        </div>

        <p className="mt-1.5 text-xs text-slate-500" role="status">
          Fetching the latest quote, session context and recent headlines, then running the
          analysis.
        </p>
      </div>

      {/* The provenance banner's slot — it is always the first thing on a card. */}
      <SkeletonPanel widths={[86, 97, 58]} />

      {/* Verdict, confidence, exposure. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <SkeletonPanel key={index} widths={[52, 78]} delay={index * 110} className="h-28" />
        ))}
      </div>

      {/* What changed. */}
      <SkeletonPanel widths={[94, 88, 61]} delay={60} />

      {/* Why / what would prove this wrong. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <SkeletonPanel key={index} widths={[88, 76, 82]} delay={index * 110} />
        ))}
      </div>
    </div>
  );
}
