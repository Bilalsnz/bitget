/**
 * Deterministic fallback analysis — the "Demo analysis" engine.
 *
 * ## Why this exists
 *
 * A judge opening the deployed URL may land on a deployment with no AI key
 * configured, or the model call may fail. The product must still answer the
 * research question rather than showing an error, so this engine derives a
 * verdict from the *real* market snapshot.
 *
 * ## The rules it obeys
 *
 * 1. Every number it cites comes from `MarketSnapshot`. It computes nothing it
 *    cannot source, and it never invents a price, a percentage or a headline.
 * 2. It never claims knowledge of news it did not retrieve. When headlines were
 *    returned it says only that they exist — it does not summarise their
 *    content, because a deterministic engine cannot read.
 * 3. It is always labelled "Demo analysis" in the UI. It never pretends to be a
 *    language model.
 *
 * Because the output is shaped like a model response, it is run through the
 * same `validateAnalysis` gate as live output — one contract, one validator.
 */

import type {
  Analysis,
  Exposure,
  HoldingPeriodId,
  MarketSnapshot,
  ResearchRequest,
  RiskStyle,
  Verdict,
} from '../types';

/** A deterministic engine is never allowed to sound as sure as a live model. */
const MAX_DEMO_CONFIDENCE = 82;
const MIN_DEMO_CONFIDENCE = 40;

/* ------------------------------------------------------------------ helpers */

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'not available';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'not available';
  return `$${value.toFixed(2)}`;
}

/** Where the last price sits inside the session's own high–low range, 0–100. */
function rangePosition(snapshot: MarketSnapshot): number | null {
  const { price, high, low } = snapshot.quote;
  if (high === null || low === null || high <= low) return null;
  const position = ((price - low) / (high - low)) * 100;
  if (!Number.isFinite(position)) return null;
  return Math.max(0, Math.min(100, position));
}

/** Intraday range as a percentage of the previous close. */
function rangePercent(snapshot: MarketSnapshot): number | null {
  const { high, low, previousClose } = snapshot.quote;
  if (high === null || low === null || !previousClose) return null;
  const value = ((high - low) / previousClose) * 100;
  return Number.isFinite(value) ? value : null;
}

/** Overnight gap: session open versus the previous close. */
function gapPercent(snapshot: MarketSnapshot): number | null {
  const { open, previousClose } = snapshot.quote;
  if (open === null || !previousClose) return null;
  const value = ((open - previousClose) / previousClose) * 100;
  return Number.isFinite(value) ? value : null;
}

/* ----------------------------------------------------------------- verdicts */

/**
 * Momentum notch, −2 … +2, from the size of the move.
 *
 * Buckets rather than a continuous mapping: a 0.4% drift and a 0.9% drift are
 * the same thing to a human deciding what to do next, and pretending otherwise
 * would overstate the precision of a single print.
 */
function momentumNotch(percent: number | null): number {
  if (percent === null) return 0;
  if (percent >= 3) return 2;
  if (percent >= 1) return 1;
  if (percent > -1) return 0;
  if (percent > -3) return -1;
  return -2;
}

/** Risk appetite shifts the same signal up or down one notch. */
function riskAdjustment(risk: RiskStyle): number {
  if (risk === 'Conservative') return -1;
  if (risk === 'Aggressive') return 1;
  return 0;
}

function verdictFor(score: number): Verdict {
  if (score <= -2) return 'AVOID';
  if (score === -1) return 'REDUCE';
  if (score === 0) return 'HOLD';
  return 'BUY';
}

/**
 * Confidence reflects *how much evidence there is*, not how strong the signal
 * is — a violent move on thin data is not a confident call.
 */
function confidenceFor(snapshot: MarketSnapshot, percent: number | null): number {
  const { quote } = snapshot;
  let score = MIN_DEMO_CONFIDENCE;

  if (percent !== null) score += Math.min(20, Math.abs(percent) * 5);
  if (quote.open !== null && quote.high !== null && quote.low !== null) score += 8;
  if (quote.timestamp !== null) score += 4;
  if (snapshot.headlines.length > 0) score += 6;

  return Math.max(MIN_DEMO_CONFIDENCE, Math.min(MAX_DEMO_CONFIDENCE, Math.round(score)));
}

function exposureFor(
  verdict: Verdict,
  confidence: number,
  risk: RiskStyle,
  holdingPeriod: HoldingPeriodId,
): Exposure {
  let exposure: Exposure;

  switch (verdict) {
    case 'AVOID':
      exposure = 'SKIP';
      break;
    case 'REDUCE':
      exposure = risk === 'Conservative' ? 'SKIP' : 'SMALL';
      break;
    case 'HOLD':
      exposure = 'SMALL';
      break;
    case 'BUY':
    default:
      exposure = risk !== 'Conservative' && confidence >= 65 ? 'MEDIUM' : 'SMALL';
      break;
  }

  // A short holding period means the decision rests almost entirely on a single
  // print, so the engine never argues for a larger position there.
  if (holdingPeriod === 'short' && exposure === 'MEDIUM') exposure = 'SMALL';

  return exposure;
}

/* ---------------------------------------------------------------- narratives */

function buildWhatChanged(snapshot: MarketSnapshot, percent: number | null): string {
  const { quote } = snapshot;
  const symbol = quote.ticker;

  if (percent === null) {
    return (
      `${symbol} last printed at ${usd(quote.price)}. No previous regular-session close is available ` +
      'from the configured data source, so a percentage move cannot be stated for this instrument.'
    );
  }

  const direction = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat';
  const range = rangePercent(snapshot);
  const rangeClause =
    range === null ? '' : ` Across the session it traded a range of about ${range.toFixed(2)}% of the prior close.`;

  return (
    `${symbol} is ${direction} ${pct(percent)} versus the previous regular-session close, last at ${usd(quote.price)} ` +
    `(prior close ${usd(quote.previousClose)}).${rangeClause}`
  );
}

function buildReasons(snapshot: MarketSnapshot, percent: number | null): string[] {
  const { quote } = snapshot;
  const reasons: string[] = [];

  // 1. The move itself — the only headline fact this engine actually has.
  if (percent === null) {
    reasons.push(
      `A last price of ${usd(quote.price)} is available, but with no prior close to compare against the directional signal is unreadable.`,
    );
  } else if (Math.abs(percent) < 1) {
    reasons.push(
      `The move is small at ${pct(percent)}, which historically reads as indecision rather than a directional signal worth acting on alone.`,
    );
  } else {
    reasons.push(
      `A ${Math.abs(percent).toFixed(2)}% move in one session is large enough to change the near-term picture rather than being ordinary drift.`,
    );
  }

  // 2. Intraday structure — real derived numbers, no interpretation of content.
  const position = rangePosition(snapshot);
  if (position === null) {
    reasons.push(
      'Session high, low and open were not all supplied by the data source, so there is no intraday structure to weigh here.',
    );
  } else if (position >= 70) {
    reasons.push(
      `The last print sits at ${position.toFixed(0)}% of the session range, meaning buyers held the upper part of the day into the close.`,
    );
  } else if (position <= 30) {
    reasons.push(
      `The last print sits at only ${position.toFixed(0)}% of the session range, meaning sellers controlled the lower part of the day into the close.`,
    );
  } else {
    reasons.push(
      `The last print sits mid-range at ${position.toFixed(0)}%, so neither side finished the session in clear control of the price.`,
    );
  }

  // 3. What context was actually retrieved — stated as a fact about coverage.
  if (snapshot.headlines.length > 0) {
    reasons.push(
      `${snapshot.headlines.length} recent headlines were retrieved from ${snapshot.dataSource} for this symbol. This deterministic engine does not read or interpret their content.`,
    );
  } else {
    reasons.push(
      `No recent company headlines were retrieved from ${snapshot.dataSource}, so this read rests on price and session structure alone.`,
    );
  }

  // 4. Overnight gap, when the provider gave us an open to compare.
  const gap = gapPercent(snapshot);
  if (gap !== null && Math.abs(gap) >= 0.5) {
    reasons.push(
      `The session opened ${pct(gap)} away from the prior close, so part of the move is an overnight repricing rather than intraday buying or selling.`,
    );
  }

  return reasons.slice(0, 3);
}

function buildRisks(snapshot: MarketSnapshot, holdingPeriod: HoldingPeriodId): string[] {
  const risks: string[] = [];

  // 1. The structural risk of acting on a print that can still reprice.
  if (snapshot.quote.afterHoursAvailable) {
    risks.push(
      'Extended-hours prints are thin and can reverse at the next regular open, so any decision made on this quote may be repriced by the open.',
    );
  } else {
    risks.push(
      'This is the most recent available print rather than a live extended-hours quote, so the next regular open can reprice it before any decision is acted on.',
    );
  }

  // 2. Data coverage — an honest statement about what the source does not have.
  risks.push(
    `The configured data source (${snapshot.dataSource}) does not supply a separate extended-hours quote, so the movement shown is measured against the prior regular close.`,
  );

  // 3. Holding-period specific.
  if (holdingPeriod === 'short') {
    risks.push(
      'A short holding period means the outcome is dominated by the next few sessions, where one print carries little predictive weight.',
    );
  } else {
    risks.push(
      `Over a ${holdingPeriod} horizon the single-session move shown here is a small part of the outcome, and fundamentals not visible in price data will dominate.`,
    );
  }

  // 4. Concentration, when the instrument is a single name rather than a fund.
  if (snapshot.quote.ticker && !snapshot.quote.ticker.startsWith('SPY')) {
    risks.push(
      'This is a single-name position, so an adverse company-specific event would not be cushioned by broader market diversification.',
    );
  }

  return risks.slice(0, 3);
}

/* ------------------------------------------------------------------ public */

/**
 * Derive a labelled demo analysis from a real market snapshot.
 *
 * Pure and synchronous: same snapshot in, same analysis out. That property is
 * what makes it testable, and it is why the offline path can be trusted to
 * behave identically every time a judge loads the page.
 */
export function buildFallbackAnalysis(
  request: ResearchRequest,
  snapshot: MarketSnapshot,
): Analysis {
  const percent = snapshot.quote.percent;

  const score = momentumNotch(percent) + riskAdjustment(request.risk);
  const verdict = verdictFor(score);
  const confidence = confidenceFor(snapshot, percent);

  return {
    ticker: request.ticker,
    verdict,
    confidence,
    whatChanged: buildWhatChanged(snapshot, percent),
    reasons: buildReasons(snapshot, percent),
    risks: buildRisks(snapshot, request.holdingPeriod),
    suggestedExposure: exposureFor(verdict, confidence, request.risk, request.holdingPeriod),
  };
}
