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
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { friendlyError, isErrorBody, type ErrorBody } from '@/lib/errors';
import type { ResearchRequest, ResearchResult } from '@/lib/types';

import { ErrorNotice } from './ErrorNotice';
import { LoadingResearch } from './LoadingResearch';
import { ResearchCard } from './ResearchCard';
import { ResearchForm } from './ResearchForm';

const DEFAULT_REQUEST: ResearchRequest = {
  ticker: 'AAPL',
  holdingPeriod: '1m',
  risk: 'Moderate',
};

type State =
  | { status: 'idle' }
  | { status: 'loading'; request: ResearchRequest }
  | { status: 'success'; result: ResearchResult }
  | { status: 'error'; request: ResearchRequest; error: ErrorBody['error'] };

/** Minimal shape check before we hand an unknown payload to the card. */
function looksLikeResult(input: unknown): input is ResearchResult {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<ResearchResult>;
  return (
    typeof candidate.snapshot === 'object' &&
    candidate.snapshot !== null &&
    typeof candidate.analysis === 'object' &&
    candidate.analysis !== null &&
    typeof candidate.mode === 'string'
  );
}

export function ResearchDesk() {
  const [state, setState] = useState<State>({ status: 'idle' });
  /** The request currently reflected in the form's own selection state. */
  const [selection, setSelection] = useState<ResearchRequest>(DEFAULT_REQUEST);

  // Guards the auto-run against React StrictMode's double effect invocation in
  // development, which would otherwise spend two API calls on every page load.
  const autoRan = useRef(false);

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

      if (!looksLikeResult(payload)) {
        setState({
          status: 'error',
          request,
          error: { code: 'UNKNOWN', ...friendlyError('UNKNOWN') },
        });
        return;
      }

      setState({ status: 'success', result: payload });
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
    void run(DEFAULT_REQUEST);
  }, [run]);

  const loading = state.status === 'loading';

  return (
    <div className="space-y-4">
      <ResearchForm
        onSubmit={(request) => void run(request)}
        loading={loading}
        current={selection}
      />

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
  );
}
