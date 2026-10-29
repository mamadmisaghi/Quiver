"use client";
// M3.8: landing sections backed by GET /v1/public/landing (guest). Mock mode reads Sage's ext.landing.json fixture.
// One shared request per page load; sections render skeletons until it lands and an honest error if it fails.
// The API's `notice` is always rendered (LandingNotice) — it is the disclaimer for every number below it.
import Link from "@/components/Link";
import { useEffect, useState } from "react";
import { api, fmtPct, fmtUsd, type Landing } from "@/lib/api";
import VenueMark from "../VenueMark";
import { BtnPrimary, Card, Eyebrow, H2, Lead, Pill, Section, Spark } from "../ui";

let shared: Promise<Landing> | null = null;
function useLanding() {
  const [s, set] = useState<{ d: Landing | null; err: boolean }>({ d: null, err: false });
  useEffect(() => {
    let on = true;
    (shared ??= api.landing().catch((e) => { shared = null; throw e; })).then((d) => on && set({ d, err: false }), () => on && set({ d: null, err: true }));
    return () => { on = false; };
  }, []);
  return s;
}
const Skel = ({ className = "" }: { className?: string }) => <div aria-hidden="true" className={`animate-pulse rounded-[10px] bg-white/[.04] motion-reduce:animate-none ${className}`} />;
const Failed = () => <p role="status" className="rounded-[12px] border border-line p-5 text-[13.5px] text-muted">Couldn’t load example data right now. Try again in a minute.</p>;
const tag = (n: number) => String(n).padStart(2, "0");

export function LandingNotice() {
  const { d } = useLanding();
  if (!d?.notice) return null;
  return (
    <div role="note" data-testid="landing-notice" className="absolute inset-x-0 top-0 z-10 border-b border-line bg-[#14120c]">
      <p className="mx-auto max-w-[1200px] px-5 py-2 text-[12.5px] leading-snug text-ink-2 sm:px-8">
        <span aria-hidden="true" className="mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-warn" />{d.notice}
      </p>
    </div>
  );
}

export function WhatItTrades() {
  const { d, err } = useLanding();
  return (
    <Section id="trades">
      <div className="grid gap-14 lg:grid-cols-[22rem_1fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Eyebrow accent>Venues</Eyebrow>
          <H2 className="mt-5">One graph, four markets.</H2>
          <Lead className="mt-6">Signals and actions can sit on different venues. Odds on Polymarket can open a position on Hyperliquid and buy a stock token on Robinhood Chain in the same run.</Lead>
          {d && (
            <ul className="mt-8 grid gap-2 font-mono text-[12px]" aria-label="Venue status">
              {d.venues.map((v) => (
                <li key={v.id} className="flex items-center gap-2 text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${v.status === "up" ? "bg-long" : v.status === "degraded" ? "bg-warn" : "bg-short"}`} aria-hidden="true" />
                  <span className="text-ink-2">{v.name}</span><span>· {v.capabilities.join(", ")}</span><span className="sr-only">status {v.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {err ? <Failed /> : (
          <ul className="divide-y divide-line border-y border-line" aria-busy={!d}>
            {d ? d.trades.map((t, i) => (
              <li key={t.id} className="group grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 py-6 sm:grid-cols-[2.5rem_14rem_1fr_auto]">
                <span className="tnum font-mono text-[12px] text-muted">{tag(i + 1)}</span>
                <div className="text-[18px] font-medium tracking-[-0.02em]">{t.label}</div>
                <div className="col-start-2 text-[13.5px] text-muted sm:col-start-auto">{t.example}</div>
                <div className="col-start-3 row-start-1 flex items-center gap-2 sm:col-start-auto">
                  <span className="hidden gap-1 md:flex">{t.venues.map((v) => <VenueMark key={v} venue={v} />)}</span>
                  <Pill tone={t.status === "paper" ? "long" : "muted"}>{t.status === "paper" ? "Paper" : "Watch only"}</Pill>
                </div>
              </li>
            )) : [0, 1, 2, 3].map((i) => <li key={i} className="py-6"><Skel className="h-6" /></li>)}
          </ul>
        )}
      </div>
    </Section>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
export function PaperPreview() {
  const { d, err } = useLanding();
  const p = d?.preview ?? null;
  const up = p ? Number(p.pnlUsd) >= 0 : true;
  return (
    <Section id="paper">
      <div className="grid items-center gap-16 lg:grid-cols-[1.15fr_1fr]">
        {err ? <Failed /> : d && !p ? <Card className="bg-bg-2 p-6 text-[13.5px] text-muted">No preview run yet.</Card> : (
          <Card className="overflow-hidden bg-bg-2">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-2.5"><span data-motion="pulse-dot" className="relative h-1.5 w-1.5 shrink-0 rounded-full bg-long" /><span className="truncate text-[13.5px] font-medium">{p ? p.name : <Skel className="h-4 w-40" />}</span></div>
              <div className="flex shrink-0 gap-1.5">{p?.synthetic && <Pill tone="warn">Synthetic</Pill>}<Pill tone="accent">Paper · 7d</Pill></div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
              {([["Equity", p && fmtUsd(p.equityUsd), ""], ["PnL", p && `${fmtUsd(p.pnlUsd, { sign: true })} · ${fmtPct(p.pnlPct, { sign: true })}`, up ? "text-long" : "text-short"], ["Trades", p && String(p.trades), ""]] as const).map(([k, v, c]) => (
                <div key={k} className="min-w-0 px-5 py-4"><div className="text-[12px] text-muted">{k}</div><div className={`tnum mt-1 truncate font-mono text-[15px] ${c}`}>{v ?? <Skel className="h-5 w-16" />}</div></div>
              ))}
            </div>
            <div className="px-5 pt-5">{p ? <Spark pts={p.points} w={560} h={96} fluid draw tone={up ? "long" : "short"} /> : <Skel className="h-24" />}</div>
            <ul className="mt-3 divide-y divide-line border-t border-line font-mono text-[12px]" data-motion="run-feed">
              {p ? p.events.slice(0, 4).map((e, i) => (
                <li key={i} className="flex gap-4 px-5 py-2.5"><span className="tnum shrink-0 text-muted">{clock(e.ts)}</span><span className={e.type === "fill" ? "text-long" : "text-accent"}>{e.message}</span></li>
              )) : [0, 1, 2].map((i) => <li key={i} className="px-5 py-2.5"><Skel className="h-4" /></li>)}
            </ul>
            {p && <div className="border-t border-line px-5 py-2.5 font-mono text-[11.5px] text-muted">by {p.author.handle}{p.author.isYou ? " (you)" : ""} · {new Date(p.from).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – {new Date(p.to).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} UTC</div>}
          </Card>
        )}
        <div>
          <Eyebrow accent>Paper trading</Eyebrow>
          <H2 className="mt-5 max-w-[13ch]">Watch it think, live.</H2>
          <Lead className="mt-6">Every check, trigger and fill streams in as it happens, with modelled slippage and fees. You see exactly why it traded — or why it didn&apos;t.</Lead>
          <div className="mt-9"><BtnPrimary href="/app/run/demo">Open a live run</BtnPrimary></div>
        </div>
      </div>
    </Section>
  );
}

export function Fork() {
  const { d, err } = useLanding();
  return (
    <Section>
      <div className="flex items-end justify-between gap-6">
        <div><Eyebrow accent>Strategies</Eyebrow><H2 className="mt-5 max-w-[16ch]">Start from someone else&apos;s.</H2></div>
        <Link prefetch={false} href="/app/strategies" className="btn hidden text-[13.5px] text-muted hover:text-ink sm:block">All strategies →</Link>
      </div>
      {err ? <div className="mt-14"><Failed /></div> : (
        <div className="mt-14 grid gap-4 md:grid-cols-3" aria-busy={!d}>
          {d ? d.featured.slice(0, 3).map((s) => {
            const r = Number(s.paperReturn30dPct ?? 0);
            return (
              <Card key={s.id} className="p-6">
                <div className="flex items-center justify-between"><div className="flex gap-1">{s.venues.map((v) => <VenueMark key={v} venue={v} />)}</div>{s.mock && <Pill>Demo</Pill>}</div>
                <div className="mt-8 text-[17px] font-medium tracking-[-0.02em]">{s.name}</div>
                <div className="mt-1 font-mono text-[12px] text-muted">{s.author.handle} · {s.forks} {s.forks === 1 ? "fork" : "forks"}</div>
                <div className="mt-5 flex items-end justify-between">
                  <div><div className="text-[12px] text-muted">Paper, 30d</div><div className={`tnum font-mono text-[15px] ${r > 0 ? "text-long" : r < 0 ? "text-short" : "text-ink-2"}`}>{s.paperReturn30dPct == null ? "—" : fmtPct(s.paperReturn30dPct, { sign: true })}</div></div>
                  <Spark pts={s.spark} w={96} h={28} tone={r >= 0 ? "long" : "short"} />
                </div>
                <Link prefetch={false} href="/app/strategies" className="btn mt-6 block rounded-full border border-line-2 py-2 text-center text-[13px] hover:border-white/30 hover:bg-white/5">See it in strategies</Link>
              </Card>
            );
          }) : [0, 1, 2].map((i) => <Skel key={i} className="h-60" />)}
        </div>
      )}
      <p className="mt-6 text-[12px] text-muted">Past paper results aren&apos;t a promise of anything.</p>
    </Section>
  );
}

/** Critique #20: "What it can watch", "Teach it a move" and "It can trade, it can't take" merged into one block. */
export function HowItWorks() {
  const { d, err } = useLanding();
  const rows = err ? <li className="text-muted">Couldn’t load right now.</li> : [0, 1, 2, 3].map((i) => <li key={i}><Skel className="h-4" /></li>);
  const cols = [
    { k: "Watch", h: "Signals it can read", d: "Combine with and, or, not and “for at least N minutes”. Stale data never fires a trigger.",
      body: <ul className="mt-5 space-y-2 text-[13.5px]">{d ? <>{d.signals.filter((s) => s.supported).slice(0, 6).map((s) => <li key={s.id} className="flex justify-between gap-3"><span className="text-ink-2">{s.label}</span><span className="text-right text-muted">{s.detail}</span></li>)}
        {d.signals.some((s) => !s.supported) && <li className="flex justify-between gap-3 border-t border-line pt-2" data-supported="false"><span className="text-muted">Not supported yet</span><span className="text-right text-muted">{d.signals.filter((s) => !s.supported).map((s) => s.label).join(", ")}</span></li>}</> : rows}</ul> },
    { k: "Reuse", h: "Skills you teach once", d: "A skill is a saved piece of graph. Say its name in a prompt to drop it in.",
      body: <ul className="mt-5 space-y-2 text-[13.5px]">{d ? d.skills.slice(0, 4).map((s) => <li key={s.id} className="flex justify-between gap-3"><span className="font-mono text-[12.5px] text-ink-2">/{s.id}</span><span className="text-muted">{s.name}</span></li>) : rows}</ul> },
    { k: "Guard", h: "It can trade, not take", d: "A session key you can revoke in one tap, with caps and an expiry.",
      body: <ul className="mt-5 space-y-2 text-[13.5px] text-ink-2">{([["Trade through approved routers", true], ["Stay inside size and loss limits", true], ["Send funds to another address", false], ["Raise its own limits", false]] as const).map(([t, ok]) => <li key={t} className="flex gap-2.5"><span className={ok ? "text-long" : "text-short"} aria-label={ok ? "can" : "can't"}>{ok ? "✓" : "✕"}</span>{t}</li>)}</ul> },
  ];
  return (
    <Section id="how">
      <Eyebrow>How it works</Eyebrow>
      <H2 className="mt-5 max-w-[20ch]">It watches, reuses what you teach it, and stays inside your limits.</H2>
      <div className="mt-14 grid gap-px overflow-hidden rounded-[14px] border border-line bg-line lg:grid-cols-3">
        {cols.map((c, i) => (
          <div key={c.k} className="bg-bg-2 p-6 sm:p-7">
            <div className="flex items-center gap-3"><span className="tnum font-mono text-[12px] text-muted">0{i + 1}</span><span className="font-mono text-[12px] uppercase tracking-[.14em] text-muted">{c.k}</span></div>
            <div className="mt-5 text-[18px] font-medium tracking-[-0.02em]">{c.h}</div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{c.d}</p>
            {c.body}
          </div>
        ))}
      </div>
    </Section>
  );
}
