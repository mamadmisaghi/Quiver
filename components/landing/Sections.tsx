import FaqItem from "./FaqItem";
import { ArrowUpRight, Activity, CalendarClock } from "lucide-react";
import VenueMark from "../VenueMark";
import { Card, Em, Eyebrow, H2, Lead, Section } from "../ui";
import { VENUES } from "@/src/content/landing";

const TICKER = "$QUIVR";

import { EXAMPLE_POLICY } from "@/src/content/landing";
export function SayIt() {
  return (
    <Section id="draft">
      <div className="grid items-center gap-16 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Eyebrow accent>Draft</Eyebrow>
          <H2 className="mt-5 max-w-[14ch]">Write one sentence. Get a <Em>strategy</Em>.</H2>
          <Lead className="mt-6">You describe the setup. Quiver finds the markets, picks the price feeds and lays the rules out as a graph you can read in five seconds.</Lead>
          <ol className="mt-10 space-y-px overflow-hidden rounded-[14px] border border-line">
            {[["Say it", "Describe your rules, or sign in to use the configured chart AI."], ["Check it", "Every rule is shown as a node. Review the rules, then revise your description."], ["Practice it", "Run the rules in a paper session and inspect each fill."]].map(([t, d], i) => (
              <li key={t} className="flex gap-5 bg-bg-2 px-5 py-4">
                <span className="tnum pt-0.5 font-mono text-[12px] text-accent">0{i + 1}</span>
                <div><div className="text-[15px] font-medium">{t}</div><div className="mt-0.5 text-[13.5px] text-muted">{d}</div></div>
              </li>
            ))}
          </ol>
        </div>
        <Card className="overflow-hidden bg-bg-2">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-white/15" /><span className="h-2 w-2 rounded-full bg-white/15" /><span className="h-2 w-2 rounded-full bg-white/15" />
            <span className="ml-3 font-mono text-[12px] text-muted">quiver / new</span>
          </div>
          <div className="p-5 sm:p-6">
            <div className="rounded-[10px] border border-line-2 bg-card p-4 text-[14.5px] leading-relaxed text-ink">
              Buy $200 of AAPL every Monday the market opens red, but skip earnings weeks<span data-motion="caret" className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] bg-accent" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[["Signal", "AAPL open vs prior close · earnings date"], ["Trigger", "Monday, opens below close, no report within 5 days"], ["Action", "Buy $200 AAPL · Robinhood Chain"]].map(([k, v], i) => (
                <div key={k} data-motion="rise" style={{ ["--d" as string]: `${200 + i * 120}ms` }} className={`rounded-[10px] border p-3.5 ${k === "Trigger" ? "border-accent/40 bg-accent-soft" : "border-line bg-card"}`}>
                  <div className={`font-mono text-[12px] uppercase tracking-[.14em] ${k === "Trigger" ? "text-accent" : "text-muted"}`}>{k}</div>
                  <div className="mt-2 text-[13px] leading-snug text-ink-2">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between rounded-[10px] border border-line bg-card px-4 py-3">
              <div className="flex items-center gap-3"><VenueMark venue="robinhood" /><span className="text-[13.5px]">Next check</span></div>
              <span className="tnum font-mono text-[12.5px] text-ink-2">Mon 09:30 ET</span>
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}

export function Statement() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-[1000px] px-5 py-28 text-center sm:px-8 sm:py-36">
        <p className="text-balance text-[clamp(1.9rem,3.8vw,3.1rem)] font-medium leading-[1.12] tracking-[-0.035em]">
          Most trades are lost waiting. <span className="text-muted">Quiver does the waiting — across four venues, every few seconds — and moves only when your whole thesis is true.</span>
        </p>
      </div>
    </section>
  );
}

export function Safety() {
  return (
    <section id="safety" className="grain relative border-t border-line bg-bg">
      <div className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
        <Eyebrow accent>Safety</Eyebrow>
        <H2 className="mt-5 max-w-[18ch]">It can trade. It can’t take.</H2>
        <div className="mt-14 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
          <Card className="bg-bg-2 p-6 sm:p-8">
            {/* Session-key policy sheet (fields from SessionKeyPolicy). Deliberately not a trust diagram (WEFT-CHECK). */}
            <div className="flex items-center justify-between gap-3 whitespace-nowrap border-b border-line pb-4">
              <span className="font-mono text-[12px] uppercase tracking-[.14em] text-muted"><span className="sm:hidden">Key policy</span><span className="hidden sm:inline">Session key policy</span></span>
              <span className="font-mono text-[12px] text-muted"><span className="sm:hidden">Default policy</span><span className="hidden sm:inline">Default policy · Robinhood Chain</span></span>
            </div>
            <dl className="mt-2 divide-y divide-line font-mono text-[13px]">
              {([["allowedTargets", "Uniswap Universal Router · swap only", true], ["recipientMustBe", "self — output returns to your account", true], ["perTxCapUsd", EXAMPLE_POLICY.perTxCapUsd, true], ["dailyCapUsd", `${EXAMPLE_POLICY.dailyCapUsd} · min swap ${EXAMPLE_POLICY.minSwapUsd}`, true], ["maxSlippagePct", EXAMPLE_POLICY.maxSlippagePct, true], ["expiresAt", "30 days max", true], ["nativeTransfer", "false", false], ["erc20Transfer", "false", false]] as const).map(([k, v, ok]) => (
                <div key={k} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[11rem_1fr] sm:items-center">
                  <dt className="text-muted">{k}</dt>
                  <dd className="flex items-baseline justify-between gap-4 tabular-nums text-ink-2">
                    <span>{v}</span>
                    <span className={`shrink-0 ${ok ? "text-accent" : "text-short"}`}><span aria-hidden="true">{ok ? "allow" : "block"}</span><span className="sr-only">{ok ? "allowed" : "blocked"}</span></span>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
          <div className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-1">
            <div className="bg-bg-2 p-6">
              <div className="font-mono text-[12px] uppercase tracking-[.14em] text-accent">Can</div>
              <ul className="mt-3 space-y-2 text-[14px] text-ink-2"><li>Place trades through approved routers</li><li>Close positions you opened with it</li><li>Stay inside your size and loss limits</li></ul>
            </div>
            <div className="bg-bg-2 p-6">
              <div className="font-mono text-[12px] uppercase tracking-[.14em] text-short">Can’t</div>
              <ul className="mt-3 space-y-2 text-[14px] text-ink-2"><li>Send funds to any other address</li><li>Raise its own limits</li><li>Keep trading after you press stop</li></ul>
            </div>
          </div>
        </div>
        <div className="mt-10 grid gap-6 text-[13.5px] leading-relaxed text-muted md:grid-cols-3">
          <p><span className="text-ink">Your wallet, your keys.</span> Funds sit in a smart account only you control.</p>
          <p><span className="text-ink">Revoke in one tap.</span> Pulling the session key stops every strategy at once.</p>
          <p><span className="text-ink">Paper first.</span> Orders in the workspace use virtual funds.</p>
        </div>
      </div>
    </section>
  );
}

export function Token() {
  return (
    <Section id="token">
      <div className="grid gap-14 lg:grid-cols-[1fr_1fr]">
        <div>
          <Eyebrow accent>Token</Eyebrow>
          <H2 className="mt-5"><span className="font-mono text-[.8em] tracking-[-0.04em]">{TICKER}</span> is not live yet.</H2>
          <Lead className="mt-6">There is nothing to buy today. When it launches, the contract address will be published here and on our X account only. Anyone sharing an address before then is not us.</Lead>
        </div>
        <Card className="self-start p-6">
          <div className="text-[12px] text-muted">Contract address</div>
          <div className="mt-2 flex items-center justify-between rounded-[10px] border border-dashed border-line-2 px-4 py-3 font-mono text-[13px] text-muted">
            <span>Published at launch</span><span aria-hidden>—</span>
          </div>
          <dl className="mt-6 divide-y divide-line text-[13.5px]">
            {[["Ticker", TICKER], ["Chain", "To be confirmed"], ["Fee model", "To be confirmed"], ["Holder benefits", "To be confirmed"]].map(([k, v]) => (
              <div key={k} className="flex justify-between py-3"><dt className="text-muted">{k}</dt><dd className="font-mono text-ink-2">{v}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </Section>
  );
}

const FAQ = [
  ["Do I need to know how to code?", "No. You write the idea in a sentence; Quiver turns it into rules you can read and edit as nodes."],
  ["Is my money at risk while paper trading?", "No. Paper runs use live prices with simulated fills and a pretend balance."],
  ["Which venues are supported?", `${Object.values(VENUES).map((v) => v.name).join(", ")}. Polymarket is a signal source only for now.`],
  ["What are stock tokens?", "Tokens on Robinhood Chain that track a share's price. They trade around the clock, while price feeds update on market days."],
  ["Can I use stock tokens from the US?", "No. Stock tokens are not available to US persons and some other regions. We check eligibility before live trading."],
  ["What happens if data is stale?", "Every signal has a maximum age. Old data counts as unknown, and unknown never fires a trigger."],
  ["Can Quiver withdraw my funds?", "No. Its session key can only send trades to approved routers, and you can revoke it at any time."],
  ["When does live trading open?", "Quiver currently offers paper trading. A live launch date hasn’t been announced."],
];
export function Faq() {
  return (
    <Section id="faq">
      <div className="grid gap-14 lg:grid-cols-[22rem_1fr]">
        <div><Eyebrow accent>FAQ</Eyebrow><H2 className="mt-5">Questions, answered.</H2></div>
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map(([question, answer]) => <FaqItem key={question} question={question} answer={answer} />)}
        </div>
      </div>
    </Section>
  );
}

export function FinalCta() {
  return (
    <section className="q-final-cta grain relative overflow-hidden border-t border-line">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(50%_60%_at_50%_100%,color-mix(in_srgb,var(--q-amber)_6%,transparent),transparent)]" />
      <div className="relative mx-auto max-w-[820px] px-5 py-28 text-center sm:px-8 sm:py-40">
        <H2>What&apos;s your <Em>next</Em> trade?</H2>
        <form action="/app/new" className="q-focus-group mx-auto mt-10 flex max-w-[600px] items-center gap-2 rounded-full border border-line-2 bg-card p-1.5 pl-5 focus-within:border-accent/50">
          <label htmlFor="cta" className="sr-only">Describe a trade</label>
          <input id="cta" name="q" placeholder="Buy NVDA if it gaps down 3% at the open…" className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none" />
          <button className="btn shrink-0 rounded-full bg-accent px-4 py-2.5 text-[13.5px] font-medium text-bg hover:brightness-110">Draft it</button>
        </form>
      </div>
    </section>
  );
}

const SIGNAL_GROUPS = [
  { title: "Market signals", icon: Activity, inputs: [
    { name: "Price", detail: "A market price or a move from a reference price.", idea: "Buy $150 of TSLA when it drops 3% below yesterday’s close." },
    { name: "Indicators", detail: "Moving averages, RSI and changes over a time window.", idea: "Long $300 of ETH at 2x when the 1h RSI goes under 30." },
    { name: "Funding", detail: "The funding rate on a perpetual market.", idea: "Short $200 of SOL when funding turns negative for two hours." },
    { name: "Prediction odds", detail: "The probability of a selected Polymarket outcome.", idea: "Buy $250 of NVDA when the odds of a December Fed cut pass 70%." },
  ] },
  { title: "Time & positions", icon: CalendarClock, inputs: [
    { name: "Market hours", detail: "Whether the stock market is open for an order.", idea: "Buy $200 of AAPL every Monday the market opens red." },
    { name: "Schedule", detail: "A time, a time zone and a repeating interval.", idea: "Buy $50 of ETH every Friday at noon." },
    { name: "Your position", detail: "The size and return of an open paper position.", idea: "Long $250 of SOL at 2x when it breaks its 20-day high; take profit at +8%." },
  ] },
];
export function WhatItReads() {
  return <section id="reads" className="border-t border-line">
    <div className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8">
      <H2>Seven things it <Em>reads</Em>.</H2>
      <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-muted">Combine market conditions with timing and position rules. Choose an input to start writing a strategy.</p>
      <div className="q-input-groups" data-testid="reads-list">{SIGNAL_GROUPS.map(({ title, icon: Icon, inputs }) => <div key={title} className="q-input-group">
        <h3><Icon size={17} aria-hidden="true" />{title}</h3>
        <ul>{inputs.map(input => <li key={input.name}><a href={`/app/new?idea=${encodeURIComponent(input.idea)}`} aria-label={`Start a strategy using ${input.name.toLowerCase()}`}>
          <span><strong>{input.name}</strong><small>{input.detail}</small></span><ArrowUpRight size={16} aria-hidden="true" />
        </a></li>)}</ul>
      </div>)}</div>
    </div>
  </section>;
}
