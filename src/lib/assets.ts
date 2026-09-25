/**
 * Single source of truth for every instrument AfterHours AI will research.
 *
 * Deliberately a short, curated list. A research desk that claims to cover
 * every ticker on Earth covers none of them well, and the free market-data
 * tier rewards a known set of liquid US names.
 *
 * ## `bitget`, and why it is optional
 *
 * `bitget` records the tokenized-equity counterpart an instrument has on Bitget
 * — the "rStock" line, e.g. NVDA → rNVDA. It is **optional on purpose**, and its
 * absence is meaningful: it means no counterpart could be verified, not that one
 * was skipped.
 *
 * Every entry here was read off live exchange data, not written from memory.
 * The rule this project applies is that a tokenized-listing claim needs a
 * listing to point at: the symbol and the URL both come from the exchange's own
 * market record, so a wrong ticker cannot be introduced by a typo or a guess.
 * The one instrument in this list with no `bitget` field is AAPL — Apple's
 * tokenized counterpart does not exist on Bitget, despite being the example
 * everyone reaches for. `bitget.test.ts` pins that fact so an "obvious" fix
 * cannot quietly add it back.
 *
 * When a verified mapping exists, add it here as an optional field — the rest
 * of the app reads assets through the helpers below, so nothing else has to
 * change.
 */

export type Asset = {
  /** Canonical US market symbol used for all provider requests. */
  ticker: string;
  /** Display name for the research card header. */
  name: string;
  /** One-line plain-English description of what the instrument actually is. */
  description: string;
  /** Coarse grouping, used only for the chips' visual rhythm. */
  kind: 'equity' | 'etf';
  /** Broad sector — gives the analysis layer context without a second API call. */
  sector: string;
  /**
   * The tokenized counterpart listed on Bitget, when one could be verified.
   *
   * `symbol` is Bitget's own display form (lowercase `r`, uppercase ticker —
   * `rNVDA`); `pair` is the traded market against USDT (`rNVDAUSDT`), which is
   * what a price request needs; `url` is the canonical market page. Absent
   * means unverified.
   *
   * `pair` is stored rather than built by appending `USDT` to `symbol`,
   * because a pair assembled by string concatenation is a guess — and a
   * guessed pair returns *some other market's* price rather than an error,
   * which is the one failure a reader could not detect. Each `pair` here was
   * read from the market URL recorded beside it, and `bitget.test.ts` asserts
   * the two still agree.
   *
   * **These are the URL spellings, and they are deliberately not what the API
   * is asked for.** The venue's tickers endpoint matches on an uppercase
   * symbol (`RNVDAUSDT`) — CoinGecko records that market as `base: "RNVDA"`
   * while giving its `trade_url` as the lowercase-`r` page above, so both forms
   * are attested and they really do differ. The conversion happens in
   * `market/bitget.ts` at the request boundary. Uppercasing these strings
   * instead would break the badge and the link, which are what read them.
   */
  bitget?: {
    symbol: string;
    pair: string;
    url: string;
  };
};

export const ASSETS: readonly Asset[] = [
  {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    description: 'Consumer hardware, software and services.',
    kind: 'equity',
    sector: 'Technology',
  },
  {
    ticker: 'TSLA',
    name: 'Tesla, Inc.',
    description: 'Electric vehicles, energy storage and autonomy.',
    kind: 'equity',
    sector: 'Automotive',
    bitget: { symbol: 'rTSLA', pair: 'rTSLAUSDT', url: 'https://www.bitget.com/spot/rTSLAUSDT' },
  },
  {
    ticker: 'NVDA',
    name: 'NVIDIA Corporation',
    description: 'Accelerated computing and AI data-centre silicon.',
    kind: 'equity',
    sector: 'Semiconductors',
    bitget: { symbol: 'rNVDA', pair: 'rNVDAUSDT', url: 'https://www.bitget.com/spot/rNVDAUSDT' },
  },
  {
    ticker: 'MSFT',
    name: 'Microsoft Corporation',
    description: 'Cloud infrastructure, productivity software and AI platforms.',
    kind: 'equity',
    sector: 'Technology',
    bitget: { symbol: 'rMSFT', pair: 'rMSFTUSDT', url: 'https://www.bitget.com/spot/rMSFTUSDT' },
  },
  {
    ticker: 'AMZN',
    name: 'Amazon.com, Inc.',
    description: 'E-commerce, logistics and AWS cloud computing.',
    kind: 'equity',
    sector: 'Consumer Discretionary',
    bitget: { symbol: 'rAMZN', pair: 'rAMZNUSDT', url: 'https://www.bitget.com/spot/rAMZNUSDT' },
  },
  {
    ticker: 'META',
    name: 'Meta Platforms, Inc.',
    description: 'Social platforms and digital advertising.',
    kind: 'equity',
    sector: 'Communication Services',
    bitget: { symbol: 'rMETA', pair: 'rMETAUSDT', url: 'https://www.bitget.com/spot/rMETAUSDT' },
  },
  {
    ticker: 'GOOGL',
    name: 'Alphabet Inc.',
    description: 'Search, advertising, cloud and AI research.',
    kind: 'equity',
    sector: 'Communication Services',
    bitget: { symbol: 'rGOOGL', pair: 'rGOOGLUSDT', url: 'https://www.bitget.com/spot/rGOOGLUSDT' },
  },
  {
    ticker: 'NFLX',
    name: 'Netflix, Inc.',
    description: 'Streaming entertainment and content production.',
    kind: 'equity',
    sector: 'Communication Services',
    bitget: { symbol: 'rNFLX', pair: 'rNFLXUSDT', url: 'https://www.bitget.com/spot/rNFLXUSDT' },
  },
  {
    ticker: 'AMD',
    name: 'Advanced Micro Devices, Inc.',
    description: 'CPUs, GPUs and data-centre accelerators.',
    kind: 'equity',
    sector: 'Semiconductors',
    bitget: { symbol: 'rAMD', pair: 'rAMDUSDT', url: 'https://www.bitget.com/spot/rAMDUSDT' },
  },
  {
    ticker: 'COIN',
    name: 'Coinbase Global, Inc.',
    description: 'Crypto exchange and custody — a high-beta digital-asset proxy.',
    kind: 'equity',
    sector: 'Financials',
    bitget: { symbol: 'rCOIN', pair: 'rCOINUSDT', url: 'https://www.bitget.com/spot/rCOINUSDT' },
  },
  {
    ticker: 'MSTR',
    name: 'Strategy (MicroStrategy)',
    description: 'Enterprise software with a large bitcoin treasury position.',
    kind: 'equity',
    sector: 'Technology',
    bitget: { symbol: 'rMSTR', pair: 'rMSTRUSDT', url: 'https://www.bitget.com/spot/rMSTRUSDT' },
  },
  {
    ticker: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    description: 'Broad US large-cap equity index exposure.',
    kind: 'etf',
    sector: 'Index',
    bitget: { symbol: 'rSPY', pair: 'rSPYUSDT', url: 'https://www.bitget.com/spot/rSPYUSDT' },
  },
] as const;

/** Fast lookup — ticker is the canonical key. */
const BY_TICKER: ReadonlyMap<string, Asset> = new Map(
  ASSETS.map((asset) => [asset.ticker, asset]),
);

/** Tickers only — handy for the client bundle and for error messages. */
export const SUPPORTED_TICKERS: readonly string[] = ASSETS.map((a) => a.ticker);

/**
 * Strip free text down to bare symbol shape, without checking whether we cover
 * it. " nvda. " → "NVDA", "!!!" → null.
 *
 * This exists separately from `normaliseTicker` because "that isn't a symbol"
 * and "that is a symbol we don't cover" are different answers that deserve
 * different copy. Collapsing them tells someone typing IBM that IBM is not a
 * ticker symbol, which is both wrong and insulting.
 */
export function symbolShape(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .trim()
    .toUpperCase()
    // Keep letters and the dots that appear in symbols like BRK.B.
    .replace(/[^A-Z.]/g, '')
    // A trailing dot is punctuation, not part of the symbol.
    .replace(/\.$/, '');
  // No US listing symbol is longer than this; beyond it, it isn't a symbol.
  if (!cleaned || cleaned.length > 6) return null;
  return cleaned;
}

/**
 * Normalise free-text user input into a canonical ticker **we support**.
 * Accepts "nvda", " NVDA ", "NVDA." — an unsupported or malformed symbol
 * returns null. Use `symbolShape` first when you need to tell those apart.
 */
export function normaliseTicker(input: unknown): string | null {
  const shape = symbolShape(input);
  if (!shape) return null;
  return BY_TICKER.has(shape) ? shape : null;
}

/** Returns the asset for a supported ticker, or null. Never throws. */
export function getAsset(input: unknown): Asset | null {
  const ticker = normaliseTicker(input);
  if (!ticker) return null;
  return BY_TICKER.get(ticker) ?? null;
}

/** True when the ticker is on the curated list. */
export function isSupportedTicker(input: unknown): boolean {
  return getAsset(input) !== null;
}

/** Comma-separated list for user-facing error copy. */
export const SUPPORTED_TICKERS_LABEL = SUPPORTED_TICKERS.join(', ');
