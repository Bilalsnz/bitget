/**
 * Typed application errors.
 *
 * Every failure that can reach the user is one of these, which means the API
 * routes can map errors to friendly copy in exactly one place and no stack
 * trace ever reaches the browser.
 */

export type ErrorCode =
  | 'INVALID_TICKER'
  | 'UNSUPPORTED_TICKER'
  | 'MISSING_MARKET_KEY'
  | 'MARKET_KEY_REJECTED'
  | 'MARKET_UNAVAILABLE'
  | 'MARKET_RATE_LIMITED'
  | 'MARKET_BAD_RESPONSE'
  | 'AI_UNAVAILABLE'
  | 'AI_RATE_LIMITED'
  | 'AI_BAD_RESPONSE'
  | 'BAD_REQUEST'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UNKNOWN';

export type ErrorBody = {
  error: {
    code: ErrorCode;
    /** Safe, user-facing sentence. Never contains internals. */
    message: string;
    /** What the user can do about it, when there is something. */
    hint?: string;
  };
};

const FRIENDLY: Record<ErrorCode, { message: string; hint?: string; status: number }> = {
  INVALID_TICKER: {
    message: 'That does not look like a ticker symbol.',
    hint: 'Pick one of the supported instruments below the search box.',
    status: 400,
  },
  UNSUPPORTED_TICKER: {
    message: 'That instrument is not on the supported list yet.',
    hint: 'AfterHours AI covers a curated set of liquid US names.',
    status: 400,
  },
  MISSING_MARKET_KEY: {
    message: 'Market data is not configured on this deployment.',
    // Points at the diagnostic rather than restating "add the key": the useful
    // question is never *whether* to add it, it is why a deployment that has it
    // still cannot see it.
    hint: 'An operator can see exactly what is missing at /api/health.',
    status: 503,
  },
  /**
   * Deliberately distinct from MISSING_MARKET_KEY, and it used to share its
   * code. Collapsing them told the operator to go and configure a key that was
   * already configured — the single most confusing thing this app could say,
   * because it sends you back to the step you just completed.
   *
   * A rejection means the variable is present and the provider refused it:
   * revoked, mistyped, inactive, or lacking the right plan.
   */
  MARKET_KEY_REJECTED: {
    message: 'The market data provider refused this deployment’s credentials.',
    hint: 'The key is present but was not accepted. An operator can check it at /api/health.',
    status: 503,
  },
  MARKET_UNAVAILABLE: {
    message: 'Market data is temporarily unavailable. Try again in a moment.',
    status: 502,
  },
  MARKET_RATE_LIMITED: {
    message: 'Market data is rate limited right now. Try again in about a minute.',
    status: 429,
  },
  MARKET_BAD_RESPONSE: {
    message: 'The market data provider returned something we could not read.',
    hint: 'Try again — this is usually transient.',
    status: 502,
  },
  AI_UNAVAILABLE: {
    message: 'The analysis engine is temporarily unavailable.',
    hint: 'The market snapshot is still accurate; try the analysis again shortly.',
    status: 502,
  },
  /**
   * Distinct from AI_UNAVAILABLE because it is a different situation with a
   * different remedy. An outage is not the reader's doing and waiting may not
   * help; a rate limit is transient, expected on a free tier, and clears in
   * seconds. Lumping them together produced a message — "the engine was
   * unavailable" — that was true of both and useful for neither, and made a
   * deliberate, working fallback look like a fault.
   */
  AI_RATE_LIMITED: {
    message: 'The analysis engine is rate-limiting this deployment right now.',
    hint: 'This clears within seconds. The market snapshot is still accurate, and the analysis below is complete — just not model-written.',
    status: 429,
  },
  AI_BAD_RESPONSE: {
    message: 'The analysis engine returned an unusable response.',
    status: 502,
  },
  BAD_REQUEST: {
    message: 'That request was not valid.',
    status: 400,
  },
  TIMEOUT: {
    message: 'That request took too long. Try again in a moment.',
    status: 504,
  },
  NETWORK: {
    message: 'Could not reach the research desk. Check your connection and try again.',
    status: 503,
  },
  UNKNOWN: {
    message: 'Something went wrong on our side. Try again in a moment.',
    status: 500,
  },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Developer-facing detail. Logged server-side, never sent to the browser. */
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string) {
    const friendly = FRIENDLY[code];
    super(friendly.message);
    this.name = 'AppError';
    this.code = code;
    this.status = friendly.status;
    this.detail = detail;
  }

  toBody(): ErrorBody {
    const friendly = FRIENDLY[this.code];
    return {
      error: {
        code: this.code,
        message: friendly.message,
        ...(friendly.hint ? { hint: friendly.hint } : {}),
      },
    };
  }
}

/** Narrow an unknown thrown value into an AppError, preserving known codes. */
export function toAppError(err: unknown, fallback: ErrorCode = 'UNKNOWN'): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return new AppError('TIMEOUT', err.message);
    return new AppError(fallback, err.message);
  }
  return new AppError(fallback, String(err));
}

/** True when a response body looks like our error envelope. */
export function isErrorBody(input: unknown): input is ErrorBody {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = (input as { error?: unknown }).error;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { message?: unknown }).message === 'string'
  );
}

/**
 * The friendly copy for a code, for client code that needs to synthesise an
 * error the server never sent — a dropped connection, for instance. Exported so
 * the wording lives in exactly one place rather than being retyped in the UI.
 */
export function friendlyError(code: ErrorCode): { message: string; hint?: string } {
  const friendly = FRIENDLY[code];
  return {
    message: friendly.message,
    ...(friendly.hint ? { hint: friendly.hint } : {}),
  };
}
