/**
 * Presentational indicators for the research card.
 *
 * Accessibility rule enforced here: **colour is never the only signal.** Every
 * indicator renders its own word — a verdict is "HOLD", not a blue square; a
 * confidence is "62 / 100", not just a bar length. Anyone who cannot separate
 * the green from the amber still gets the full meaning.
 */

import type { AnalysisMode, Exposure, Verdict } from '@/lib/types';

/* ------------------------------------------------------------------ verdict */

const VERDICT_STYLE: Record<
  Verdict,
  {
    /** What the rating means in plain language — a stance, never an instruction. */
    stance: string;
    text: string;
    border: string;
    surface: string;
    glow: string;
    dot: string;
  }
> = {
  BUY: {
    stance: 'The evidence supports adding exposure.',
    text: 'text-verdict-buy',
    border: 'border-verdict-buy/40',
    surface: 'from-verdict-buy/20 to-verdict-buyDeep/5',
    glow: 'shadow-[0_0_40px_-12px_rgba(20,241,149,0.55)]',
    dot: 'bg-verdict-buy',
  },
  HOLD: {
    stance: 'The evidence supports neither adding nor reducing.',
    text: 'text-verdict-hold',
    border: 'border-verdict-hold/40',
    surface: 'from-verdict-hold/20 to-verdict-holdDeep/5',
    glow: 'shadow-[0_0_40px_-12px_rgba(124,140,255,0.55)]',
    dot: 'bg-verdict-hold',
  },
  REDUCE: {
    stance: 'The evidence supports trimming exposure.',
    text: 'text-verdict-reduce',
    border: 'border-verdict-reduce/40',
    surface: 'from-verdict-reduce/20 to-verdict-reduceDeep/5',
    glow: 'shadow-[0_0_40px_-12px_rgba(255,176,32,0.55)]',
    dot: 'bg-verdict-reduce',
  },
  AVOID: {
    stance: 'The evidence supports staying out entirely.',
    text: 'text-verdict-avoid',
    border: 'border-verdict-avoid/40',
    surface: 'from-verdict-avoid/20 to-verdict-avoidDeep/5',
    glow: 'shadow-[0_0_40px_-12px_rgba(255,77,109,0.55)]',
    dot: 'bg-verdict-avoid',
  },
};

export function VerdictBadge({ verdict, ticker }: { verdict: Verdict; ticker: string }) {
  const style = VERDICT_STYLE[verdict];

  return (
    <div
      className={`rounded-xl2 border bg-gradient-to-br p-4 sm:p-5 ${style.border} ${style.surface} ${style.glow}`}
    >
      <p className="label">Verdict for {ticker}</p>
      <p
        className={`mt-1.5 text-3xl font-black tracking-tight sm:text-4xl ${style.text}`}
      >
        {verdict}
      </p>
      <p className="mt-1 text-sm leading-snug text-slate-300">{style.stance}</p>
    </div>
  );
}

/* --------------------------------------------------------------- confidence */

function confidenceBand(confidence: number): { word: string; tone: string } {
  if (confidence < 40) return { word: 'Low', tone: 'text-verdict-avoid' };
  if (confidence < 60) return { word: 'Moderate', tone: 'text-verdict-reduce' };
  if (confidence < 80) return { word: 'Fairly high', tone: 'text-verdict-hold' };
  return { word: 'High', tone: 'text-verdict-buy' };
}

export function ConfidenceMeter({ confidence }: { confidence: number }) {
  const band = confidenceBand(confidence);

  return (
    <div className="rounded-xl2 border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="label">Confidence</p>
        <p className="text-sm font-semibold text-slate-200">
          <span className="text-lg font-bold tabular-nums">{confidence}</span>
          <span className="text-slate-500"> / 100</span>
        </p>
      </div>

      {/*
        The bar is decorative reinforcement — the number above and the band word
        below carry the meaning, so this is hidden from assistive tech.
      */}
      <div
        aria-hidden="true"
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-cyan via-verdict-hold to-accent-violet transition-[width] duration-500"
          style={{ width: `${Math.max(2, Math.min(100, confidence))}%` }}
        />
      </div>

      <p className={`mt-2 text-xs font-medium ${band.tone}`}>
        {band.word} confidence
      </p>
      <p className="mt-0.5 text-xs leading-snug text-slate-500">
        How well-evidenced this call is — not how large the move was.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- exposure */

const EXPOSURE_COPY: Record<Exposure, { label: string; blurb: string; tone: string; border: string }> = {
  SKIP: {
    label: 'Skip',
    blurb: 'The evidence does not support taking a position here.',
    tone: 'text-verdict-avoid',
    border: 'border-verdict-avoid/35',
  },
  SMALL: {
    label: 'Small',
    blurb: 'A small position at most — the evidence does not justify more.',
    tone: 'text-verdict-reduce',
    border: 'border-verdict-reduce/35',
  },
  MEDIUM: {
    label: 'Medium',
    blurb: 'A moderate position is supported. This is the ceiling this tool will suggest.',
    tone: 'text-verdict-buy',
    border: 'border-verdict-buy/35',
  },
};

export function ExposureBadge({ exposure }: { exposure: Exposure }) {
  const copy = EXPOSURE_COPY[exposure];

  return (
    <div className={`rounded-xl2 border bg-white/[0.04] p-4 ${copy.border}`}>
      <p className="label">Suggested exposure</p>
      <p className={`mt-1 text-xl font-bold ${copy.tone}`}>{copy.label}</p>
      <p className="mt-1 text-xs leading-snug text-slate-400">{copy.blurb}</p>
    </div>
  );
}

/* -------------------------------------------------------------- mode banner */

/**
 * Says where the analysis came from. This is the honesty surface: demo mode is
 * labelled as prominently as live mode, never buried in small print.
 */
export function ModeIndicator({
  mode,
  providerLabel,
  reason,
}: {
  mode: AnalysisMode;
  providerLabel: string;
  reason: string;
}) {
  const live = mode === 'live';

  return (
    <div
      className={`flex gap-3 rounded-xl2 border p-3.5 ${
        live
          ? 'border-accent-cyan/30 bg-accent-cyan/[0.07]'
          : 'border-verdict-reduce/30 bg-verdict-reduce/[0.07]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          live ? 'bg-accent-cyan' : 'bg-verdict-reduce'
        } ${live ? 'animate-pulse-soft' : ''}`}
      />

      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-100">
          {live ? 'Live AI analysis' : 'Demo analysis'}
          <span className="ml-2 font-normal text-slate-400">{providerLabel}</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{reason}</p>
      </div>
    </div>
  );
}
