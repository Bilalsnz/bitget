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
```

The health route reports *whether* a variable is set and *what it is called*.
It never returns a value, a prefix, or a length.

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

**No Bitget claims.** Nothing in this project verifies that any equity is
tokenised on Bitget, so the app makes no such claim and integrates no Bitget
trading API. The instrument list in `src/lib/assets.ts` deliberately has no
tokenised-symbol field.

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
│   ├── ResearchDesk.tsx        client · request lifecycle state machine
│   ├── ResearchForm.tsx        client · instrument, horizon, risk
│   ├── ResearchCard.tsx        the assembled answer, in reading order
│   ├── MarketSnapshotPanel.tsx the evidence table (never model-generated)
│   ├── Indicators.tsx          verdict, confidence, exposure, mode banner
│   ├── MarketStatusPill.tsx    client · session + configuration strip
│   ├── LoadingResearch.tsx     skeleton
│   └── ErrorNotice.tsx         friendly error surface
├── lib/
│   ├── types.ts                the domain contract
│   ├── assets.ts               curated instrument list
│   ├── errors.ts               typed errors → friendly copy, no internals
│   ├── schema.ts               strict model-output validation
│   ├── request.ts              the input boundary
│   ├── api.ts                  response helpers
│   ├── market/
│   │   ├── finnhub.ts          server-only data adapter
│   │   ├── session.ts          US session + NYSE holiday calendar
│   │   └── session.test.ts
│   ├── ai/
│   │   ├── analyze.ts          orchestrator: live → validated → demo fallback
│   │   ├── analyze.test.ts     the pipeline, fetch stubbed at the boundary
│   │   ├── provider.ts         server-only model client
│   │   ├── prompt.ts           prompt + structured-output schema
│   │   ├── fallback.ts         deterministic engine
│   │   └── fallback.test.ts
│   ├── schema.test.ts
│   └── request.test.ts
└── test-support/
    └── finnhub-stub.ts         shared fixtures + the fetch seam
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
npm test           # node --test, 135 tests
npm run check      # typecheck && lint && test
```

## Testing

135 tests cover the places where a bug would be a *correctness* problem rather
than a cosmetic one:

- **`schema.test.ts`** — the validation gate. Model misbehaviour is the threat
  model: prose instead of JSON, the wrong ticker, an out-of-band confidence,
  the wrong number of bullets, markdown decoration.
- **`session.test.ts`** — session classification and the NYSE holiday calendar,
  including observed-date shifting, Good Friday via computus, and 13:00 ET half
  days. A calendar wrong by a day produces an app that confidently mislabels a
  closed market.
- **`fallback.test.ts`** — the demo engine. Its output is run through the *same*
  validator that gates model output, so "one contract, one validator" is a
  tested property rather than an aspiration.
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

## Licence and disclaimer

Research and decision-support tool. Not investment advice, not an offer or
solicitation to transact. Market data is provided by Finnhub on a limited plan
and may be delayed. Analysis is generated from the snapshot shown and can be
wrong.
