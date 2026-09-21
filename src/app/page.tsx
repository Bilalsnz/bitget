/**
 * AfterHours AI — the research desk.
 *
 * A server component: everything static is rendered once on the server, and the
 * only JavaScript shipped is the two client islands (`ResearchDesk` and
 * `MarketStatusPill`). The research tool is the first thing on the page — there
 * is no hero to scroll past.
 */

import { BitgetAlignment } from '@/components/BitgetAlignment';
import { MarketStatusPill } from '@/components/MarketStatusPill';
import { ResearchDesk } from '@/components/ResearchDesk';

const STEPS = [
  {
    title: 'Pull the tape',
    body: 'The latest quote, the session it was printed in, and recent headlines — straight from the data source.',
  },
  {
    title: 'Read the move',
    body: 'A model interprets what changed and what it means for the holding period you chose. It never supplies a number.',
  },
  {
    title: 'You decide',
    body: 'You get a stance, the reasons, and what would prove it wrong. Acting on it is entirely yours.',
  },
];

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-20 pt-5 sm:px-6">
      {/* ------------------------------------------------------------ header */}
      <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-white/[0.07] bg-ink-950/80 px-4 py-3 backdrop-blur-lg sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-cyan to-accent-violet text-sm font-black text-ink-950"
            >
              A
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-bold tracking-tight text-slate-50">
                AfterHours{' '}
                <span className="text-gradient bg-gradient-to-r from-accent-cyan to-accent-violet">
                  AI
                </span>
              </h1>
              <p className="text-[0.7rem] text-slate-500">
                Know what moved after the close.
              </p>
            </div>
          </div>

          <MarketStatusPill />
        </div>
      </header>

      <main>
        {/* --------------------------------------------------- the question */}
        <section className="mb-4">
          <h2 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">
            What changed after the close — and what should you consider doing next?
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Pick an instrument, a holding period and a risk profile. You get a structured research
            brief in seconds.
          </p>
        </section>

        {/* ------------------------------------------------- the instrument */}
        <ResearchDesk />

        {/* ------------------------------------------------ how this works */}
        <section className="mt-10">
          <h2 className="label">How this works</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title} className="panel p-4">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent-cyan/40 bg-accent-cyan/10 font-mono text-xs font-bold text-accent-cyan"
                >
                  {index + 1}
                </span>
                <h3 className="mt-2.5 text-sm font-semibold text-slate-100">{step.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* -------------------------------------------- where Bitget fits in */}
        <BitgetAlignment />
      </main>

      {/* ------------------------------------------------------------ footer */}
      <footer className="mt-10 border-t border-white/[0.07] pt-5">
        <p className="text-xs text-slate-500">
          Research only. Not financial advice. No trading.
        </p>
      </footer>
    </div>
  );
}
