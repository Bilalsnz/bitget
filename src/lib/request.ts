/**
 * Request parsing and validation shared by the API routes.
 *
 * All user input crosses exactly one boundary, and this is it. Anything that
 * reaches the market or AI layers has already been normalised to a known
 * ticker, a known holding period and a known risk style — so downstream code
 * never has to ask "what if this string is something else?".
 */

import { AppError } from './errors';
import { getAsset, symbolShape } from './assets';
import {
  HOLDING_PERIOD_IDS,
  RISK_STYLES,
  type HoldingPeriodId,
  type ResearchRequest,
  type RiskStyle,
} from './types';

/**
 * Normalise a ticker to a supported symbol.
 *
 * Throws `INVALID_TICKER` for something that is not shaped like a symbol at all
 * and `UNSUPPORTED_TICKER` for a well-formed symbol we do not cover — two
 * genuinely different situations that deserve different copy.
 */
export function parseTicker(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new AppError('INVALID_TICKER', `Ticker was ${typeof input}, expected a non-empty string.`);
  }

  const symbol = symbolShape(input);
  if (!symbol) {
    throw new AppError('INVALID_TICKER', `Ticker is not symbol-shaped: ${JSON.stringify(input.slice(0, 24))}`);
  }

  if (!getAsset(symbol)) {
    throw new AppError('UNSUPPORTED_TICKER', `${symbol} is not in the supported instrument list.`);
  }

  return symbol;
}

function parseHoldingPeriod(input: unknown): HoldingPeriodId {
  if (typeof input === 'string' && (HOLDING_PERIOD_IDS as readonly string[]).includes(input)) {
    return input as HoldingPeriodId;
  }
  throw new AppError('BAD_REQUEST', `holdingPeriod must be one of ${HOLDING_PERIOD_IDS.join(', ')}.`);
}

function parseRisk(input: unknown): RiskStyle {
  if (typeof input === 'string' && (RISK_STYLES as readonly string[]).includes(input)) {
    return input as RiskStyle;
  }
  throw new AppError('BAD_REQUEST', `risk must be one of ${RISK_STYLES.join(', ')}.`);
}

/**
 * Validate a research request from an untrusted JSON body.
 *
 * Defaults are applied for absent optional fields so the API stays usable from
 * a bare `{"ticker": "AAPL"}` — but a *present* value that is wrong is always
 * rejected rather than silently replaced with the default, because silently
 * changing what the user asked for is how a tool loses their trust.
 */
export function parseResearchRequest(body: unknown): ResearchRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('BAD_REQUEST', 'Request body must be a JSON object.');
  }

  const raw = body as Record<string, unknown>;

  return {
    ticker: parseTicker(raw.ticker),
    holdingPeriod: raw.holdingPeriod === undefined ? '1m' : parseHoldingPeriod(raw.holdingPeriod),
    risk: raw.risk === undefined ? 'Moderate' : parseRisk(raw.risk),
  };
}
