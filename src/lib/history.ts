/**
 * Local brief history.
 *
 * Deliberately localStorage and nothing else: no account, no server, no sync.
 * The briefs a reader generates are theirs, they stay on their device, and
 * nothing about them is transmitted anywhere — which is also why this needs no
 * privacy notice beyond saying so.
 *
 * Three properties this module has to hold, because it runs against storage the
 * app does not control:
 *
 *   1. **It must never throw.** localStorage is unavailable in Safari private
 *      browsing, can be disabled entirely, and throws on write when full. A
 *      history feature that can break the research desk is a worse trade than
 *      no history feature, so every access is guarded and every failure is a
 *      silent no-op.
 *   2. **It must never trust what it reads.** The stored value is a string that
 *      an older version of this app — or a user with devtools — may have
 *      written. It is parsed inside a try, shape-checked with the same guard
 *      the API response uses, and dropped if it does not conform.
 *   3. **It must never show a stale brief as a current one.** Entries carry
 *      their own `savedAt`, and the UI labels them. The stored analysis is a
 *      record of what was said at that moment, not a live view.
 */

import { isResearchResult } from './brief';
import type { ResearchResult } from './types';

/**
 * Versioned so a future shape change can be recognised and discarded rather
 * than mis-parsed. A new key is cheaper and safer than a migration.
 */
export const HISTORY_KEY = 'afterhours.briefs.v1';

/** The brief most recently saved first. */
export const MAX_HISTORY = 5;

export type BriefEntry = {
  /** Stable identity for React keys and de-duplication. */
  id: string;
  /** ISO timestamp of when this brief was saved to this device. */
  savedAt: string;
  result: ResearchResult;
};

/**
 * Identity of a *request*, not of a result.
 *
 * Saving is de-duplicated on this so the list reads as "the last five things I
 * researched" rather than "the last five times I tapped Analyse on AAPL". The
 * newer brief replaces the older one for the same question.
 */
function requestKey(result: ResearchResult): string {
  const { ticker, holdingPeriod, risk } = result.request;
  return `${ticker.toUpperCase()}|${holdingPeriod}|${risk}`;
}

function isBriefEntry(input: unknown): input is BriefEntry {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<BriefEntry>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.savedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.savedAt)) &&
    isResearchResult(candidate.result)
  );
}

/** Storage, or null when the environment will not give us any. */
function storage(): Storage | null {
  try {
    // Touching `window` throws under SSR; touching localStorage throws in
    // private browsing and when storage is disabled by policy.
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the stored history, newest first.
 *
 * Returns an empty list for every failure mode — unavailable storage, absent
 * key, malformed JSON, a JSON array of things that are not briefs. The caller
 * cannot distinguish them, deliberately: there is nothing useful to do
 * differently in any of those cases.
 */
export function readHistory(): BriefEntry[] {
  const store = storage();
  if (!store) return [];

  try {
    const raw = store.getItem(HISTORY_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isBriefEntry).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

/**
 * Save a brief and return the new list.
 *
 * Returns the list that is now stored, or the current list unchanged if the
 * write failed — so a caller can render from the return value without a second
 * read, and without a failed write silently emptying the UI.
 */
export function saveBrief(result: ResearchResult, savedAt = new Date().toISOString()): BriefEntry[] {
  const existing = readHistory();
  const key = requestKey(result);

  const entry: BriefEntry = {
    id: `${key}|${savedAt}`,
    savedAt,
    result,
  };

  const next = [entry, ...existing.filter((item) => requestKey(item.result) !== key)].slice(
    0,
    MAX_HISTORY,
  );

  const store = storage();
  if (!store) return next;

  try {
    store.setItem(HISTORY_KEY, JSON.stringify(next));
    return next;
  } catch {
    // Quota exceeded, or storage revoked between the read and the write. The
    // in-memory list is still correct for this session.
    return next;
  }
}

/** Remove every stored brief. Silent when there is nothing to remove. */
export function clearHistory(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(HISTORY_KEY);
  } catch {
    // Nothing to do and nothing to report — the UI re-reads after calling this.
  }
}

/** Compact "when" label for a history row. Coarse on purpose. */
export function savedAtLabel(savedAt: string, now = Date.now()): string {
  const then = Date.parse(savedAt);
  if (!Number.isFinite(then)) return 'saved earlier';

  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return 'saved just now';
  if (minutes < 60) return `saved ${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `saved ${hours} hr ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'saved yesterday' : `saved ${days} days ago`;
}
