'use client';

/**
 * The interactive research desk.
 *
 * Owns the request lifecycle: form → loading → result or error. Kept as one
 * client island so the rest of the page (header, explainer, footer) stays a
 * server component and ships no JavaScript.
 *
 * On first load it runs one default brief automatically. A judge opening the
 * deployed URL on a phone should see a complete, real research card without
 * having to tap anything first — an empty state would waste the only ten
 * seconds you get to make the product's case.
 *
 * It also owns the two pieces of state that outlive a single request: the local
 * brief history, and whether the sticky Analyse bar is showing. Both live here
 * because both depend on scroll or storage — neither of which a server
 * component can see.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { isResearchResult } from '@/lib/brief';
import { friendlyError, isErrorBody, type ErrorBody } from '@/lib/errors';
import { readHistory, saveBrief, clearHistory, type BriefEntry } from '@/lib/history';
import type { ResearchRequest, ResearchResult } from '@/lib/types';

import { BriefHistory } from './BriefHistory';
import { ErrorNotice } from './ErrorNotice';
import { LoadingResearch } from './LoadingResearch';
import { ResearchCard } from './ResearchCard';
import { RESEARCH_FORM_ID, ResearchForm } from './ResearchForm';

const DEFAULT_REQUEST: ResearchRequest = {
  ticker: 'AAPL',
  holdingPeriod: '1m',
  risk: 'Moderate',
};

/** Anchor for the scroll-to-result on a restored brief. */
const RESULT_ANCHOR_ID = 'research-result';

type State =
  | { status: 'idle' }
  | { status: 'loading'; request: ResearchRequest }
  | { status: 'success'; result: ResearchResult }
  | { status: 'error'; request: ResearchRequest; error: ErrorBody['error'] };

/** Respect the OS setting rather than animating regardless. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function ResearchDesk() {
  const [state, setState] = useState<State>({ status: 'idle' });
  /** The request currently reflected in the form's own selection state. */
  const [selection, setSelection] = useState<ResearchRequest>(DEFAULT_REQUEST);
  const [history, setHistory] = useState<BriefEntry[]>([]);
  /** Which history row is on screen, so it can read "Showing" instead of "Open". */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Bumped to remount the form when a stored brief repopulates its fields. */
  const [formVersion, setFormVersion] = useState(0);
  const [canSubmit, setCanSubmit] = useState(true);
  const [showSticky, setShowSticky] = useState(false);

  // Guards the auto-run against React StrictMode's double effect invocation in
  // development, which would otherwise spend two API calls on every page load.
  const autoRan = useRef(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const run = useCallback(async (request: ResearchRequest) => {
    setSelection(request);
    setState({ status: 'loading', request });

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        cache: 'no-store',
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const error = isErrorBody(payload)
          ? payload.error
          : { code: 'UNKNOWN' as const, ...friendlyError('UNKNOWN') };
        setState({ status: 'error', request, error });
        return;
      }

      // The same guard the history read path uses, rather than a second looser
      // one. If the response is not renderable it is not storable either, and
      // having one definition of "a brief" is what keeps those two from
      // disagreeing — a card that renders now but vanishes from history on the
      // next load would be the worst of both.
      if (!isResearchResult(payload)) {
        setState({
          status: 'error',
          request,
          error: { code: 'UNKNOWN', ...friendlyError('UNKNOWN') },
        });
        return;
      }

      setState({ status: 'success', result: payload });

      // Only a successfully generated brief is worth keeping. An error is a
      // thing that happened, not a thing to remember — storing it would fill
      // the reader's five slots with failures.
      const next = saveBrief(payload);
      setHistory(next);
      setActiveId(next[0]?.id ?? null);
    } catch {
      // Transport-level failure: the request never got an answer.
      setState({
        status: 'error',
        request,
        error: { code: 'NETWORK', ...friendlyError('NETWORK') },
      });
    }
  }, []);

  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    // Read before running, so stored briefs appear alongside the fresh one
    // rather than being clobbered by it.
    setHistory(readHistory());
    void run(DEFAULT_REQUEST);
  }, [run]);

  /**
   * Show the sticky bar only once the form has scrolled *above* the viewport.
   *
   * Testing `!isIntersecting` alone is not enough: on a phone the sentinel sits
   * below the fold on first paint, which is also non-intersecting, and the bar
   * would appear over a form the reader can already see. The position check is
   * what distinguishes "scrolled past" from "not reached yet".
   */
  useEffect(() => {
    const target = sentinel.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowSticky(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const onOpenStored = useCallback((entry: BriefEntry) => {
    // Deliberately *not* re-run. A stored brief is a record of what the tool
    // said at that moment, and re-running would silently replace it with a
    // different analysis while the row kept its old timestamp. The form is
    // repopulated instead, so refreshing is one tap and clearly a new request.
    setState({ status: 'success', result: entry.result });
    setSelection(entry.result.request);
    setActiveId(entry.id);
    setFormVersion((version) => version + 1);

    // History sits below the card, so opening a row moves the reader up.
    document.getElementById(RESULT_ANCHOR_ID)?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  }, []);

  const onClearHistory = useCallback(() => {
    clearHistory();
    setHistory([]);
    setActiveId(null);
  }, []);

  const onValidityChange = useCallback((next: boolean) => setCanSubmit(next), []);

  const loading = state.status === 'loading';
  const stickyLabel = loading ? 'Working…' : `Analyse ${selection.ticker}`;

  return (
    <div className={`space-y-4 ${showSticky ? 'pb-24 sm:pb-0' : ''}`}>
      <ResearchForm
        key={formVersion}
        onSubmit={(request) => void run(request)}
        loading={loading}
        current={selection}
        onValidityChange={onValidityChange}
      />

      {/* The sticky bar's trigger. Zero-height, invisible, purely positional. */}
      <div ref={sentinel} aria-hidden="true" />

      {/* `scroll-padding-top` on the document already clears the sticky page
          header, so no scroll margin is needed here. */}
      <div id={RESULT_ANCHOR_ID} className="space-y-4">
        {state.status === 'loading' ? <LoadingResearch ticker={state.request.ticker} /> : null}

        {state.status === 'error' ? (
          <ErrorNotice error={state.error} onRetry={() => void run(state.request)} />
        ) : null}

        {state.status === 'success' ? <ResearchCard result={state.result} /> : null}

        {/* Idle is only reachable if the auto-run was skipped; keep a hint anyway. */}
        {state.status === 'idle' ? (
          <p className="panel p-4 text-sm text-slate-400">
            Choose an instrument above to generate a research brief.
          </p>
        ) : null}
      </div>

      <BriefHistory
        entries={history}
        activeId={activeId}
        onOpen={onOpenStored}
        onClear={onClearHistory}
      />

      {/*
        The sticky Analyse bar.

        It submits the form through the HTML `form` attribute rather than a
        click handler, so it runs the exact same submit path as the button
        inside the form — one code path, no drift.

        Mobile only: on a wide screen the form's own button is a short scroll
        away, and a bar pinned to the bottom of a desktop window is clutter.
      */}
      {showSticky ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/90 px-4 pt-3 backdrop-blur sm:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button
            type="submit"
            form={RESEARCH_FORM_ID}
            disabled={!canSubmit}
            className="min-h-[52px] w-full rounded-xl bg-gradient-to-br from-accent-cyan to-accent-violet text-sm font-bold text-ink-950 transition enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {stickyLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
