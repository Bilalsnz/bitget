/**
 * Tests for the local brief history.
 *
 * This module runs against storage the app does not own, so most of what is
 * worth testing is failure: unavailable storage, malformed JSON, entries that
 * are not briefs, a write that throws because the quota is full. The product
 * rule behind all of it is the same — **history must never be able to break the
 * research desk**. Every one of those cases has to end in a rendered page.
 *
 * The other rule under test is that a saved brief is a record, not a cache: the
 * stored entry keeps its own timestamp, and re-saving the same question
 * replaces the old entry rather than filling the list with duplicates.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { sampleResult } from '@/test-support/result-fixture';
import { HISTORY_KEY, MAX_HISTORY, clearHistory, readHistory, saveBrief, savedAtLabel } from './history';

/* A localStorage stand-in. Node has no DOM, and `history.ts` reads `window` at
   call time, so installing one on globalThis is the whole setup. */

let store: Map<string, string>;
let throwOnWrite: boolean;

const fakeWindow = {
  get localStorage(): Storage {
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (throwOnWrite) throw new DOMException('QuotaExceededError');
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    } as unknown as Storage;
  },
};

function installWindow(): void {
  (globalThis as Record<string, unknown>).window = fakeWindow;
}

function removeWindow(): void {
  delete (globalThis as Record<string, unknown>).window;
}

beforeEach(() => {
  store = new Map();
  throwOnWrite = false;
  installWindow();
});

afterEach(() => {
  removeWindow();
});

/** A result that differs from the default only in its ticker. */
function forTicker(ticker: string) {
  const base = sampleResult();
  return {
    ...base,
    request: { ...base.request, ticker },
    analysis: { ...base.analysis, ticker },
    snapshot: { ...base.snapshot, quote: { ...base.snapshot.quote, ticker } },
  };
}

describe('readHistory', () => {
  it('returns an empty list when nothing was ever saved', () => {
    assert.deepEqual(readHistory(), []);
  });

  it('returns an empty list when there is no window at all', () => {
    // The server render path. This module is imported by a client component,
    // which Next still evaluates on the server.
    removeWindow();
    assert.deepEqual(readHistory(), []);
  });

  it('returns an empty list for malformed JSON', () => {
    store.set(HISTORY_KEY, '{not json');
    assert.deepEqual(readHistory(), []);
  });

  it('returns an empty list when the stored value is not an array', () => {
    store.set(HISTORY_KEY, JSON.stringify({ result: sampleResult() }));
    assert.deepEqual(readHistory(), []);
  });

  it('drops entries that are not briefs, keeping the ones that are', () => {
    // A key collision, an older version's shape, or someone in devtools. The
    // good entry is still good and should not be thrown away with the bad one.
    store.set(
      HISTORY_KEY,
      JSON.stringify([
        { id: 'a', savedAt: new Date().toISOString(), result: sampleResult() },
        { id: 'b', savedAt: new Date().toISOString(), result: { nonsense: true } },
        { id: 'c', savedAt: 'not-a-date', result: sampleResult() },
        { id: 'd', result: sampleResult() },
        null,
      ]),
    );

    const entries = readHistory();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.id, 'a');
  });

  it('caps what it returns even if more was stored', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `id-${index}`,
      savedAt: new Date(Date.now() - index * 60_000).toISOString(),
      result: forTicker(`T${index}`),
    }));
    store.set(HISTORY_KEY, JSON.stringify(many));

    assert.equal(readHistory().length, MAX_HISTORY);
  });
});

describe('saveBrief', () => {
  it('saves a brief and reads it back', () => {
    const saved = saveBrief(sampleResult());

    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.result.request.ticker, 'AAPL');
    assert.deepEqual(readHistory(), saved);
  });

  it('puts the newest brief first', () => {
    saveBrief(forTicker('AAPL'), '2026-09-13T10:00:00.000Z');
    const after = saveBrief(forTicker('MSFT'), '2026-09-13T11:00:00.000Z');

    assert.deepEqual(
      after.map((entry) => entry.result.request.ticker),
      ['MSFT', 'AAPL'],
    );
  });

  it('replaces an earlier brief for the same question', () => {
    // The list should read as "the last five things I researched", not "the
    // last five times I tapped Analyse on AAPL".
    saveBrief(forTicker('AAPL'), '2026-09-13T10:00:00.000Z');
    saveBrief(forTicker('MSFT'), '2026-09-13T11:00:00.000Z');
    const after = saveBrief(forTicker('AAPL'), '2026-09-13T12:00:00.000Z');

    assert.deepEqual(
      after.map((entry) => entry.result.request.ticker),
      ['AAPL', 'MSFT'],
    );
    assert.equal(after[0]?.savedAt, '2026-09-13T12:00:00.000Z');
  });

  it('treats a different horizon or risk as a different question', () => {
    const base = forTicker('AAPL');
    saveBrief(base, '2026-09-13T10:00:00.000Z');
    const after = saveBrief(
      { ...base, request: { ...base.request, holdingPeriod: '3m' } },
      '2026-09-13T11:00:00.000Z',
    );

    assert.equal(after.length, 2);
  });

  it('keeps at most five briefs', () => {
    for (let index = 0; index < 8; index += 1) {
      saveBrief(forTicker(`T${index}`), new Date(Date.UTC(2026, 8, 13, 10, index)).toISOString());
    }

    const entries = readHistory();
    assert.equal(entries.length, MAX_HISTORY);
    // Newest first, oldest evicted.
    assert.deepEqual(
      entries.map((entry) => entry.result.request.ticker),
      ['T7', 'T6', 'T5', 'T4', 'T3'],
    );
  });

  it('still returns the new list when the write throws', () => {
    // Quota exceeded, or storage revoked between the read and the write. The
    // reader still sees the brief they just generated.
    throwOnWrite = true;
    const saved = saveBrief(sampleResult());

    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.result.request.ticker, 'AAPL');
    // Nothing was persisted, and reading back says so rather than inventing it.
    assert.deepEqual(readHistory(), []);
  });

  it('returns the new list when storage is unavailable entirely', () => {
    removeWindow();
    const saved = saveBrief(sampleResult());

    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.result.request.ticker, 'AAPL');
  });
});

describe('clearHistory', () => {
  it('removes everything that was saved', () => {
    saveBrief(sampleResult());
    clearHistory();

    assert.deepEqual(readHistory(), []);
  });

  it('is silent when there is nothing to clear', () => {
    assert.doesNotThrow(() => clearHistory());
  });

  it('is silent when storage throws', () => {
    removeWindow();
    assert.doesNotThrow(() => clearHistory());
  });
});

describe('savedAtLabel', () => {
  const now = Date.UTC(2026, 8, 13, 12, 0, 0);

  it('describes the gaps in words a reader would use', () => {
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

    assert.equal(savedAtLabel(at(0), now), 'saved just now');
    assert.equal(savedAtLabel(at(5), now), 'saved 5 min ago');
    assert.equal(savedAtLabel(at(90), now), 'saved 2 hr ago');
    assert.equal(savedAtLabel(at(60 * 30), now), 'saved yesterday');
    assert.equal(savedAtLabel(at(60 * 24 * 3), now), 'saved 3 days ago');
  });

  it('degrades to a vague label for an unparseable timestamp', () => {
    // Better a vague sentence than "saved NaN days ago".
    assert.equal(savedAtLabel('not-a-date', now), 'saved earlier');
  });
});
