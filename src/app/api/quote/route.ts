/**
 * GET /api/quote?ticker=AAPL
 *
 * The market snapshot on its own, without the analysis. Used to refresh the
 * numbers under a research card independently of the judgement, and useful on
 * its own as a check that the data layer is wired up correctly.
 */

import { errorResponse, jsonResponse } from '@/lib/api';
import { getMarketSnapshot } from '@/lib/market/finnhub';
import { parseTicker } from '@/lib/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const ticker = parseTicker(new URL(request.url).searchParams.get('ticker') ?? '');
    const snapshot = await getMarketSnapshot(ticker);
    return jsonResponse(snapshot);
  } catch (err) {
    return errorResponse(err);
  }
}
