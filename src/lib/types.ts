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
  /**
   * True when this print falls at the regular session's close — the closing
   * auction, the last price the regular session produces.
   *
   * Deliberately not the same as `phase === 'regular'`, which is also true of a
   * print taken at 14:00. The difference decides whether a number may be
   * described relative to "the close": a mid-session print is not a close, and
   * a gap measured against one is a different quantity wearing the same name.
   */
  atRegularClose: boolean;
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

/**
 * A price for an instrument's tokenized counterpart on a crypto venue.
 *
 * Kept as its own type, and never merged into `Quote`, because it is not a
 * quote for the equity. Different instrument, different venue, different
 * session rules — collapsing the two into one "price" field is how a tokenized
 * print ends up labelled as a share price, which is the failure this product
 * is built to prevent.
 *
 * Absent (`null`/`undefined`) for most instruments, and for every instrument
 * when the venue cannot be reached. Its absence is the normal state.
 */
export type TokenizedQuote = {
  /** The venue's symbol, e.g. `rNVDA`. */
  symbol: string;
  /** The traded pair, e.g. `rNVDAUSDT`. */
  pair: string;
  /** Last traded price in USDT. */
  price: number;
  /** Percent change over 24h, e.g. 1.82 for +1.82%. Null when not supplied. */
  change24hPercent: number | null;
  /** Unix seconds (UTC), or null when the venue omitted it. */
  timestamp: number | null;
  /** ISO string derived from `timestamp`, or null. */
  asOf: string | null;
  /** Which venue served this, e.g. "Bitget". */
  source: string;
};

/**
 * How far the tokenized counterpart sits from the regular-session print.
 *
 * This is the derived number that makes a tokenized price worth showing. A
 * price on its own says what a crypto venue thinks an instrument is worth; the
 * basis says how far that is from the last price the US tape actually printed,
 * which is the question this product exists to ask. Tokenized equities trade
 * 24/7 and the tape does not, so while the tape is closed this is a live
 * market's opinion of the move since the close — the closest thing to an
 * after-hours read available to a deployment with no extended-hours
 * entitlement.
 *
 * It is emphatically **not** an after-hours move in the equity. Both legs are
 * real observations, but of different instruments on different venues: a token
 * on a crypto order book against a share on an exchange's tape. The gap
 * between two instruments that track the same thing is a real and routinely
 * quoted market signal — and it is not a print of the equity trading after
 * hours. No copy may call it one.
 *
 * Absent whenever either leg is missing, and whenever the reference print is
 * not a regular-session print. See `lib/market/basis.ts` for why that second
 * rule exists.
 */
export type TokenizedBasis = {
  /** Tokenized price minus the reference, in USD/USDT. */
  absolute: number;
  /** The same gap as a percent of the reference, e.g. 2.31 for +2.31%. */
  percent: number;
  /** Where the tokenized market sits relative to the reference. */
  position: 'above' | 'below' | 'level';
  /** The regular-session price the tokenized market is measured against. */
  referencePrice: number;
  /** What that reference is, in plain language — names the session and the time. */
  referenceLabel: string;
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
  /**
   * The tokenized counterpart's price, when the instrument has a verified one
   * and the venue answered. Optional because both halves can be false, and
   * because briefs saved before this field existed are still perfectly
   * renderable without it.
   */
  tokenized?: TokenizedQuote | null;
  /**
   * How far the tokenized counterpart sits from the regular-session print.
   *
   * Absent for the same reasons `tokenized` is, and additionally whenever the
   * reference print is not a regular-session print — see `lib/market/basis.ts`.
   */
  tokenizedBasis?: TokenizedBasis | null;
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
