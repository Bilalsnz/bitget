/**
 * POST /api/analyze
 *
 * The single endpoint the research card is built from. It returns the market
 * snapshot *and* the analysis together so the UI can never render judgement
 * without the numbers it was based on.
 *
 * Secrets live only behind this boundary: the Finnhub key and the AI key are
 * read inside the server-only modules this route imports, and neither the key
 * nor any provider error text is ever placed in the response.
 */

import { AppError } from '@/lib/errors';
import { errorResponse, jsonResponse } from '@/lib/api';
import { runAnalysis } from '@/lib/ai/analyze';
import { getMarketSnapshot } from '@/lib/market/finnhub';
import { parseResearchRequest } from '@/lib/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The model call can take a while; allow headroom on plans that permit it. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('BAD_REQUEST', 'Request body was not valid JSON.');
    }

    const parsed = parseResearchRequest(body);

    // Market data failure is fatal: without a price there is nothing honest to
    // analyse, and inventing one is the single thing this product must not do.
    const snapshot = await getMarketSnapshot(parsed.ticker);

    // AI failure is not fatal — `runAnalysis` degrades to the labelled demo
    // engine and explains why in `modeReason`.
    const result = await runAnalysis(parsed, snapshot);

    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}
