# AfterHours AI

**Know what moved after the close. Decide what comes next.**

A mobile-first research desk for US equities. You pick an instrument, a holding
period and a risk profile; it returns a structured brief answering one question:

> What changed after the US market close, and what should I consider doing next?

**This is not an auto-trader.** There is no order execution, no brokerage
connection, no wallet, no deposit or withdrawal, and no trading API integration
of any kind. The strongest output it can produce is a research stance. Nothing
on the page can move money.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in FINNHUB_API_KEY
npm run dev                    # http://localhost:3000
```

The app runs with **no AI key configured**. It will answer using a
deterministic engine over real market data and label the result
**"Demo analysis"** in the UI. It cannot run with no *market* key, because
without a price there is nothing honest to analyse.

## Environment variables

Both are **server-side only**. Neither is ever prefixed with `NEXT_PUBLIC_`,
which would inline it into the JavaScript bundle and publish it to anyone who
opens devtools.

| Variable | Required | Purpose |
| --- | --- | --- |
| `FINNHUB_API_KEY` | **Yes** | Market data. Free key: <https://finnhub.io/register> |
| `GROQ_API_KEY` | No | Analysis model credential. Free key: <https://console.groq.com/keys>. Without it, the labelled demo engine answers. |
| `AI_MODEL` | No | Model id for live analysis. Defaults to `openai/gpt-oss-20b`. |

### Deploying to Vercel

Add `FINNHUB_API_KEY` (and optionally `GROQ_API_KEY`) under
**Project → Settings → Environment Variables**, then redeploy. Nothing else is
needed — no database, no auth provider, no paid infrastructure.

Check a deployment is wired up correctly with:

```
GET /api/health          # configuration status; booleans and names only
GET /api/health?probe=1  # also makes one real market-data call
GET /api/health?probe=bitget  # makes one real tokenized-ticker call, and says where it stopped
```

The health route reports *whether* a variable is set and *what it is called*.
It never returns a value, a prefix, or a length.

It also reports **which build is answering** — `build.commit` (short SHA),
`build.branch` and `build.environment`, read from the variables Vercel supplies
at build time, and `null` on a local run where they do not exist. That is there
because Vercel keeps the *previous* deployment serving when a build fails, so
"my push did not go live" and "my push went live" look identical from the
browser. Comparing `build.commit` against `origin/main` settles it in one
request instead of squinting at the UI for a sentence that only the new commit
contains. No secret is involved: all three values describe a public repository.

---

## Honesty rules this project is built to

These are load-bearing, not decoration. Each is enforced in code.

**No fabricated numbers.** Every market figure in the UI comes from the data
layer. The model is given the numbers and is instructed never to supply one of
its own; it is asked for interpretation only. If a figure is missing, the UI
shows it as unavailable rather than estimating it.

**No invented after-hours data.** The free Finnhub tier does not expose a
distinct extended-hours quote for US equities — every endpoint that could
(`/stock/candle`, `/stock/tick`, `/stock/bbo`, `/stock/bidask`) requires a paid
plan. So the app sets `afterHoursAvailable: false`, derives the session from the
quote's *own timestamp*, and states plainly on every card that the price shown
is the most recent available print rather than an after-hours quote. It also
asks `/stock/market-status` (which is free) what session the exchange reports
now, and says so when that disagrees with the quote.

**Regular-session data is never called after-hours pricing.** This is enforced
four times over, because it is the one mistake that reached a reader: a correct
price under a wrong session label. The prompt bans the wording in three places,
conditional on `afterHoursAvailable`; and `validateAnalysis` refuses any
`whatChanged`, reason or risk that asserts a session a data plan never supplied,
while still permitting honest statements of the limitation. The check is
sentence-level, so a correct disclaimer in one sentence cannot license an
assertion in the next. `findSessionMislabel` is exported and tested directly.

**Two notices, and no more.** The interface carries exactly two disclaimers —
*"Research only. Not financial advice. No trading."* next to the verdict, and
*"Regular-session data only (not live after-hours)."* next to the price. Both
live in `src/lib/disclaimers.ts`, so the card, the snapshot panel and the copied
brief cannot drift into three phrasings of the same promise, and both are
asserted in tests against that shared constant rather than a retyped string.

This is a deliberate reversal. The earlier build restated its limits in six
places — a provenance banner, a decision-stays-with-you panel, a fine-print
footer, an after-hours notice block, a loading footnote and a three-bullet "what
this is not" section. That read as defensive rather than confident, and a reader
who meets six caveats stops reading them. Length is not honesty; the two
sentences above carry the same two facts, and the enforcement that actually
matters is in code rather than in copy.

**A brief that leaves the app keeps its context.** "Copy brief" and "Share
brief" both serialise through `src/lib/brief.ts`, so the text carries the data
source, the exact quote timestamp and both notices into whatever chat it lands
in. A copied verdict without them is a number in search of a decision.

The regular-session notice is conditional on `afterHoursAvailable` — it
describes *this plan's* limit, so it must not outlive the limit. It is dropped
rather than left standing if a plan ever supplies a real extended-hours print.
The research-only notice is not conditional: it describes what the product is,
not what one provider returned on one day.

**Nothing persists server-side.** The last five briefs are kept in the reader's
own `localStorage` and nowhere else. There is no account to attach them to and
no endpoint that receives them. Every storage access is guarded, because a
history feature that can throw is worse than no history feature.

**Demo analysis is labelled as demo.** When no model credential is configured,
or the model call fails, or the response fails validation, the deterministic
engine answers and the card says **"Demo analysis"** as prominently as it would
say "Live AI analysis" — with a sentence explaining why. The demo engine never
claims to have read news it did not retrieve.

**Nothing unvalidated is rendered.** Model output is parsed, shape-checked,
range-checked and sanitised in `src/lib/schema.ts` before it can reach a
component. A response about the wrong ticker, with four risks, or with a
confidence of 940 degrades to the labelled fallback rather than to a broken card.

**No secrets in the browser.** All provider calls happen in `/api` routes. The
Finnhub key is sent as an `X-Finnhub-Token` header rather than a query
parameter, so it cannot leak into a URL, a proxy log or a `Referer`. Provider
error text is logged server-side and never placed in a response body.

**No trading integration, and no fabricated one.** The app holds no Bitget
account, calls no Bitget trading API, places no order, and stores no Bitget
credential. What it does call is Bitget's **public** market endpoint — a
keyless, read-only price lookup that exposes no account and accepts no order.

Worth stating precisely, because this README previously claimed the blanket
version: "no Bitget integration" stopped being true the moment a counterpart
price appeared on a card, and the app was saying it in the UI at the time. The
honest claim is not *whether* but *which* — public market data in, nothing out.
An app that reads a venue's prices while saying it does not integrate with that
venue has taught its reader to distrust every other label on the card, including
the correct ones. Its three Bitget-facing surfaces are a panel that states the
*rhythm* difference between the two markets, the tokenized counterpart named on
each instrument's card, and the price read for that counterpart. Nothing here is
a partnership claim, and nothing here can move funds.

The rhythm arithmetic is derived from the same constants the session classifier
uses (`src/lib/tradingHours.ts`), so it cannot drift out of agreement with the
hours the app actually keeps, and a test asserts the two still match.

**Tokenized counterparts are verified, dated, and dated as static.** Where an
instrument on the desk has an rStock on Bitget, the card names it (`NVDA →
rNVDA`), labels it "24/7 on Bitget", and links to that market. Every symbol and
URL in `src/lib/assets.ts` was read off live exchange listing data — the URL is
the exchange's own canonical market page, so a wrong ticker cannot arrive via a
typo or a guess. The panel states the date it was verified and says plainly that
**the mapping** is a static list, not a live feed: a venue can list, delist or
rename a tokenized equity at any time and this page would not know. The *price*
is a different thing and is live whenever the venue answers — the mapping is
dated, the price is not, and the panel now says which is which rather than
calling both static.

**One instrument deliberately has no counterpart: AAPL.** The mapping everyone
assumes — `AAPL → rAAPL` — does not exist; that symbol belongs to an unrelated
project, and Apple is not in the issuer's lineup. It is the single most likely
place for a plausible wrong answer to enter this app, so `bitget.test.ts` pins
its absence and fails if someone adds it back.

The badge links out and carries **no price of its own invention**. Where the
venue answers, it shows what the tokenized market is trading at — labelled with
that venue and the age of the quote, and captioned *"tokenized instrument, not a
share — not NVDA's price, and not an after-hours print for NVDA."* Where the
venue does not answer, the badge falls back to name-and-link with no figure at
all. It never carries a number forward from a previous render, and never shows
one it could not fetch.

**A tokenized price is not a share price, and the two are never merged.** It
lives in its own `TokenizedQuote` type and its own `snapshot.tokenized` field —
deliberately not inside `Quote`, because a shared field is how two instruments
become one "price", and that is the mislabelling this whole product exists to
prevent. The change is framed by what it is *not*: the desk still cannot see
extended hours, and this does not give it that. It is a second, different signal
from a market that happens not to close.

**Why an after-hours product shows it at all.** The desk's central limitation is
that its data plan cannot price extended hours. Tokenized equities trade 24/7,
so while the US tape is closed this market is still producing prices. That makes
it genuinely useful for the question the product asks — as a *different* signal,
never as a substitute for an after-hours print.

**The basis, which is what makes the figure more than decoration.** A price on
its own says what a crypto venue thinks an instrument is worth. The basis says
how far that sits from the last price the US tape printed, which is the question
this product exists to ask. So alongside the tokenized figure the card states the
gap — *"trading 2.31% above the 16:00 EDT regular-session print"* — computed as
`tokenized − close`, and as a percentage of **the close** (taking it of the
tokenized price instead gives a smaller number of the same sign that looks
entirely plausible and is wrong; `basis.test.ts` pins it).

It is computed once, in the market layer, and stored on the snapshot as
`tokenizedBasis`, so a saved brief reads the same next week as it did when the
card was built. The card and the copied brief render it through one shared
`basisPhrase`, because the phrase *is* the safeguard: a bare percentage next to a
tokenized price reads as a move in the equity, and a brief travels with none of
the card's surrounding context.

**The basis is computed against the closing print, or not at all.** The rule is
`session.atRegularClose` — the closing auction specifically, not merely "a
regular-session print". A 14:00 print is also a regular-session print, and a gap
against it measures movement *during* the session: a smaller, differently-caused
number that would carry the identical label, the identical caption and the
identical heading. On an after-hours desk a reader would take it for the
since-the-close move every time. Against a genuine extended-hours print it would
be worse still — comparing two instruments across two sessions this deployment
already admits it cannot separate. So rather than relabel per case, the module
computes nothing. An absent basis costs one line; a mislabelled one is the exact
failure this product was built to prevent.

Two smaller rules keep it honest. A gap inside half a basis point is `level with`
rather than a direction, because the two legs are not sampled at the same instant
and rendering `+0.00% above` claims a precision neither leg has. And the
direction word carries the sign — `3.00% below`, never `−3.00% below`, which
states one fact twice and reads as a stutter.

**The 24h change is derived, not read.** The venue publishes a `change24h` field
whose unit is ambiguous across its own examples — a ratio (`0.0182`) and a
percentage (`1.82`) are indistinguishable from the value alone, and reading one
as the other is a 100× error that looks entirely plausible on screen. So the
change is computed from the 24h open and the last price, two numbers whose
meaning is not in doubt. When the open is missing, the change is `null` and
nothing is shown. A blank is smaller than a wrong number.

**The whole integration is optional, and fails to nothing.** It is the only
upstream here whose failure is tolerated by design: any non-200, any malformed
payload, any timeout, and any payload naming a *different* market all return
`null`, which renders as no tokenized price. A crypto venue having a bad day
cannot take down a card whose actual job is to price a US equity. The failure
mode is an absent feature, never a wrong number — an asymmetry chosen
deliberately, because an absent price costs the reader nothing.

**It needs no key.** Bitget's public market endpoint requires no credential, so
this adds a second real data source to the desk without a second secret to
manage, leak or rotate. There is no trading API, no account, and no order
surface anywhere in it.

**What is not verified.** `api.bitget.com` was unreachable from the environment
this was built in, so the endpoint has never been exercised against a live
response. The response *shape* comes from Bitget's published v2 contract; the
*values* in tests are fixtures. That is why every failure path above is
explicit: an endpoint that turns out to differ returns `null` and the badge
renders as it did before this feature existed.


---

## Architecture

```
src/
├── app/
│   ├── layout.tsx              server · metadata, viewport, ambient background
│   ├── page.tsx                server · header, explainer, footer (ships no JS)
│   ├── globals.css             design tokens, glass panels, reduced-motion
│   └── api/
│       ├── analyze/route.ts    POST · snapshot + analysis in one payload
│       ├── quote/route.ts      GET  · snapshot only
│       ├── health/route.ts     GET  · config status, no values
│       └── routes.test.ts      the HTTP contract those three expose
├── components/
│   ├── ResearchDesk.tsx        client · request lifecycle, history, sticky bar
│   ├── ResearchForm.tsx        client · instrument, horizon, risk
│   ├── ResearchCard.tsx        the assembled answer, in reading order
│   ├── MarketSnapshotPanel.tsx the evidence table (never model-generated)
│   ├── BitgetAlignment.tsx     the 24/7 contrast + verified counterpart list
│   ├── BitgetCounterpart.tsx   the tappable rStock badge on a card
│   ├── BriefActions.tsx        client · copy / native share, text only
│   ├── BriefHistory.tsx        the last five briefs, stored locally
│   ├── Indicators.tsx          verdict, confidence, exposure, mode banner
│   ├── MarketStatusPill.tsx    client · session + configuration strip
│   ├── LoadingResearch.tsx     skeleton, shaped like the card that replaces it
│   └── ErrorNotice.tsx         friendly error surface
├── lib/
│   ├── types.ts                the domain contract
│   ├── assets.ts               curated instrument list + verified rStock map
│   ├── disclaimers.ts          the two notices, in one place
│   ├── errors.ts               typed errors → friendly copy, no internals
│   ├── schema.ts               strict model-output validation
│   ├── brief.ts                brief → plain text, for copy and share
│   ├── history.ts              localStorage-backed recent briefs
│   ├── tradingHours.ts         how much of the week the market is open
│   ├── request.ts              the input boundary
│   ├── api.ts                  response helpers
│   ├── market/
│   │   ├── finnhub.ts          server-only keyed data adapter
│   │   ├── bitget.ts           server-only KEYLESS tokenized-equity adapter
│   │   ├── basis.ts            tokenized price vs the closing print
│   │   ├── session.ts          US session + NYSE holiday calendar
│   │   ├── session.test.ts
│   │   └── bitget.test.ts      the optional source, tested by its failures
│   ├── ai/
│   │   ├── analyze.ts          orchestrator: live → validated → demo fallback
│   │   ├── analyze.test.ts     the pipeline, fetch stubbed at the boundary
│   │   ├── provider.ts         server-only model client
│   │   ├── prompt.ts           prompt + structured-output schema
│   │   ├── fallback.ts         deterministic engine
│   │   └── fallback.test.ts
│   ├── schema.test.ts
│   ├── brief.test.ts
│   ├── history.test.ts
│   ├── tradingHours.test.ts
│   ├── bitget.test.ts
│   └── request.test.ts
└── test-support/
    ├── finnhub-stub.ts         shared provider fixtures + the fetch seam
    └── result-fixture.ts       a complete ResearchResult, typed as one
```

`routes.test.ts` calls the handlers directly with real `Request` objects, so it
asserts against the same `Response` Next.js would hand a browser: status codes,
the error envelope, the `no-store` header, and — negatively, on every failure
path — that no key, provider message, or stack trace appears in a body.

`test-support/` is imported only by tests, so it is absent from the build.

**The one rule that shapes everything:** market numbers are produced by
`lib/market`, analysis *consumes* them, and the model is never the source of a
price. `MarketSnapshot` and `Analysis` are separate types and are never mixed.

### Failure behaviour

| What fails | What happens |
| --- | --- |
| Market data | Request fails with friendly copy. No analysis is attempted — there is nothing honest to analyse. |
| No AI credential | Demo engine answers, labelled "Demo analysis" with the reason. |
| Model call fails or times out | Same — demo engine, labelled, with the reason. |
| Model output fails validation | Same, with the failing rule logged server-side only. |
| Headlines or profile unavailable | Non-fatal. Degrades to a note on the card. |

## Scripts

```bash
npm run dev        # development server
npm run build      # production build
npm run lint       # eslint (next/core-web-vitals)
npm run typecheck  # tsc --noEmit, strict
npm test           # node --test, 230 tests
npm run check      # typecheck && lint && test
```

## Testing

230 tests cover the places where a bug would be a *correctness* problem rather
than a cosmetic one:

- **`schema.test.ts`** — the validation gate. Model misbehaviour is the threat
  model: prose instead of JSON, the wrong ticker, an out-of-band confidence,
  the wrong number of bullets, markdown decoration. It also covers the
  session-label rule: text that calls a regular-session print an after-hours
  one is rejected, and honest statements of the limitation are not.
- **`session.test.ts`** — session classification and the NYSE holiday calendar,
  including observed-date shifting, Good Friday via computus, and 13:00 ET half
  days. A calendar wrong by a day produces an app that confidently mislabels a
  closed market.
- **`fallback.test.ts`** — the demo engine. Its output is run through the *same*
  validator that gates model output, so "one contract, one validator" is a
  tested property rather than an aspiration.
- **`brief.test.ts`** — the text that leaves the app. A copied brief arrives
  without the card's two notices, so they have to be in the text itself; both
  are asserted against the shared constants in `lib/disclaimers.ts`, as is the
  rule that a missing number renders as "unavailable" rather than "$0.00". The
  shape guard is checked from both sides, including against a payload produced
  by the real pipeline and round-tripped through JSON.
- **`history.test.ts`** — storage the app does not own: unavailable storage,
  malformed JSON, entries that are not briefs, a write that throws on quota.
  All of them have to end in a rendered page, so the tests assert that none of
  them throw.
- **`tradingHours.test.ts`** — the arithmetic behind the Bitget panel, checked
  against the session classifier rather than against itself. Two of its cases
  assert that 09:30 and 16:00 ET classify as the app says they do, so if the
  regular session ever moves, the panel is caught claiming hours the app no
  longer keeps rather than quietly overstating the market's availability.
- **`bitget.test.ts`** — the tokenized-counterpart mapping, tested for *provenance*
  rather than behaviour. A symbol has to match its ticker and a URL has to match
  its symbol, and the set of mapped instruments has to equal the set that was
  actually verified — so adding one is a deliberate edit to the test, not a diff
  that slips through. It also asserts that AAPL has *no* counterpart, pinning the
  most likely plausible-wrong answer in the file.
- **`basis.test.ts`** — the tokenized gap against the closing print. Mostly
  about when it *refuses* to compute one: the arithmetic on two real prices is
  trivial, and what can actually go wrong is measuring against the wrong
  reference and labelling it as the right one. Its sessions are built through
  the real `sessionFor`, because a test that hard-coded `phase: 'regular'`
  would prove the multiplication and nothing about the interaction that decides
  the outcome — the lesson from the 16:00 bug next door.
- **`request.test.ts`** — the input boundary, including the distinction between
  a malformed symbol and a well-formed one we do not cover.
- **`analyze.test.ts`** — the full pipeline, market adapter through mode
  selection, with `fetch` stubbed at the network boundary. Both upstreams are
  reached through `fetch` directly, so one seam covers the market adapter and
  the model provider, and nothing that ships is replaced by a fake. The
  outbound provider request is asserted too — the prompt has to carry the real
  figures, or "the model must not invent numbers" is untestable.
- **`routes.test.ts`** — the HTTP contract: status codes, error envelope,
  cache headers, health reporting, and that no credential or provider message
  reaches a body.

### What the tests do not cover

Neither upstream was called live during development, because both need real
keys.

Every market-data assertion runs against a stand-in that speaks the documented
`/quote`, `/stock/profile2`, `/company-news` and `/stock/market-status` shapes.
The response *shapes* come from Finnhub's own OpenAPI spec; the *values* are
fixtures. Confirm the live path on a deployment with `GET /api/health?probe=1`,
which makes one real call and reports only the resulting code.

The provider tests are the same in kind: the stand-in speaks Groq's
chat-completions shape, taken from its published reference, and nothing here
proves what the live endpoint would return today. Because the request cannot be
made from a test, the code does not assume the live endpoint accepts our
`json_schema` response format — it handles the refusal explicitly, retrying
without the schema, and the validator gates the result either way.

**The tokenized-ticker endpoint is in the same position, and needs saying
plainly.** `api.bitget.com` is unreachable from the environment this was built
in — it times out there while other hosts answer normally, so it is that host
rather than the network — and it has therefore **never returned a live response
to this codebase**. The envelope and field names below come from Bitget's
published v2 contract; the values in the tests are fixtures. What the code does
*not* do is assume it is right: every parse fails to `null`, and `null` renders
as a badge with no figure on it.

That design choice has a cost worth naming: a wrong assumption about the
response shape looks exactly like a quiet market. Both produce a missing number.
`GET /api/health?probe=bitget` exists to tell them apart — it makes one real call
to the endpoint and reports the stage it reached (`transport`, `http`,
`envelope`, `no-matching-row`, `unusable-price`) plus the HTTP status, or the
price and row count on success. **Run it first if a badge shows no price**: it
separates "the venue is unreachable" from "we misread the response", which are
different problems with different fixes.

## Licence and disclaimer

Research and decision-support tool. Not investment advice, not an offer or
solicitation to transact. Market data is provided by Finnhub on a limited plan
and may be delayed. Analysis is generated from the snapshot shown and can be
wrong.
