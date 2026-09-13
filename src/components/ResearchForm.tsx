'use client';

/**
 * The research form — the first thing on the page and above the fold.
 *
 * Deliberately not a chatbot: the interaction is "pick an instrument, pick a
 * horizon, get a structured brief". There is no free-text prompt box, because
 * the product's value is the discipline of the analysis, not open conversation.
 *
 * There is also, deliberately, no trading control of any kind here — this form
 * chooses what to *research*, and nothing it does can move money.
 */

import { useId, useState } from 'react';

import { ASSETS } from '@/lib/assets';
import { HOLDING_PERIODS, RISK_STYLES, type HoldingPeriodId, type ResearchRequest, type RiskStyle } from '@/lib/types';

const RISK_HINT: Record<RiskStyle, string> = {
  Conservative: 'Capital preservation first',
  Moderate: 'Normal market risk',
  Aggressive: 'Volatility tolerated',
};

export function ResearchForm({
  onSubmit,
  loading,
  current,
}: {
  onSubmit: (request: ResearchRequest) => void;
  loading: boolean;
  current: ResearchRequest | null;
}) {
  const tickerFieldId = useId();
  const [ticker, setTicker] = useState(current?.ticker ?? 'AAPL');
  const [holdingPeriod, setHoldingPeriod] = useState<HoldingPeriodId>(current?.holdingPeriod ?? '1m');
  const [risk, setRisk] = useState<RiskStyle>(current?.risk ?? 'Moderate');

  const canSubmit = ticker.trim().length > 0 && !loading;

  return (
    <form
      className="panel animate-fade-up p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({ ticker: ticker.trim().toUpperCase(), holdingPeriod, risk });
      }}
    >
      {/* ---------------------------------------------------------- ticker */}
      <div>
        <label htmlFor={tickerFieldId} className="label">
          Instrument
        </label>

        <div className="mt-2 flex gap-2">
          <input
            id={tickerFieldId}
            name="ticker"
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            placeholder="AAPL"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={12}
            // 16px minimum stops iOS Safari zooming the page on focus.
            className="min-h-[48px] w-full min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-900/70 px-3.5 font-mono text-base uppercase tracking-wide text-slate-100 placeholder:text-slate-600 focus:border-accent-cyan/50 focus:outline-none"
          />

          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-[48px] shrink-0 rounded-xl bg-gradient-to-br from-accent-cyan to-accent-violet px-5 text-sm font-bold text-ink-950 transition enabled:hover:brightness-110 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {loading ? 'Working…' : 'Analyse'}
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">Tap an instrument, or type any US ticker.</p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {ASSETS.map((asset) => {
            const active = ticker.trim().toUpperCase() === asset.ticker;
            return (
              <button
                key={asset.ticker}
                type="button"
                aria-pressed={active}
                onClick={() => setTicker(asset.ticker)}
                title={asset.name}
                className={`min-h-[36px] rounded-lg border px-3 font-mono text-xs font-semibold transition active:scale-[0.97] ${
                  active
                    ? 'border-accent-cyan/60 bg-accent-cyan/15 text-accent-cyan'
                    : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-slate-100'
                }`}
              >
                {asset.ticker}
              </button>
            );
          })}
        </div>
      </div>

      {/* -------------------------------------------------- holding period */}
      <fieldset className="mt-5">
        <legend className="label">Holding period</legend>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {HOLDING_PERIODS.map((period) => {
            const active = holdingPeriod === period.id;
            return (
              <button
                key={period.id}
                type="button"
                aria-pressed={active}
                onClick={() => setHoldingPeriod(period.id)}
                title={period.hint}
                className={`min-h-[44px] rounded-xl border px-2 text-xs font-semibold transition active:scale-[0.98] ${
                  active
                    ? 'border-accent-violet/60 bg-accent-violet/15 text-slate-50'
                    : 'border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/25 hover:text-slate-200'
                }`}
              >
                {period.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* ------------------------------------------------------------ risk */}
      <fieldset className="mt-5">
        <legend className="label">Risk profile</legend>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {RISK_STYLES.map((style) => {
            const active = risk === style;
            return (
              <button
                key={style}
                type="button"
                aria-pressed={active}
                onClick={() => setRisk(style)}
                className={`min-h-[52px] rounded-xl border px-2 text-center transition active:scale-[0.98] ${
                  active
                    ? 'border-accent-pink/60 bg-accent-pink/15 text-slate-50'
                    : 'border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/25 hover:text-slate-200'
                }`}
              >
                <span className="block text-xs font-semibold">{style}</span>
                <span className="mt-0.5 block text-[0.65rem] leading-tight text-slate-500">
                  {RISK_HINT[style]}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </form>
  );
}
