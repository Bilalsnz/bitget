/**
 * Brief serialisation — one `ResearchResult` rendered as shareable plain text.
 *
 * This is the module that decides what leaves the app when a reader taps "Copy"
 * or "Share". That makes it an honesty surface, not a formatting detail: a
 * brief that travels to a group chat carries the same obligations as the card
 * it came from, and it arrives with none of the surrounding context. So the
 * provenance line and the research-only disclaimer are part of the text, not
 * optional extras — a copied verdict without them is a number in search of a
 * decision, which is exactly what this product refuses to be.
 *
 * Pure and synchronous on purpose: no DOM, no clipboard, no network. Everything
 * that can fail lives in the component that calls it.
 */

import { getAsset } from './assets';
import { REGULAR_SESSION_NOTICE, RESEARCH_NOTICE } from './disclaimers';
import { EXPOSURES, HOLDING_PERIODS, VERDICTS, type ResearchResult } from './types';

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

const isText = (input: unknown): input is string => typeof input === 'string';
const isNumber = (input: unknown): boolean => typeof input === 'number' && Number.isFinite(input);
const isNullableNumber = (input: unknown): boolean => input === null || isNumber(input);
const isTextArray = (input: unknown): input is string[] =>
  Array.isArray(input) && input.every(isText);

/**
 * Structural check for a payload before anything renders or persists it.
 *
 * Deliberately shallow per field but complete per *shape*: it verifies exactly
 * what the card, the snapshot panel and the brief serialiser read, and no more.
 * That boundary is drawn by the two callers, which are not the same:
 *
 *   - an API response, already validated server-side by `lib/schema.ts`;
 *   - **a localStorage entry**, which nothing validated. It was written by some
 *     earlier version of this app, or by whoever opened devtools. A missing
 *     `quote.session` there is not a theoretical concern — it is a thrown
 *     render that takes the whole desk down with it.
 *
 * So the enum fields are checked against their real value sets rather than for
 * being strings. `verdict` and `suggestedExposure` are used as lookup keys into
 * style maps; a stray value would index to `undefined` and crash on the first
 * property read. Rejecting the entry is the honest outcome — a brief this app
 * cannot faithfully render is better dropped than half-shown.
 */
export function isResearchResult(input: unknown): input is ResearchResult {
  if (!isPlainRecord(input)) return false;

  const request = input.request;
  const snapshot = input.snapshot;
  const analysis = input.analysis;
  if (!isPlainRecord(request) || !isPlainRecord(snapshot) || !isPlainRecord(analysis)) return false;

  const quote = snapshot.quote;
  if (!isPlainRecord(quote)) return false;

  const session = quote.session;
  if (!isPlainRecord(session)) return false;

  const headlines = snapshot.headlines;
  const headlinesOk =
    Array.isArray(headlines) &&
    headlines.every(
      (item) =>
        isPlainRecord(item) &&
        isText(item.headline) &&
        isText(item.source) &&
        isText(item.url) &&
        isText(item.datetime),
    );

  // Optional, and validated only when present — briefs saved before this field
  // existed are still perfectly renderable, so requiring it would reject every
  // previously stored entry. But when it *is* present it has to be sound: the
  // badge formats `price` and calls `toFixed` on `change24hPercent`, and a
  // string in either would throw inside the render rather than degrade. That is
  // the localStorage case this guard exists for — the entry was written by some
  // earlier version of this app, or by whoever opened devtools.
  const tokenized = snapshot.tokenized;
  const tokenizedOk =
    tokenized === undefined ||
    tokenized === null ||
    (isPlainRecord(tokenized) &&
      isText(tokenized.symbol) &&
      isText(tokenized.pair) &&
      isNumber(tokenized.price) &&
      isNullableNumber(tokenized.change24hPercent) &&
      isText(tokenized.source));

  return (
    // request — read for the title, the history row and the brief header.
    isText(request.ticker) &&
    isText(request.holdingPeriod) &&
    isText(request.risk) &&
    // quote — every number the analysis is allowed to cite.
    isNumber(quote.price) &&
    isNullableNumber(quote.previousClose) &&
    isNullableNumber(quote.change) &&
    isNullableNumber(quote.percent) &&
    isNullableNumber(quote.open) &&
    isNullableNumber(quote.high) &&
    isNullableNumber(quote.low) &&
    isText(quote.currency) &&
    isText(quote.movementBasis) &&
    typeof quote.afterHoursAvailable === 'boolean' &&
    (quote.asOf === null || isText(quote.asOf)) &&
    // session — the after-hours labelling rules are read off these three.
    isText(session.label) &&
    isText(session.etTime) &&
    isText(session.etDate) &&
    // snapshot — the provenance line and the notes list.
    isText(snapshot.dataSource) &&
    isTextArray(snapshot.notes) &&
    headlinesOk &&
    tokenizedOk &&
    // analysis — the verdict and the exposure index into style maps.
    (VERDICTS as readonly string[]).includes(analysis.verdict as string) &&
    isNumber(analysis.confidence) &&
    isText(analysis.whatChanged) &&
    isTextArray(analysis.reasons) &&
    isTextArray(analysis.risks) &&
    (EXPOSURES as readonly string[]).includes(analysis.suggestedExposure as string) &&
    // provenance of the analysis itself — rendered verbatim on the card.
    (input.mode === 'live' || input.mode === 'demo') &&
    isText(input.providerLabel) &&
    isText(input.modeReason)
  );
}

/** "AAPL · BUY · 1 month" — compact enough for a share sheet subject line. */
export function briefTitle(result: ResearchResult): string {
  const period = HOLDING_PERIODS.find((p) => p.id === result.request.holdingPeriod);
  return `${result.request.ticker} · ${result.analysis.verdict} · ${period?.label ?? result.request.holdingPeriod}`;
}

/**
 * The one-line summary a share sheet shows. States the stance and immediately
 * disclaims it, because this string is the part that gets read when nobody
 * opens the full brief.
 */
export function briefSummary(result: ResearchResult): string {
  const { analysis, request } = result;
  const period = HOLDING_PERIODS.find((p) => p.id === request.holdingPeriod);
  return (
    `${request.ticker} research brief (${period?.label ?? request.holdingPeriod}, ${request.risk} risk): ` +
    `${analysis.verdict} at ${analysis.confidence}/100 confidence. ` +
    RESEARCH_NOTICE
  );
}

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'unavailable' : MONEY.format(value);
}

function signedMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unavailable';
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${MONEY.format(Math.abs(value))}`;
}

function signedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unavailable';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function numbered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

/**
 * Render the full brief as plain text.
 *
 * Section order mirrors the card so a reader moving between the two is not
 * re-orienting: what moved, what it means, why, what would prove it wrong, the
 * evidence, the provenance, the disclaimer.
 */
export function briefToText(result: ResearchResult): string {
  const { request, snapshot, analysis } = result;
  const { quote } = snapshot;
  const asset = getAsset(request.ticker);
  const period = HOLDING_PERIODS.find((p) => p.id === request.holdingPeriod);
  const exposure = analysis.suggestedExposure;

  const priceLine = quote.afterHoursAvailable
    ? 'Extended-hours quote'
    : 'Price (latest available regular-session print)';

  return [
    `AfterHours AI — research brief`,
    `${request.ticker}${asset ? ` · ${asset.name}` : ''} · ${period?.label ?? request.holdingPeriod} · ${request.risk} risk`,
    '',
    `VERDICT: ${analysis.verdict} (confidence ${analysis.confidence}/100)`,
    `Suggested exposure: ${exposure}`,
    '',
    'WHAT CHANGED',
    analysis.whatChanged,
    '',
    'WHY',
    numbered(analysis.reasons),
    '',
    'WHAT WOULD PROVE THIS WRONG',
    numbered(analysis.risks),
    '',
    'MARKET SNAPSHOT',
    `${priceLine}: ${money(quote.price)} ${quote.currency}`,
    `Change vs previous close: ${signedMoney(quote.change)} (${signedPercent(quote.percent)})`,
    `Session at print: ${quote.session.label} · ${quote.session.etTime}, ${quote.session.etDate}`,
    `Quote timestamp: ${quote.asOf ?? 'unavailable'}`,
    `Data source: ${snapshot.dataSource}`,
    `Movement basis: ${quote.movementBasis}`,
    '',
    // The tokenized counterpart, when there is one and it answered. Present
    // only alongside its own labels: the venue, the pair, and a sentence
    // saying what the instrument is. A figure that travelled into a group chat
    // without them would read as a price for the *equity*, which is the one
    // thing it is not.
    ...(snapshot.tokenized
      ? [
          `TOKENIZED COUNTERPART (${snapshot.tokenized.source})`,
          `${snapshot.tokenized.symbol} · ${money(snapshot.tokenized.price)} · ${signedPercent(
            snapshot.tokenized.change24hPercent,
          )} over 24h`,
          ...(snapshot.tokenized.asOf ? [`Priced: ${snapshot.tokenized.asOf}`] : []),
          `Separate tokenized instrument tracking ${request.ticker} — not a share, and not an after-hours print for ${request.ticker}.`,
          '',
        ]
      : []),
    // The same two lines the card carries, in the same words. A brief that
    // leaves the app must not become the one place these go missing. The
    // session line is conditional for the same reason it is on the card: it
    // describes this plan's limits, so it must not outlive them.
    ...(quote.afterHoursAvailable ? [] : [REGULAR_SESSION_NOTICE]),
    RESEARCH_NOTICE,
    '',
    'ANALYSIS SOURCE',
    `${result.mode === 'live' ? 'Live AI analysis' : 'Demo analysis'} · ${result.providerLabel}`,
    result.modeReason,
    '',
    snapshot.headlines.length > 0
      ? `Headlines referenced (${snapshot.dataSource}, shown as published):\n${snapshot.headlines
          .map((h) => `- [${h.source}] ${h.headline}`)
          .join('\n')}`
      : `No headlines were retrieved from ${snapshot.dataSource} for this brief.`,
  ].join('\n');
}
