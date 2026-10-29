"use client";
import Link from "@/components/Link";
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import VenueMark from "@/components/VenueMark";
import Wrap from "@/components/Wrap";
import { Card, Pill } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, type Venue } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
const TABS: [string, Venue | null][] = [["All", null], ["Stocks", "robinhood"], ["Perps", "hyperliquid"], ["Solana", "solana"], ["Odds", "polymarket"]];
const SUB = "Reusable building blocks. Drop one into any strategy, or ask the AI to use it.";
export default function SkillsView() {
  const [t, setT] = useState<Venue | null>(null);
  const q = useQ(() => api.skills());
  if (!q.data) return <Wrap><PageHeader title="Skills" sub={SUB} /><Loading h={420} q={q} /></Wrap>;
  const items = q.data.filter((s) => !t || s.venues.includes(t));
  return (
    <Wrap>
      <PageHeader title="Skills" sub={SUB} />
      <div className="mt-8 flex flex-wrap gap-2" role="tablist">{TABS.map(([l, v]) => <button key={l} role="tab" aria-selected={t === v} onClick={() => setT(v)} className={`btn rounded-full px-3.5 py-1.5 text-[13px] ${t === v ? "bg-white/[.08]" : "text-muted hover:text-ink"}`}>{l}</button>)}</div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((s) => (
          <Card key={s.id} className="flex flex-col p-6 transition-colors hover:border-line-2">
            <div className="flex items-center justify-between"><span className="flex gap-1">{s.venues.map((v) => <VenueMark key={v} venue={v} />)}</span><Pill>{s.blocks} blocks</Pill></div>
            <h2 className="mt-8 text-[17px] font-medium tracking-[-0.02em]">{s.name}</h2>
            <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">{s.desc}</p>
            <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
              <span className="font-mono text-[12px] text-muted">by {s.by}</span>
              <Link href={`/app/new?q=${encodeURIComponent(s.prompt)}`} className="text-[13px] text-ink hover:underline">Use skill →</Link>
            </div>
          </Card>
        ))}
        <Card className="flex flex-col items-start justify-center border-dashed p-6">
          <h2 className="text-[17px] font-medium">Write your own</h2>
          <p className="mt-2 text-[14px] text-muted">Describe a rule once, save it as a skill, reuse it everywhere.</p>
          <Link href="/app/new" className="btn mt-5 rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5">Start from a prompt</Link>
        </Card>
      </div>
    </Wrap>
  );
}
