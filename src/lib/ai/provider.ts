/**
 * Anthropic provider for the live analysis call.
 *
 * SERVER ONLY. This module reads the AI credential from the environment and
 * must never be imported from a client component. The key is passed to the SDK
 * constructor explicitly so there is exactly one place it is read, and it is
 * never logged, returned, or embedded in an error the browser can see.
 *
 * This provider returns *unvalidated* data. Shaping and range-checking happen
 * in `lib/schema.ts`, deliberately, so a change of provider cannot change what
 * the UI is willing to render.
 */

import Anthropic from '@anthropic-ai/sdk';

import { AppError } from '../errors';
import { extractJsonObject } from '../schema';
import { ANALYSIS_JSON_SCHEMA } from './prompt';

/**
 * Opus 5 is the default because this task is judgement under uncertainty with a
 * hard requirement not to fabricate — the tier where a weaker model's failure
 * mode (inventing a plausible number) is most damaging. Overridable via
 * `AI_MODEL` so a deployment can trade cost for quality without a code change.
 */
const DEFAULT_MODEL = 'claude-opus-5';

/** Thinking tokens count against this budget, so it is not just answer length. */
const MAX_TOKENS = 6_000;
const REQUEST_TIMEOUT_MS = 45_000;

/* ------------------------------------------------------------ configuration */

/**
 * The credential, under either the product's own name or the SDK's convention.
 *
 * `AI_API_KEY` is checked first because that is the name documented in
 * `.env.example`; `ANTHROPIC_API_KEY` is accepted so an existing Anthropic
 * setup works without being renamed.
 */
function readApiKey(): { key: string; source: 'AI_API_KEY' | 'ANTHROPIC_API_KEY' } | null {
  const primary = process.env.AI_API_KEY?.trim();
  if (primary) return { key: primary, source: 'AI_API_KEY' };

  const secondary = process.env.ANTHROPIC_API_KEY?.trim();
  if (secondary) return { key: secondary, source: 'ANTHROPIC_API_KEY' };

  return null;
}

/** Exposed so the health route can report configuration without leaking values. */
export function hasAiKey(): boolean {
  return readApiKey() !== null;
}

/** Which env var supplied the key. A name, never a value. */
export function aiKeySource(): 'AI_API_KEY' | 'ANTHROPIC_API_KEY' | null {
  return readApiKey()?.source ?? null;
}

export function aiModel(): string {
  const configured = process.env.AI_MODEL?.trim();
  return configured || DEFAULT_MODEL;
}

/** Human-readable label for the "analysed by" line in the UI. */
export function aiProviderLabel(): string {
  return `Claude (${aiModel()})`;
}

/* -------------------------------------------------------------------- client */

/**
 * Build a client for the current configuration.
 *
 * Deliberately *not* memoised. Constructing an SDK client is plain object
 * allocation — there is no connection pool behind it — so caching bought
 * nothing and cost correctness in two ways: the SDK binds its `fetch`
 * implementation and reads `ANTHROPIC_BASE_URL` when the client is
 * constructed, so a cached instance would keep serving a stale transport and a
 * stale gateway after either changed.
 */
function client(): Anthropic {
  const config = readApiKey();
  if (!config) {
    throw new AppError('AI_UNAVAILABLE', 'No AI credential is configured in this environment.');
  }

  return new Anthropic({
    apiKey: config.key,
    maxRetries: 1,
    timeout: REQUEST_TIMEOUT_MS,
  });
}

/* ---------------------------------------------------------------- the call */

function mapSdkError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  // Authentication and permission failures are a deployment problem, and the
  // user-facing copy for those already exists as MISSING_MARKET_KEY's sibling.
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AppError('AI_UNAVAILABLE', `AI credential rejected (${err.status}).`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError('AI_UNAVAILABLE', 'AI provider rate limited the request (429).');
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError('TIMEOUT', 'AI request exceeded the client timeout.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AppError('NETWORK', `Could not reach the AI provider: ${err.message}`);
  }
  if (err instanceof Anthropic.APIError) {
    return new AppError('AI_UNAVAILABLE', `AI provider returned HTTP ${err.status ?? 'unknown'}.`);
  }

  return new AppError('AI_UNAVAILABLE', err instanceof Error ? err.message : String(err));
}

/**
 * Pull the JSON payload out of the response content.
 *
 * With a `json_schema` output format the text block is guaranteed to be JSON,
 * but we still parse defensively: a malformed body must surface as a validation
 * failure that triggers the demo fallback, not as an unhandled exception.
 */
function extractText(message: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n').trim();
}

/**
 * Ask the model for an analysis and return its parsed JSON.
 *
 * Returns `unknown` on purpose — the caller must run it through
 * `parseAndValidateAnalysis` before anything is rendered.
 */
export async function requestLiveAnalysis(system: string, user: string): Promise<unknown> {
  const anthropic = client();

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: aiModel(),
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
      // Adaptive thinking: the model decides how much reasoning this needs.
      thinking: { type: 'adaptive' },
      output_config: {
        format: { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA },
      },
    });
  } catch (err) {
    throw mapSdkError(err);
  }

  // A refusal is a legitimate stop reason, not an exception. It must be checked
  // before reading content, which may be empty or partial in that case.
  if (message.stop_reason === 'refusal') {
    throw new AppError('AI_UNAVAILABLE', 'The model declined to produce an analysis for this request.');
  }

  const text = extractText(message);
  if (!text) {
    throw new AppError('AI_BAD_RESPONSE', `Model response contained no text (stop reason: ${message.stop_reason}).`);
  }

  // Recover the object even if it arrives wrapped in prose or a ```json fence.
  // Structured outputs should guarantee bare JSON, but that guarantee comes
  // from a remote service — and a gateway sitting in front of the API may not
  // honour the parameter at all. This is the same recovery path the validator
  // uses, so the two stay in step by construction.
  const parsed = extractJsonObject(text);
  if (parsed === null) {
    throw new AppError('AI_BAD_RESPONSE', 'Model response contained no parseable JSON object.');
  }

  return parsed;
}
