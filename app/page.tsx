import { demoNodes, demoEdges } from "@/lib/api";
import Link from "@/components/Link";
import FlightField from "@/src/motion/FlightField";
import SiteFooter from "@/components/SiteFooter";
import { SayIt, Statement, WhatItReads, Safety, Token, Faq, FinalCta } from "@/components/landing/Sections";
import { Fork, HowItWorks, LandingNotice, PaperPreview, WhatItTrades } from "@/components/landing/LandingLive";
import SiteHeader from "@/components/SiteHeader";
import StrategyGraph from "@/components/StrategyGraph";
import VenueMark from "@/components/VenueMark";
import { SAMPLE_PROMPT, VENUES, type Venue } from "@/src/content/landing";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="grain relative isolate overflow-hidden border-b border-line" data-motion="hero">
          {/* perf: the notice arrives after the landing fetch; overlay it in the hero's top padding so it never shifts layout (CLS) */}
          <LandingNotice />
          <FlightField className="-z-10" />
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,transparent,#0a0a0b_85%)]" />
          <div className="mx-auto max-w-[1200px] px-5 pb-20 pt-24 sm:px-8 sm:pb-28 sm:pt-28">
            <div className="max-w-[760px]">
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line-2 bg-card/60 px-3 py-1 font-mono text-[12px] uppercase tracking-[.14em] text-ink-2 backdrop-blur">
                <span data-motion="pulse-dot" className="relative h-1.5 w-1.5 rounded-full bg-accent" /> Paper trading live on Robinhood Chain
              </p>
              <h1
                className="text-balance text-[clamp(2.75rem,7vw,5.6rem)] font-medium leading-[.98] tracking-[-0.045em]">
                Type an idea.<br />Watch it <em className="font-serif font-normal italic tracking-[-0.02em] text-accent">trade</em>.
              </h1>
              <p className="mt-6 max-w-[34rem] text-pretty text-[17px] leading-relaxed text-ink-2">
                Describe a strategy in plain English. Quiver turns it into a node graph that watches prices, odds and funding across four venues — and trades only when every condition holds.
              </p>
              <div data-motion="rise" style={{ ["--d" as string]: "60ms" }} className="mt-9 flex flex-wrap gap-3">
                <Link prefetch={false} href="/app/new" className="btn rounded-full bg-accent px-5 py-3 text-[14px] font-medium text-bg hover:brightness-110 active:bg-accent-press">Build a strategy</Link>
                <a href="#how" className="btn rounded-full border border-line-2 px-5 py-3 text-[14px] text-ink hover:border-white/30 hover:bg-white/5">How it works</a>
              </div>
            </div>

            <div data-motion="rise" style={{ ["--d" as string]: "140ms" }} className="mt-16 rounded-[16px] border border-line-2 bg-bg-2/95 p-4 sm:mt-20 sm:p-6">
              <div className="mb-5 flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-[60ch] text-[13.5px] leading-snug text-ink-2"><span className="font-mono text-[12px] uppercase tracking-[.14em] text-muted">Thesis&nbsp;&nbsp;</span>{SAMPLE_PROMPT}</p>
                <span className="shrink-0 self-start rounded-full border border-line-2 px-2.5 py-1 font-mono text-[12px] uppercase tracking-[.14em] text-muted sm:self-auto">Demo data</span>
              </div>
              <StrategyGraph nodes={demoNodes} edges={demoEdges} />
            </div>
          </div>
        </section>

        <div className="cv-below">
        <section id="venues" className="border-b border-line">
          <div className="mx-auto grid max-w-[1200px] grid-cols-2 px-5 sm:px-8 md:grid-cols-4">
            {(Object.keys(VENUES) as Venue[]).map((v, i) => (
              <div key={v} className={`flex items-center gap-3 py-6 ${i % 2 ? "pl-5" : ""} md:pl-0 ${i ? "md:border-l md:border-line md:pl-6" : ""}`}>
                <VenueMark venue={v} />
                <div>
                  <div className="text-[13.5px] text-ink">{VENUES[v].name}</div>
                  <div className="text-[12px] text-muted">{VENUES[v].tag}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <SayIt />
        <Statement />
        <WhatItTrades />
        <WhatItReads />
        <HowItWorks />
        <PaperPreview />
        <Safety />
        <Fork />
        <Token />
        <Faq />
        <FinalCta />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
