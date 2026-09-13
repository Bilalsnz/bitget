/**
 * Shared domain types.
 *
 * These are the contract between the market-data layer, the AI layer, the API
 * routes and the UI. The single most important rule encoded here: market
 * numbers are produced by `lib/market`, and the analysis layer *consumes* them.
 * The model is never the source of a price.
 */

/* ------------------------------------------------------------------ verdict */

export const VERDICTS = ['BUY', 'HOLD', 'REDUCE', 'AVOID'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const EXPOSURES = ['SMALL', 'MEDIUM', 'SKIP'] as const;
export type Exposure = (typeof EXPOSURES)[number];

export const HOLDING_PERIODS = [
  { id: 'short', label: 'Short term', hint: 'Days to a couple of weeks' },
  { id: '1m', label: '1 month', hint: 'Roughly 21 trading days' },
  { id: '3m', label: '3 months', hint: 'One quarter' },
  { id: '6m', label: '6 months', hint: 'Two quarters' },
  { id: '12m', label: '12 months', hint: 'One full year' },
] as const;

export type HoldingPeriodId = (typeof HOLDING_PERIODS)[number]['id'];
export const HOLDING_PERIOD_IDS = HOLDING_PERIODS.map((p) => p.id) as readonly HoldingPeriodId[];

export const RISK_STYLES = ['Conservative', 'Moderate', 'Aggressive'] as const;
export type RiskStyle = (typeof RISK_STYLES)[number];

/* -------------------------------------------------------------- market data */

/** Which US trading session a quote timestamp falls into. */
export type SessionPhase = 'pre-market' | 'regular' | 'after-hours' | 'closed';

export type SessionInfo = {
  phase: SessionPhase;
  /** Human label, safe to render directly. */
  label: string;
  /** True when the US equity market is open for regular trading right now. */
  marketOpenNow: boolean;
  /** True when the phase is one of the extended-hours windows. */
  extendedHours: boolean;
  /** ET wall-clock string for the quote timestamp, e.g. "16:00 EDT". */
  etTime: string;
  /** ET calendar day for the quote timestamp, e.g. "Fri 12 Sep 2026". */
  etDate: string;
};

export type Quote = {
  ticker: string;
  /** Last available price from the provider. */
  price: number;
  /** Previous regular-session close. */
  previousClose: number | null;
  /** Absolute change vs previous close. */
  change: number | null;
  /** Percent change vs previous close, e.g. 1.8 for +1.8%. */
  percent: number | null;
  /** Session day open, when the provider supplies it. */
  open: number | null;
  /** Session day high, when the provider supplies it. */
  high: number | null;
  /** Session day low, when the provider supplies it. */
  low: number | null;
  /** Unix seconds (UTC) of the quote, or null when the provider omitted it. */
  timestamp: number | null;
  /** ISO string derived from `timestamp`, or null. */
  asOf: string | null;
  currency: string;
  exchange: string | null;
  /** Which session the quote timestamp belongs to. */
  session: SessionInfo;
  /**
   * Whether the provider actually gave us a distinguishable after-hours print.
   *
   * The free Finnhub tier does NOT expose a separate extended-hours quote, so
   * this is false in practice and the UI says so in plain language rather than
   * dressing a regular-session print up as an after-hours move.
   */
  afterHoursAvailable: boolean;
  /** Plain-language description of what the movement is measured against. */
  movementBasis: string;
};

export type Headline = {
  headline: string;
  source: string;
  url: string;
  /** ISO datetime of publication. */
  datetime: string;
};

export type MarketSnapshot = {
  quote: Quote;
  /** Recent company headlines, when the provider returned any. */
  headlines: Headline[];
  /**
   * The session the exchange reports *right now*, when the provider exposes it.
   *
   * Deliberately separate from `quote.session`: that one describes the moment
   * the quote was printed, this one describes the present. They disagree
   * whenever the market has moved into a session our data plan cannot price,
   * and the UI explains that rather than hiding it. Null when unavailable.
   */
  exchangeSession: SessionPhase | null;
  /** Which provider served the numbers, e.g. "Finnhub". */
  dataSource: string;
  /** True when the numbers came from a synthetic source (never, currently). */
  synthetic: boolean;
  /** Non-fatal problems worth surfacing, e.g. "headlines unavailable". */
  notes: string[];
};

/* ----------------------------------------------------------------- analysis */

export type AnalysisMode = 'live' | 'demo';

export type ResearchRequest = {
  ticker: string;
  holdingPeriod: HoldingPeriodId;
  risk: RiskStyle;
};

export type Analysis = {
  ticker: string;
  verdict: Verdict;
  confidence: number;
  whatChanged: string;
  reasons: string[];
  risks: string[];
  suggestedExposure: Exposure;
};

/**
 * The full payload the UI renders. Market numbers come from `snapshot`;
 * judgement comes from `analysis`. They are never mixed.
 */
export type ResearchResult = {
  request: ResearchRequest;
  snapshot: MarketSnapshot;
  analysis: Analysis;
  /** 'live' when a real model answered, 'demo' when the deterministic engine did. */
  mode: AnalysisMode;
  /** Provider label for the "Analysis mode" indicator. */
  providerLabel: string;
  /** Explains why demo mode is active, without leaking config values. */
  modeReason: string;
};
