"use client";
// M4.2: GET /v1/approvals (status filter) + POST /v1/approvals/:id. Runs started with "Ask before each trade" land here.
import { useState } from "react";
import Link from "@/components/Link";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import Loading from "@/components/Loading";
import ApprovalPrompt, { resultNote } from "@/components/ApprovalPrompt";
import VenueMark from "@/components/VenueMark";
import { Card } from "@/components/ui";
import { api, fmtUsd, fmtInstrument, type ApprovalStatus } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";

const TABS: [ApprovalStatus | undefined, string][] = [["pending", "Waiting"], [undefined, "All"]];
const SIDE: Record<string, string> = { buy: "Buy", sell: "Sell", long: "Long", short: "Short" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ApprovalsView() {
  const [tab, setTab] = useState<ApprovalStatus | undefined>("pending");
  const [note, setNote] = useState<string | null>(null);
  const q = useQ(() => api.approvals({ status: tab, limit: 50 }), [tab]);
  const items = q.data?.items ?? [];
  return (
    <Wrap>
      <PageHeader title="Approvals" sub="Runs set to ask before each trade wait here. Closes and exits never wait." />
      <div className="mt-6 flex gap-1.5" role="tablist" aria-label="Filter">
        {TABS.map(([v, l]) => <button key={l} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`btn rounded-full border px-3.5 py-1.5 text-[13px] ${tab === v ? "border-accent/60 text-accent" : "border-line-2 text-ink-2 hover:bg-white/5"}`}>{l}</button>)}
      </div>
      {note && <p role="status" className="mt-4 text-[13px] text-muted">{note}</p>}
      {!q.data ? <div className="mt-5"><Loading h={240} q={q} /></div> : items.length === 0 ? (
        <Card className="mt-5 p-6 text-[13.5px] text-muted" data-testid="approvals-empty">{tab === "pending" ? "Nothing is waiting for you." : "No approvals yet."} To use them, start a paper run with “Ask before each trade” on.</Card>
      ) : (
        <div className="mt-5 grid gap-2" data-testid="approvals-list">
          {items.map((a) => a.status === "pending"
            ? <ApprovalPrompt key={a.id} item={a} title={`Run …${a.runId.slice(-6)}`} onResolved={(_, n) => { setNote(n); q.reload(); }} />
            : <Card key={a.id} className="flex flex-col gap-1 p-4 text-[13.5px] sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0"><span className="block text-[12px] text-muted">{a.strategyName}</span><span className="flex flex-wrap items-center gap-2"><VenueMark venue={a.venue} />{a.actionTitle || `${SIDE[a.side]} ${fmtInstrument(a.instrument)}`} <span className="font-mono tabular-nums text-ink-2">~{fmtUsd(a.notionalUsd)}</span></span></span>
                <span className="text-[12.5px] text-muted">{resultNote(a)} · {when(a.resolvedAt ?? a.createdAt)} · <Link className="underline" href={`/app/run/${a.runId}`}>Run</Link></span>
              </Card>)}
        </div>)}
    </Wrap>
  );
}
