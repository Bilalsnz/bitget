/**
 * Strict validation for model output.
 *
 * The governing principle: **nothing the model returns is rendered until it has
 * been shape-checked, range-checked and sanitised here.** A model that returns
 * prose instead of JSON, four risks instead of three, or a confidence of 940
 * must degrade to a labelled fallback — never to a broken card.
 *
 * Hand-rolled rather than schema-library-driven so the exact validation rules
 * are readable in one file and testable without a build step.
 */

import { EXPOSURES, VERDICTS, type Analysis, type Exposure, type Verdict } from './types';

export type ValidationResult =
  | { ok: true; value: Analysis }
  | { ok: false; errors: string[] };

/** Text fields are capped so a runaway model can't blow up the layout. */
const MAX_WHAT_CHANGED = 480;
const MAX_BULLET = 220;
const MIN_BULLET = 12;

/** Strip control characters, collapse whitespace, drop markdown emphasis. */
export function sanitiseText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    // control chars except tab/newline
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // markdown emphasis / heading markers the model likes to add
    .replace(/[*_`#]+/g, '')
    // markdown list leaders at line start
    .replace(/^\s*[-•\d]+[.)]?\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/**
 * Pull a JSON object out of a model response that may be wrapped in prose or
 * a ```json fence. Returns null when no plausible object can be recovered.
 */
export function extractJsonObject(raw: string): unknown {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  // ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // First "{" through last "}" — catches "Here is the analysis: {...} Thanks!"
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function coerceStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map(sanitiseText).filter(Boolean);
}

function coerceVerdict(input: unknown): Verdict | null {
  const raw = sanitiseText(input).toUpperCase();
  return (VERDICTS as readonly string[]).includes(raw) ? (raw as Verdict) : null;
}

function coerceExposure(input: unknown): Exposure | null {
  const raw = sanitiseText(input).toUpperCase();
  return (EXPOSURES as readonly string[]).includes(raw) ? (raw as Exposure) : null;
}

/**
 * Confidence: accept 0–100, or 0–1 (models sometimes emit a probability).
 * Anything outside a plausible band is rejected rather than clamped, so a
 * nonsense number surfaces as a validation failure instead of a confident lie.
 */
export function coerceConfidence(input: unknown): number | null {
  let n: number;
  if (typeof input === 'number') n = input;
  else if (typeof input === 'string') {
    const cleaned = input.replace(/[%\s]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    n = Number(cleaned);
  } else return null;

  if (!Number.isFinite(n)) return null;
  if (n > 0 && n <= 1) n = n * 100; // probability form
  n = Math.round(n);
  if (n < 0 || n > 100) return null;
  return n;
}

export type ExpectedTicker = { ticker: string };

/**
 * Validate a parsed model object into an `Analysis`.
 *
 * `expectedTicker` guards against a model that answers about the wrong symbol —
 * a real failure mode when the prompt contains several tickers.
 */
export function validateAnalysis(input: unknown, expectedTicker: string): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ['Response was not a JSON object.'] };
  }

  const ticker = sanitiseText(input.ticker).toUpperCase();
  if (ticker && ticker !== expectedTicker.toUpperCase()) {
    errors.push(`Response was about ${ticker}, expected ${expectedTicker.toUpperCase()}.`);
  }

  const verdict = coerceVerdict(input.verdict);
  if (!verdict) {
    errors.push('verdict must be one of BUY, HOLD, REDUCE, AVOID.');
  }

  const confidence = coerceConfidence(input.confidence);
  if (confidence === null) {
    errors.push('confidence must be a number between 0 and 100.');
  }

  const whatChanged = sanitiseText(input.whatChanged);
  if (whatChanged.length < 20) {
    errors.push('whatChanged must be a substantive sentence.');
  } else if (whatChanged.length > MAX_WHAT_CHANGED) {
    errors.push(`whatChanged must be under ${MAX_WHAT_CHANGED} characters.`);
  }

  const reasons = coerceStringArray(input.reasons);
  if (reasons.length !== 3) {
    errors.push(`reasons must contain exactly 3 items (received ${reasons.length}).`);
  } else if (reasons.some((r) => r.length < MIN_BULLET || r.length > MAX_BULLET)) {
    errors.push('each reason must be between 12 and 220 characters.');
  }

  const risks = coerceStringArray(input.risks);
  if (risks.length !== 3) {
    errors.push(`risks must contain exactly 3 items (received ${risks.length}).`);
  } else if (risks.some((r) => r.length < MIN_BULLET || r.length > MAX_BULLET)) {
    errors.push('each risk must be between 12 and 220 characters.');
  }

  const suggestedExposure = coerceExposure(input.suggestedExposure);
  if (!suggestedExposure) {
    errors.push('suggestedExposure must be one of SMALL, MEDIUM, SKIP.');
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      ticker: expectedTicker.toUpperCase(),
      verdict: verdict as Verdict,
      confidence: confidence as number,
      whatChanged,
      reasons,
      risks,
      suggestedExposure: suggestedExposure as Exposure,
    },
  };
}

/** Convenience wrapper for callers that already parsed the JSON. */
export function parseAndValidateAnalysis(
  raw: string,
  expectedTicker: string,
): ValidationResult {
  const parsed = extractJsonObject(raw);
  if (parsed === null) {
    return { ok: false, errors: ['Response did not contain a parseable JSON object.'] };
  }
  return validateAnalysis(parsed, expectedTicker);
}
