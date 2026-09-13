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

/* ------------------------------------------------- session-label enforcement */

/**
 * Refuse text that labels a regular-session price as an after-hours one.
 *
 * ## Why this exists in the validator and not only in the prompt
 *
 * The prompt bans the wording explicitly, in three places. A prompt is a
 * request, though, and this particular mistake is the one that actually reached
 * a reader: a correct price under a wrong session label. That failure is worse
 * than a wrong number, because a plausible figure under a plausible label does
 * not look like an error — nobody re-checks it. So the last gate before
 * rendering enforces it too.
 *
 * ## Why it is a heuristic rather than a ban on the words
 *
 * Telling the reader "this data plan provides no after-hours quote" is *desired*
 * output — it is the honesty this product is built on. A blunt ban on the
 * vocabulary would suppress exactly the sentences worth keeping. So the rule
 * targets the *assertion*: a session label attached to a thing that has a
 * price. Negated forms are recognised, before and after the label, and each
 * sentence is judged on its own so a disclaimer in one cannot license an
 * assertion in the next.
 *
 * The cost of a false positive is a demo-labelled card, which is safe. The cost
 * of a false negative is the bug this was written for. The rules lean
 * accordingly.
 */
const SESSION_LABEL = String.raw`(?:after[-\s]?hours|extended[-\s]?hours|post[-\s]?market|pre[-\s]?market)`;

/** A session label attached to something that has a price, or used adverbially. */
const ASSERTED_SESSION = new RegExp(
  String.raw`\b(?:in|during)\s+${SESSION_LABEL}\b` +
    String.raw`|\b${SESSION_LABEL}\s+(?:print|price|quote|move|gain|rise|rose|fall|fell|drop|decline|rally|trade|trading|action|session|activity|volume|market|level|number)\b`,
  'i',
);

/** "no separate after-hours quote", "rather than a live extended-hours print" */
const NEGATED_BEFORE = new RegExp(
  String.raw`\b(?:no|not|cannot|can't|without|never|lacks?|unavailable|isn't|aren't|doesn't|don't|` +
    String.raw`rather\s+than|instead\s+of|does\s+not|do\s+not|is\s+not|are\s+not)\b[^.]{0,48}?\b${SESSION_LABEL}`,
  'i',
);

/** "extended-hours trading is not reflected in this price" */
const NEGATED_AFTER = new RegExp(
  String.raw`\b${SESSION_LABEL}\b[^.]{0,48}?\b(?:is\s+not|isn't|are\s+not|aren't|cannot|can't|` +
    String.raw`not\s+available|unavailable|not\s+visible|not\s+shown|not\s+reflected|not\s+included|` +
    String.raw`not\s+provided|does\s+not|doesn't|do\s+not)\b`,
  'i',
);

/**
 * The offending sentence, or null when the text is clean.
 *
 * Exported for direct testing — the rule is subtle enough that its edges should
 * be pinned individually rather than only through a whole analysis.
 */
export function findSessionMislabel(text: string): string | null {
  if (typeof text !== 'string' || !text) return null;

  // Sentence at a time: a negated mention in one sentence must not whitelist an
  // assertion in the next. Splitting on the terminators (and discarding them)
  // is enough — the patterns never need to match across one.
  for (const sentence of text.split(/[.!?;]+\s+/)) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (!ASSERTED_SESSION.test(trimmed)) continue;
    if (NEGATED_BEFORE.test(trimmed) || NEGATED_AFTER.test(trimmed)) continue;
    return trimmed;
  }
  return null;
}

/** Options that change what the guard is allowed to reject. */
export type ValidationOptions = {
  /**
   * Whether the snapshot genuinely carried a distinguishable extended-hours
   * quote. Defaults to `false`, which is the truth for this deployment's data
   * plan — and the safe default, since it is the case where the mislabel is a
   * false statement rather than a stylistic preference.
   */
  afterHoursAvailable?: boolean;
};

/**
 * Validate a parsed model object into an `Analysis`.
 *
 * `expectedTicker` guards against a model that answers about the wrong symbol —
 * a real failure mode when the prompt contains several tickers.
 */
export function validateAnalysis(
  input: unknown,
  expectedTicker: string,
  options: ValidationOptions = {},
): ValidationResult {
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

  // The session-label gate. Runs only when the data plan has no extended-hours
  // quote — which is always, today — because that is the case where calling a
  // regular-session print "after-hours" is a false statement rather than a
  // permitted description.
  if (!options.afterHoursAvailable) {
    const fields: Array<[string, string]> = [['whatChanged', whatChanged]];
    reasons.forEach((text, i) => fields.push([`reasons[${i}]`, text]));
    risks.forEach((text, i) => fields.push([`risks[${i}]`, text]));

    for (const [field, text] of fields) {
      const mislabel = findSessionMislabel(text);
      if (mislabel) {
        errors.push(
          `${field} states a regular-session price or move as after-hours: "${mislabel}". ` +
            'This data plan provides no extended-hours quote.',
        );
      }
    }
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
  options: ValidationOptions = {},
): ValidationResult {
  const parsed = extractJsonObject(raw);
  if (parsed === null) {
    return { ok: false, errors: ['Response did not contain a parseable JSON object.'] };
  }
  return validateAnalysis(parsed, expectedTicker, options);
}
