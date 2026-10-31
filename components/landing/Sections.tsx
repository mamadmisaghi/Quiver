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
            {[["Say it", "Describe your rules, or sign in to use the configured chart AI."], ["Check it", "Every rule is shown as a node. Review the rules, then revise your description."], ["Practice it", "Test your draft on labelled synthetic prices. Continuous paper runs are pending activation."]].map(([t, d], i) => (
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
              <span className="font-mono text-[12px] text-muted"><span className="sm:hidden">example · chain 4663</span><span className="hidden sm:inline">example · Robinhood Chain 4663</span></span>
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
          <p><span className="text-ink">Paper first.</span> Live trading opens behind a waitlist after testnet.</p>
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
  ["When does live trading open?", "After testnet. Join the waitlist from the app."],
];
export function Faq() {
  return (
    <Section id="faq">
      <div className="grid gap-14 lg:grid-cols-[22rem_1fr]">
        <div><Eyebrow accent>FAQ</Eyebrow><H2 className="mt-5">Questions, answered.</H2></div>
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16px] font-medium tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                {q}<span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-2 text-muted transition-transform duration-300 group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-[60ch] text-[14.5px] leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function FinalCta() {
  return (
    <section className="grain relative overflow-hidden border-t border-line">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(50%_60%_at_50%_100%,color-mix(in_srgb,var(--q-amber)_6%,transparent),transparent)]" />
      <div className="relative mx-auto max-w-[820px] px-5 py-28 text-center sm:px-8 sm:py-40">
        <H2>What&apos;s your <Em>next</Em> trade?</H2>
        <form action="/app/new" className="mx-auto mt-10 flex max-w-[600px] items-center gap-2 rounded-full border border-line-2 bg-card p-1.5 pl-5 focus-within:border-accent/50">
          <label htmlFor="cta" className="sr-only">Describe a trade</label>
          <input id="cta" name="q" placeholder="Buy NVDA if it gaps down 3% at the open…" className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none" />
          <button className="btn shrink-0 rounded-full bg-accent px-4 py-2.5 text-[13.5px] font-medium text-bg hover:brightness-110">Draft it</button>
        </form>
      </div>
    </section>
  );
}

/** M4.6 "What Quiver reads": the signal kinds the compiler supports (lib/contracts/strategy.ts Signal). Our own list layout —
 *  a spec sheet of inputs, not a chip grid. Each row prefills /app/new?idea=… (never auto-submits).
 *  Ellis hooks: section[data-motion="reads"], rows [data-motion="read-row"] with --i index; .reads-sample is the value that can tick. */
const READS: { kind: string; name: string; what: string; sample: string; idea: string }[] = [
  { kind: "price", name: "Price", what: "Chainlink feeds on Robinhood Chain, or the venue’s own mid.", sample: "TSLA 241.18", idea: "Buy $150 of TSLA when it drops 3% below yesterday’s close." },
  { kind: "indicator", name: "Indicators", what: "SMA, EMA, RSI, ATR, Bollinger bands and % change, from 1m to 1d.", sample: "ETH RSI(14) 1h · 28.4", idea: "Long $300 of ETH at 2x when the 1h RSI goes under 30." },
  { kind: "funding", name: "Funding", what: "Hourly funding on Hyperliquid perps.", sample: "SOL funding −0.0041%", idea: "Short $200 of SOL when funding turns negative for two hours." },
  { kind: "odds", name: "Prediction odds", what: "Polymarket outcome prices, read-only.", sample: "Fed cut in Dec · 63¢", idea: "Buy $250 of NVDA when the odds of a December Fed cut pass 70%." },
  { kind: "market_session", name: "Market hours", what: "NYSE open, closed, pre, post or halted — stock trades wait for the bell.", sample: "XNYS · open", idea: "Buy $200 of AAPL every Monday the market opens red." },
  { kind: "timer", name: "Schedule", what: "Cron times in your time zone, for DCA and rebalances.", sample: "Mon 09:35 America/New_York", idea: "Buy $50 of ETH every Friday at noon." },
  { kind: "position", name: "Your position", what: "Size and P&L of what the run already holds — for take-profits and adds.", sample: "SOL long · +4.2%", idea: "Long $250 of SOL at 2x when it breaks its 20-day high; take profit at +8%." },
];
export function WhatItReads() {
  return (
    <section id="reads" data-motion="reads" className="border-t border-line">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <Eyebrow accent>Inputs</Eyebrow>
          <H2 className="mt-5 max-w-[14ch]">Seven things it <Em>reads</Em>.</H2>
          <Lead className="mt-6">Every rule is built from these. Mix them freely — a price, a funding rate and a market-hours check can sit in one trigger, and nothing fires until all of them agree.</Lead>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line" data-testid="reads-list">
          {READS.map((r, i) => (
            <li key={r.kind} data-motion="read-row" style={{ ["--i" as string]: i }} className="group grid gap-x-5 gap-y-1.5 bg-bg-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-[15px] font-medium">{r.name}</span><span className="font-mono text-[11.5px] text-muted">{r.kind}</span></div>
                <p className="mt-0.5 text-[13.5px] text-muted">{r.what}</p>
              </div>
              <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1.5">
                <span className="reads-sample tnum min-w-0 font-mono text-[12.5px] text-ink-2">{r.sample}</span>
                <a href={`/app/new?idea=${encodeURIComponent(r.idea)}`} className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded text-[12.5px] text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent">Start with this<span className="sr-only">: {r.name.toLowerCase()} strategy</span> →</a>
              </div>
            </li>))}
        </ul>
      </div>
    </section>
  );
}
