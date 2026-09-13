'use client';

/**
 * The market status strip in the header.
 *
 * Reads `/api/health`, which returns booleans and names only — no credential
 * ever reaches this component. Its job is to tell the user, before they run
 * anything, which session the US market is in and whether this deployment will
 * answer with live AI or the labelled demo engine.
 */

import { useEffect, useState } from 'react';

type Health = {
  session?: {
    label?: string;
    marketOpenNow?: boolean;
    extendedHours?: boolean;
    etTime?: string;
  };
  marketData?: { configured?: boolean };
  ai?: { configured?: boolean; provider?: string; model?: string };
};

export function MarketStatusPill() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/health', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Health | null) => {
        if (!cancelled && data) setHealth(data);
      })
      .catch(() => {
        // The strip is informational — a failure just means it stays hidden.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const session = health?.session;
  const marketConfigured = health?.marketData?.configured;
  const aiConfigured = health?.ai?.configured;
  // Named when the deployment reports it, so the pill can say *which* model is
  // behind the analysis rather than a generic "AI". Falls back to the plain
  // wording if an older deployment answers without the field.
  const aiName = [health?.ai?.provider, health?.ai?.model].filter(Boolean).join(' ');

  // Dot colour, but the label always spells the state out.
  const dot = session?.marketOpenNow
    ? 'bg-verdict-buy'
    : session?.extendedHours
      ? 'bg-accent-cyan'
      : 'bg-slate-500';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="pill">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${session ? dot : 'bg-slate-600'} ${
            session?.marketOpenNow ? 'animate-pulse-soft' : ''
          }`}
        />
        {session?.label ?? 'Checking session…'}
        {session?.etTime ? (
          <span className="font-mono text-[0.7rem] text-slate-400">{session.etTime}</span>
        ) : null}
      </span>

      {health ? (
        <span
          className="pill"
          title={
            aiConfigured
              ? `Generated live${aiName ? ` by ${aiName}` : ''} from the market snapshot. Every price and percentage shown comes from the data layer, not from the model.`
              : 'No model credential is configured. Analyses come from the built-in deterministic engine and are labelled "Demo analysis".'
          }
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-violet" />
          {aiConfigured ? 'Live AI' : 'Demo engine'}
        </span>
      ) : null}

      {health && marketConfigured === false ? (
        <span className="pill border-verdict-reduce/40 text-verdict-reduce">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-verdict-reduce" />
          Market data not configured
        </span>
      ) : null}
    </div>
  );
}
