/**
 * Guards on the app's Bitget-facing *claims*, asserted against the source text.
 *
 * ## Why this file exists
 *
 * On 2026-09-24 the desk began pricing tokenized counterparts from Bitget's
 * public market endpoint. That commit made three sentences elsewhere in this
 * repo false — the panel's "No Bitget integration", its "not a live feed"
 * caption, and the doc comment above them — and nothing failed. The test suite
 * was green at 230 passing the whole time, because every test in this project
 * checks *behaviour* and none of them checks whether the app still tells the
 * truth about itself.
 *
 * That is the same failure shape as the session-mislabelling bug this codebase
 * already carries a four-layer defence against: a sentence that was true when
 * written, falsified later by a change to something else, and left standing on
 * the one surface whose entire job is honesty. Prohibiting a false claim does
 * not keep it from becoming false.
 *
 * ## Why it scans text instead of rendering
 *
 * There is no React test harness here and adding one would mean a runtime
 * dependency this project does not take. More to the point, the thing being
 * guarded is not behaviour — it is exact wording with a specific history behind
 * it, and the wording is what a reader sees. Asserting on the source is the
 * direct way to express "these sentences must not come back".
 *
 * ## If this fails
 *
 * It is not a formatting complaint. Read the comment in
 * `components/BitgetAlignment.tsx` above the notice block before changing
 * anything here — the retired phrasing was requested by someone and dropping it
 * was a deliberate decision, not an oversight.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

/**
 * Flatten a source file to the text a reader actually ends up seeing.
 *
 * Two things have to go first, and both bit on this file's first run:
 *
 *   - **Comments.** The comments in `BitgetAlignment.tsx` *quote* the retired
 *     phrasing in order to explain why it was retired, so a naive scan finds
 *     the very words it is looking for and reports live copy that does not
 *     exist. Block comments go first, which covers the brace-wrapped ones JSX
 *     uses as well as these.
 *   - **Line comments**, which are the same problem one line down: the header
 *     of `basis.ts` discusses after-hours prints at length precisely to explain
 *     why it refuses to compute one. They are stripped with a `[^:]` guard on
 *     the `//`, because a naive strip treats `https://` as the start of a
 *     comment and truncates every line carrying a URL — which is how the first
 *     attempt at this helper quietly deleted half of `BitgetAlignment.tsx`.
 *   - **Line wrapping.** JSX and Markdown are both wrapped for width, so
 *     "not a live feed" can sit in the file as `not a live\n  feed`. Collapsing
 *     whitespace makes the assertion about the sentence rather than about where
 *     someone happened to break the line.
 *
 * What is left is the text a reader ends up seeing, which is the only thing
 * these guards are entitled to make claims about.
 */
function visibleCopy(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, ' ');
}

const PANEL = visibleCopy(read('src', 'components', 'BitgetAlignment.tsx'));
const README = visibleCopy(read('README.md'));
const BASIS = visibleCopy(read('src', 'lib', 'market', 'basis.ts'));
const COUNTERPART = visibleCopy(read('src', 'components', 'BitgetCounterpart.tsx'));

describe('the Bitget panel states an integration it actually has', () => {
  it('does not deny integrating with Bitget', () => {
    // The exact sentence, retired in 4f7c079's follow-up. It was false: the
    // app calls api.bitget.com on every analysis that has a counterpart. A
    // blanket denial printed next to a live Bitget price is worse than no
    // notice at all — it discredits the labels that are accurate.
    assert.equal(
      PANEL.includes('No Bitget integration'),
      false,
      'the app DOES integrate with Bitget (public market data) — see the note in BitgetAlignment.tsx',
    );
  });

  it('says which integration it has, rather than none', () => {
    assert.ok(PANEL.includes('Public market data only.'));
  });

  it('still forbids trading, in the words the request asked for', () => {
    // The half of the retired sentence that was true and remains true. This is
    // the load-bearing claim and it is the one part that must never be
    // softened: "can trade" and "cannot trade" are the whole product.
    assert.ok(PANEL.includes('Nothing here can trade.'));
  });

  it('enumerates the account surfaces it lacks, not just the trading one', () => {
    // Each of these is separately checkable and separately meaningful. "No
    // trading API" alone would leave a reader wondering about a key or an
    // account, neither of which exists.
    for (const absent of ['No Bitget account', 'no API key', 'no trading API']) {
      assert.ok(PANEL.includes(absent), `panel must still state: ${absent}`);
    }
  });

  it('distinguishes the dated mapping from the live price', () => {
    // The bug this guards is subtler than the blanket denial: the mapping and
    // the price are two different things with two different freshness
    // properties, and calling both "static" was true of one and false of the
    // other. The caption has to say which is which.
    assert.ok(PANEL.includes('not a live feed'));
    assert.ok(PANEL.includes('is live'));
  });
});

describe('the README does not make the same claim', () => {
  it('does not deny the integration', () => {
    assert.equal(README.includes('No fabricated Bitget integration'), false);
    assert.equal(README.includes('reads no Bitget listing feed'), false);
  });

  it('names the trading prohibition as the thing that is actually absent', () => {
    assert.ok(README.includes('No trading integration, and no fabricated one.'));
  });
});

/**
 * The basis, which is the newest way for a true sentence to become false.
 *
 * Comparing a tokenized price against the regular-session close produces a
 * percentage that is *numerically* indistinguishable from an after-hours move
 * in the equity — same sign, same rough magnitude, same place on the card. The
 * only thing separating them is wording. So the wording is what gets pinned
 * here, and it is pinned on the source rather than by rendering because there
 * is no renderer to run and because the exact words are the artefact.
 *
 * `basis.test.ts` covers the behaviour — that the phrase always names its
 * reference and never emits extended-hours vocabulary. These assert the same
 * property one level up, so a rewrite that keeps the tests passing but renames
 * the concept still trips something.
 */
describe('the tokenized basis never borrows the language of an after-hours print', () => {
  it('contains no extended-hours vocabulary in its code', () => {
    // Comments are stripped by `visibleCopy`, so the header of `basis.ts` — which
    // discusses after-hours prints at length in order to explain why it refuses
    // to compute one — does not count. What must not contain the phrase is any
    // identifier, literal or branch that could reach a reader.
    for (const forbidden of ['after-hours', 'after hours', 'post-market']) {
      assert.equal(
        BASIS.toLowerCase().includes(forbidden),
        false,
        `basis.ts must not use "${forbidden}" in code — a tokenized gap is not an extended-hours move`,
      );
    }
  });

  it('always names the reference it measured against', () => {
    // "regular-session print" is what makes the number self-describing. Without
    // it a percentage beside a tokenized price is a claim about the equity.
    assert.ok(
      BASIS.includes('regular-session print'),
      'the basis label must name the regular-session print',
    );
  });

  it('keeps the tokenized figure labelled as not the equity, on the card', () => {
    // Pre-existing copy, re-asserted here because the basis was added to the
    // same caption and an edit could have displaced it.
    assert.ok(COUNTERPART.includes('tokenized instrument, not a share'));
    assert.ok(COUNTERPART.includes('not an after-hours print for'));
    // And the basis is rendered through the shared phrase, not written inline —
    // a second wording is a second thing that can drift out of the guard.
    assert.ok(COUNTERPART.includes('basisPhrase(shown)'));
  });
});
