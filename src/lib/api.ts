/**
 * HTTP response helpers for the API routes.
 *
 * The one rule: **an error response never contains developer detail.** The
 * `detail` on an `AppError` is written to the server log here and the response
 * body carries only the code, the friendly message and an optional hint. A
 * stack trace or provider message reaching the browser is how a key ends up
 * pasted into a screenshot.
 */

import { NextResponse } from 'next/server';

import { toAppError } from './errors';

/** Any response carrying live market data must never be cached. */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function errorResponse(err: unknown): NextResponse {
  const appError = toAppError(err);

  // 5xx and unexpected failures are worth a server-side trail; 4xx from a bad
  // request are normal traffic and would just be noise.
  if (appError.status >= 500) {
    console.error('[afterhours] request failed', {
      code: appError.code,
      detail: appError.detail,
    });
  }

  return NextResponse.json(appError.toBody(), {
    status: appError.status,
    headers: NO_STORE,
  });
}
