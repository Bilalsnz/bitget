/**
 * Error surface.
 *
 * Renders the friendly envelope the API produces. It deliberately shows only
 * `message` and `hint` — the developer `detail` never leaves the server, so
 * there is nothing here that could leak configuration or a stack trace.
 */

import type { ErrorBody } from '@/lib/errors';

export function ErrorNotice({
  error,
  onRetry,
}: {
  error: ErrorBody['error'];
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="animate-fade-up rounded-xl2 border border-verdict-avoid/35 bg-verdict-avoid/[0.08] p-4 sm:p-5"
    >
      <div className="flex gap-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          className="mt-0.5 h-5 w-5 shrink-0 text-verdict-avoid"
        >
          <path
            d="M12 9v4m0 3h.01M10.29 3.86 2.82 17a2 2 0 0 0 1.71 3h14.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">{error.message}</p>
          {error.hint ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{error.hint}</p>
          ) : null}

          {/*
            The code is shown because it is genuinely useful when reporting a
            problem, and it is a fixed enum with no configuration in it.
          */}
          <p className="mt-2 font-mono text-[0.68rem] uppercase tracking-wider text-slate-500">
            {error.code}
          </p>

          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-slate-100 transition hover:bg-white/[0.12] active:scale-[0.98]"
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
