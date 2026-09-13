/**
 * Groq provider for the live analysis call.
 *
 * SERVER ONLY. This module reads `process.env.GROQ_API_KEY` and must never be
 * imported from a client component. The key is sent as an `Authorization:
 * Bearer` header — never a query parameter — so it cannot leak into a URL, a
 * proxy access log, or a screenshot of an address bar. It is never logged,
 * never returned, and never embedded in an error the browser can see.
 *
 * ## Why plain `fetch` and not an SDK
 *
 * Groq speaks the OpenAI chat-completions dialect, and calling it directly
 * needs one POST with four body fields. An SDK would add a dependency, a
 * version to track, and its own error taxonomy to map — for a request we can
 * write in full, and read in full, here. Fewer moving parts between a market
 * snapshot and the sentence describing it is the property worth optimising.
 *
 * This provider returns *unvalidated* data. Shaping and range-checking happen
 * in `lib/schema.ts`, deliberately, so a change of provider cannot change what
 * the UI is willing to render.
 */

import { AppError } from '../errors';
import { extractJsonObject } from '../schema';
import { ANALYSIS_RESPONSE_FORMAT } from './prompt';

/** Reported by `/api/health`. A product name, not a credential. */
export const AI_PROVIDER = 'Groq';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

/**
 * `openai/gpt-oss-20b` is the default because this task is small-context
 * interpretation with a hard no-fabrication requirement, and this model
 * supports structured outputs. Overridable via `AI_MODEL` so a deployment can
 * trade cost for quality without a code change.
 */
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

/** Answer length only — no reasoning budget is requested. */
const MAX_TOKENS = 4_096;
const REQUEST_TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------ configuration */

/**
 * The credential, under the name the provider's own console documents.
 *
 * There is deliberately no second accepted variable here (unlike the market
 * key's fallback): reading a credential from a name nobody configured is how a
 * deployment ends up authenticating as something the operator did not intend.
 */
function readApiKey(): { key: string; source: 'GROQ_API_KEY' } | null {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return null;
  return { key, source: 'GROQ_API_KEY' };
}

/** Exposed so the health route can report configuration without leaking values. */
export function hasAiKey(): boolean {
  return readApiKey() !== null;
}

/** Which env var supplied the key. A name, never a value. */
export function aiKeySource(): 'GROQ_API_KEY' | null {
  return readApiKey()?.source ?? null;
}

export function aiModel(): string {
  const configured = process.env.AI_MODEL?.trim();
  return configured || DEFAULT_MODEL;
}

/** Human-readable label for the "analysed by" line in the UI. */
export function aiProviderLabel(): string {
  return `${AI_PROVIDER} · ${aiModel()}`;
}

/* ----------------------------------------------------------------- the call */

type GroqPayload = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

function post(body: unknown, key: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  return fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
    cache: 'no-store',
  }).finally(() => clearTimeout(timer));
}

/**
 * Did the provider reject the *request shape* rather than the request?
 *
 * A 400 naming `response_format` or the schema means the server would not
 * accept structured outputs as asked — an older gateway, a model whose support
 * lapsed, a strict-mode keyword it does not implement. That is recoverable:
 * ask for JSON without the schema and let the validator hold the line.
 *
 * Any other 400 is a genuine bad request and must not be retried.
 */
function isSchemaRejection(status: number, body: string): boolean {
  if (status !== 400) return false;
  const text = body.toLowerCase();
  return text.includes('response_format') || text.includes('json_schema') || text.includes('schema');
}

function mapTransportError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && err.name === 'AbortError') {
    return new AppError('TIMEOUT', 'The provider request exceeded the client timeout.');
  }
  return new AppError(
    'NETWORK',
    `Could not reach the provider: ${err instanceof Error ? err.message : String(err)}`,
  );
}

/**
 * Ask the model for an analysis and return its parsed JSON.
 *
 * Returns `unknown` on purpose — the caller must run it through
 * `validateAnalysis` before anything is rendered.
 */
export async function requestLiveAnalysis(system: string, user: string): Promise<unknown> {
  const config = readApiKey();
  if (!config) {
    throw new AppError('AI_UNAVAILABLE', 'No AI credential is configured in this environment.');
  }

  const model = aiModel();
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  let response: Response;
  try {
    response = await post({ model, messages, max_tokens: MAX_TOKENS, response_format: ANALYSIS_RESPONSE_FORMAT }, config.key);
  } catch (err) {
    throw mapTransportError(err);
  }

  let text = await response.text();

  // Insurance for the one thing this code cannot verify from here: whether the
  // live endpoint accepts our schema. We have no key and cannot make the call,
  // so instead of assuming, we handle the refusal — and lose nothing when it
  // does not happen, because the fallback is the same dialect without a schema
  // and the validator below is what actually protects the card.
  if (isSchemaRejection(response.status, text)) {
    console.error('[afterhours] provider rejected the response schema; retrying in JSON mode', {
      status: response.status,
    });
    try {
      response = await post(
        { model, messages, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' } },
        config.key,
      );
    } catch (err) {
      throw mapTransportError(err);
    }
    text = await response.text();
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError('AI_UNAVAILABLE', `The provider refused the configured credential (HTTP ${response.status}).`);
  }
  if (response.status === 429) {
    throw new AppError('AI_UNAVAILABLE', 'The provider rate limited the request (HTTP 429).');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AppError('AI_UNAVAILABLE', `The provider returned HTTP ${response.status}.`);
  }

  let payload: GroqPayload;
  try {
    payload = JSON.parse(text) as GroqPayload;
  } catch {
    throw new AppError('AI_BAD_RESPONSE', 'The provider response body was not JSON.');
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AppError('AI_BAD_RESPONSE', 'The provider response contained no message content.');
  }

  // Recover the object even if it arrives wrapped in prose or a ```json fence.
  // A `json_schema` response format should guarantee bare JSON, but that
  // guarantee comes from a remote service — and the retry path above may have
  // downgraded to plain JSON mode, which guarantees validity but not shape.
  // This is the same recovery path the validator uses, so the two stay in step
  // by construction.
  const parsed = extractJsonObject(content);
  if (parsed === null) {
    throw new AppError('AI_BAD_RESPONSE', 'The provider response contained no parseable JSON object.');
  }

  return parsed;
}
