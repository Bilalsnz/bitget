/**
 * Prompt construction for the live analysis call.
 *
 * The single rule this file exists to enforce:
 *
 *   **The model is never the source of a market number.**
 *
 * Every figure the analysis may cite is placed in the prompt verbatim, straight
 * from `MarketSnapshot`. The model's job is interpretation — what the move
 * means for someone deciding what to do next — not arithmetic. If a number is
 * not in this prompt, the model is instructed to say it is unavailable rather
 * than to supply one from memory, which is exactly the failure mode that would
 * put a fabricated price in front of a user.
 */

import type { HoldingPeriodId, MarketSnapshot, ResearchRequest, RiskStyle } from '../types';
import { HOLDING_PERIODS } from '../types';

/* ------------------------------------------------------------- json contract */

/**
 * The structured-output schema handed to the API.
 *
 * It mirrors `validateAnalysis` in `lib/schema.ts`. Both exist deliberately:
 * the schema makes malformed output unlikely at the source, and the validator
 * makes it harmless if it happens anyway. Never remove the validator on the
 * grounds that the schema "guarantees" the shape — a guarantee from a remote
 * service is not a guarantee.
 */
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ticker: {
      type: 'string',
      description: 'The ticker symbol this analysis is about, exactly as supplied.',
    },
    verdict: {
      type: 'string',
      enum: ['BUY', 'HOLD', 'REDUCE', 'AVOID'],
      description: 'The overall stance for the stated holding period.',
    },
    confidence: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: 'How well-evidenced this call is. 0-100. Not how strong the signal is.',
    },
    whatChanged: {
      type: 'string',
      description: 'One or two sentences on what moved and why it matters. Under 480 characters.',
    },
    reasons: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
      description: 'Exactly three supporting reasons, each 12-220 characters.',
    },
    risks: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
      description: 'Exactly three risks that would invalidate the call, each 12-220 characters.',
    },
    suggestedExposure: {
      type: 'string',
      enum: ['SMALL', 'MEDIUM', 'SKIP'],
      description: 'How much exposure the evidence supports. MEDIUM is the ceiling.',
    },
  },
  required: ['ticker', 'verdict', 'confidence', 'whatChanged', 'reasons', 'risks', 'suggestedExposure'],
  additionalProperties: false,
} as const;

/* ------------------------------------------------------------------- prompts */

const HOLDING_LABEL: Record<HoldingPeriodId, string> = HOLDING_PERIODS.reduce(
  (acc, period) => {
    acc[period.id] = `${period.label} (${period.hint})`;
    return acc;
  },
  {} as Record<HoldingPeriodId, string>,
);

const RISK_GUIDANCE: Record<RiskStyle, string> = {
  Conservative:
    'The reader is conservative: capital preservation outranks upside, and a marginal signal is not worth acting on.',
  Moderate: 'The reader is moderate: they will accept normal market risk for a well-evidenced view.',
  Aggressive:
    'The reader is aggressive: they will accept volatility, but this does not license a larger position than the evidence supports.',
};

export function buildSystemPrompt(): string {
  return [
    'You are the analyst behind AfterHours AI, a research desk that helps a retail investor answer one question:',
    '"What changed after the US market close, and what should I consider doing next?"',
    '',
    'You produce decision support, not instructions. You are not a financial adviser and you do not place orders.',
    '',
    '## Non-negotiable rules',
    '',
    '1. Every market number you cite must be copied verbatim from the MARKET DATA block in the user message.',
    '   You must never state, estimate, recall or infer a price, percentage, volume, market cap or index level',
    '   that is not written there. If a figure is absent, say it is unavailable — do not fill the gap.',
    '2. You must never claim to know the content of a news story you were not given. Headlines supplied in the',
    '   MARKET DATA block may be referenced, but only for what they literally say. No invented context, no',
    '   invented earnings results, no invented analyst actions, no invented deals.',
    '3. Do not invent an after-hours or pre-market price. The data block states plainly whether a distinct',
    '   extended-hours quote exists. If it does not, treat the quoted price as the most recent available print',
    '   and say so rather than describing it as an after-hours move.',
    '4. Never describe a position size in currency, share count or portfolio percentage. Exposure is reported',
    '   only as one of the three allowed categories.',
    '5. Write plainly and specifically. No hype, no hedging filler, no emoji, no markdown formatting.',
    '',
    '## How to choose a verdict',
    '',
    'BUY — the evidence supports adding exposure. HOLD — the evidence supports neither adding nor reducing.',
    'REDUCE — the evidence supports trimming. AVOID — the evidence supports staying out entirely.',
    'Match the verdict to the reader\'s stated holding period: a move that is decisive over one month may be',
    'noise over twelve.',
    '',
    '## Confidence',
    '',
    'Confidence measures how much evidence supports the call, not how large the move was. A dramatic move on',
    'thin or missing data is a low-confidence call. A small move on complete data is not automatically high.',
    'Be willing to give a low number.',
    '',
    '## Risks',
    '',
    'The three risks must be specific ways this call could be wrong for this instrument and this holding period.',
    'Do not list generic disclaimers such as "markets are volatile" or "past performance is not indicative".',
    'At least one risk should address the limits of the data you were actually given.',
    '',
    '## Output',
    '',
    'Return only the JSON object described by the schema. Exactly three reasons and exactly three risks.',
  ].join('\n');
}

function fmt(value: number | null, unit: 'usd' | 'pct' = 'usd'): string {
  if (value === null || !Number.isFinite(value)) return 'unavailable';
  if (unit === 'pct') return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  return `$${value.toFixed(2)}`;
}

/**
 * The MARKET DATA block.
 *
 * Every line is either a real value from the snapshot or the literal token
 * `unavailable` — there is no third option, and no field is silently omitted,
 * because a field the model cannot see is a field it might invent.
 */
function marketDataBlock(snapshot: MarketSnapshot): string {
  const { quote } = snapshot;

  const lines = [
    `Ticker: ${quote.ticker}`,
    `Data source: ${snapshot.dataSource}`,
    `Last price: ${fmt(quote.price)} ${quote.currency}`,
    `Previous regular-session close: ${fmt(quote.previousClose)}`,
    `Change vs previous close: ${fmt(quote.change)}`,
    `Change vs previous close (%): ${fmt(quote.percent, 'pct')}`,
    `Session open: ${fmt(quote.open)}`,
    `Session high: ${fmt(quote.high)}`,
    `Session low: ${fmt(quote.low)}`,
    `Quote timestamp: ${quote.asOf ?? 'unavailable'}`,
    `Session at that timestamp: ${quote.session.label}`,
    `New York time of that print: ${quote.session.etTime}`,
    `A separate extended-hours quote is available: ${quote.afterHoursAvailable ? 'yes' : 'no'}`,
    `What the percentage is measured against: ${quote.movementBasis}`,
  ];

  if (quote.exchange) lines.push(`Exchange: ${quote.exchange}`);

  lines.push('', 'Headlines retrieved for this symbol (most recent first):');

  if (snapshot.headlines.length === 0) {
    lines.push('- None were retrieved. Do not refer to any news for this symbol.');
  } else {
    for (const headline of snapshot.headlines) {
      lines.push(`- [${headline.source}] ${headline.headline}`);
    }
  }

  if (snapshot.notes.length > 0) {
    lines.push('', 'Data limitations reported by the data layer:');
    for (const note of snapshot.notes) lines.push(`- ${note}`);
  }

  return lines.join('\n');
}

export function buildUserPrompt(request: ResearchRequest, snapshot: MarketSnapshot): string {
  return [
    '## MARKET DATA',
    '',
    marketDataBlock(snapshot),
    '',
    '## REQUEST',
    '',
    `Instrument: ${request.ticker}`,
    `Holding period: ${HOLDING_LABEL[request.holdingPeriod]}`,
    `Risk profile: ${request.risk}`,
    RISK_GUIDANCE[request.risk],
    '',
    '## TASK',
    '',
    `Answer the research question for ${request.ticker} over the stated holding period, using only the data above.`,
    'Say what changed, whether it changes what someone should consider doing next, and what would prove that wrong.',
  ].join('\n');
}
