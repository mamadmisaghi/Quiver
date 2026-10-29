"use client";
// M5.4 Plan with AI: streams POST /autopilot/plan/stream (status → candidate cards → plan), falls back to POST /autopilot/plan.
// The proposal is shown as a diff against current settings and applied only on an explicit click (PUT /autopilot, enabled:false).
import { useEffect, useRef, useState } from "react";
import { api, ApiErr, errCopy, fmtNum, type Autopilot, type AutopilotPlan, type AutopilotPlanCandidate, type AutopilotPlanReq } from "@/lib/api";
import { Card, Pill } from "@/components/ui";

type Goal = NonNullable<AutopilotPlanReq["goal"]>;
const GOALS: [Goal, string][] = [["balanced", "Balanced"], ["return", "Return"], ["low_risk", "Low risk"]];
// Gate fix: a stream that sends nothing for IDLE_MS (or runs past MAX_MS) is aborted and shown as a calm timeout with Retry.
const IDLE_MS = 30_000, MAX_MS = 120_000;
const pct = (s: string) => `${Number(s) >= 0 ? "+" : ""}${fmtNum(s, 2)}%`;

export default function PlanPanel({ cur, names, onApplied }: { cur: Autopilot; names: Record<string, string>; onApplied: (a: Autopilot) => void }) {
  const [goal, setGoal] = useState<Goal>("balanced");
  const [days, setDays] = useState<7 | 30>(7);
  const [status, setStatus] = useState<string | null>(null);
  const [cands, setCands] = useState<AutopilotPlanCandidate[]>([]);
  const [plan, setPlan] = useState<AutopilotPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "plan" | "apply">(null);
  const [applied, setApplied] = useState(false);
  const ac = useRef<AbortController | null>(null);
  const [ended, setEnded] = useState<null | "timeout" | "stopped">(null);
  useEffect(() => () => ac.current?.abort("unmount"), []);
  const stop = () => { const c = ac.current; if (!c) return; c.abort("stopped"); setEnded("stopped"); setBusy(null); setStatus(null); };
  const say = (code: string, m: string) => setErr(errCopy(code, m));
  const run = async () => {
    ac.current?.abort(); const c = new AbortController(); ac.current = c;
    setBusy("plan"); setErr(null); setEnded(null); setPlan(null); setCands([]); setApplied(false); setStatus("Starting…");
    const body: AutopilotPlanReq = { goal, lookbackDays: days };
    let got = false, frames = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const timeout = () => { if (c.signal.aborted) return; c.abort("timeout"); if (ac.current === c) setEnded("timeout"); };
    const bump = () => { clearTimeout(idle); idle = setTimeout(timeout, IDLE_MS); };
    const cap = setTimeout(timeout, MAX_MS); bump();
    try {
      await api.autopilotPlanStream(body, (f) => {
        frames++; bump();
        if (f.event === "status") setStatus(f.data.message);
        else if (f.event === "candidate") setCands((x) => [...x, f.data]);
        else if (f.event === "plan") { got = true; setPlan(f.data); }
        else { got = true; say(f.data.code, f.data.message); }
      }, c.signal);
      if (!got && !c.signal.aborted) throw new Error("stream ended early");
    } catch (x) {
      if (c.signal.aborted) return;
      clearTimeout(idle); clearTimeout(cap);
      if (x instanceof ApiErr) say(x.code, x.message); // pre-stream 404/422/429 — no point retrying
      else if (!frames || !got) { // network/stream failure → one-shot fallback
        try { setStatus("Reconnecting…"); const p = await api.autopilotPlan(body); setPlan(p); setCands(p.ranked.concat(p.excluded)); }
        catch (y) { say(y instanceof ApiErr ? y.code : "internal", y instanceof ApiErr ? y.message : "Couldn’t build a plan."); }
      }
    } finally { clearTimeout(idle); clearTimeout(cap); if (ac.current === c) { setBusy(null); setStatus(null); } }
  };
  const apply = async () => {
    if (!plan?.proposal) return; setBusy("apply"); setErr(null);
    try { const a = await api.putAutopilot({ ...plan.proposal, enabled: false, mode: "paper" }); setApplied(true); onApplied(a); }
    catch (x) { say(x instanceof ApiErr ? x.code : "internal", x instanceof ApiErr ? x.message : "Couldn’t save."); }
    finally { setBusy(null); }
  };
  const p = plan?.proposal;
  const nm = (id: string) => names[id] ?? plan?.ranked.find((c) => c.strategyId === id)?.name ?? id;
  const diff: [string, string, string][] = p ? ([
    ["Strategies", cur.strategyIds.map(nm).join(", ") || "None", p.strategyIds.map(nm).join(", ")],
    ["Rotate every", `${cur.rotateEveryMin} min`, `${p.rotateEveryMin} min`],
    ["Max drawdown", `${cur.guardrails.maxDrawdownPct}%`, `${p.guardrails.maxDrawdownPct}%`],
    ["Max daily loss", `$${fmtNum(String(cur.guardrails.maxDailyLossUsd), 0)}`, `$${fmtNum(String(p.guardrails.maxDailyLossUsd), 0)}`],
    ["Rotations per day", String(cur.guardrails.maxRotationsPerDay), String(p.guardrails.maxRotationsPerDay)],
    ["Approval", cur.approvalMode === "auto" ? "Automatic" : "Confirm each", p.approvalMode === "auto" ? "Automatic" : "Confirm each"],
  ] as [string, string, string][]) : [];
  return (
    <Card className="mt-4 p-5" data-testid="ap-plan">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-medium">Plan with AI</h2><p className="mt-1 text-[13px] text-muted">Backtests your strategies on recent data and proposes settings. Nothing changes until you apply it.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Goal" className="flex rounded-full border border-line-2 p-0.5">{GOALS.map(([g, l]) => <button key={g} role="radio" aria-checked={goal === g} onClick={() => setGoal(g)} className={`btn rounded-full px-3 py-1 text-[12.5px] ${goal === g ? "bg-white/10 text-ink" : "text-muted"}`}>{l}</button>)}</div>
          <div role="radiogroup" aria-label="Lookback" className="flex rounded-full border border-line-2 p-0.5">{([7, 30] as const).map((d) => <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`btn rounded-full px-3 py-1 text-[12.5px] tabular-nums ${days === d ? "bg-white/10 text-ink" : "text-muted"}`}>{d}d</button>)}</div>
          <button onClick={run} disabled={busy != null} className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-50" data-testid="ap-plan-go">{busy === "plan" ? "Planning…" : plan ? "Plan again" : "Plan"}</button>
          {busy === "plan" && <button onClick={stop} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] text-ink-2 hover:bg-white/5" data-testid="ap-plan-stop">Stop</button>}
        </div>
      </div>
      {status && <p role="status" className="mt-3 text-[13px] text-muted" data-testid="ap-plan-status">{status}</p>}
      {cands.length > 0 && <ul className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="ap-plan-cands">{cands.map((c) => (
        <li key={c.strategyId} data-motion="rise" className={`rounded-[10px] border p-3 text-[13px] ${c.ok ? "border-line-2" : "border-line opacity-70"}`} data-testid="ap-plan-cand">
          <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{c.name}</span>{c.score != null ? <span className="font-mono tabular-nums text-accent">{c.score.toFixed(2)}</span> : <span className="text-[12px] text-muted">{c.error ? "Error" : "Skipped"}</span>}</div>
          {c.metrics ? <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[12px] tabular-nums text-muted"><span className={Number(c.metrics.returnPct) >= 0 ? "text-long" : "text-short"}>{pct(c.metrics.returnPct)}</span><span>DD {fmtNum(c.metrics.maxDrawdownPct, 1)}%</span><span>{c.metrics.trades} trades</span>{c.metrics.sharpe && <span>Sharpe {c.metrics.sharpe}</span>}</div>
            : <div className="mt-1 text-[12px] text-muted">{c.error ?? "No result"}</div>}
        </li>))}</ul>}
      {plan && <div className="mt-5" data-testid="ap-plan-result">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">{plan.synthetic && <Pill tone="warn">Synthetic</Pill>}<span>{plan.notice}</span></div>
        <ul className="mt-2 list-disc pl-5 text-[13px] text-ink-2">{plan.rationale.map((r) => <li key={r}>{r}</li>)}</ul>
        {p ? <>
          <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Proposed settings compared with now"><table className="w-full text-left text-[13px]" data-testid="ap-plan-diff"><thead className="text-[12px] text-muted"><tr><th className="py-1.5 pr-3 font-normal">Setting</th><th className="py-1.5 pr-3 font-normal">Now</th><th className="py-1.5 font-normal">Proposed</th></tr></thead>
            <tbody>{diff.map(([k, a, b]) => <tr key={k} className="border-t border-line" data-changed={a !== b || undefined}><td className="py-2 pr-3 text-muted">{k}</td><td className="py-2 pr-3 tabular-nums">{a}</td><td className={`py-2 tabular-nums ${a !== b ? "text-accent" : "text-ink-2"}`}>{b}</td></tr>)}</tbody></table></div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={apply} disabled={busy != null || applied} className="btn rounded-full border border-accent/60 px-4 py-2 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50" data-testid="ap-plan-apply">{applied ? "Applied" : busy === "apply" ? "Applying…" : "Apply these settings"}</button>
            <span className="text-[12.5px] text-muted">{applied ? "Saved with Autopilot off. Turn it on below when you’re ready." : "Applies with Autopilot off. You turn it on yourself."}</span>
          </div></> : <p className="mt-3 text-[13px] text-muted">No proposal: none of your strategies qualified. Try a longer lookback or a different goal.</p>}
      </div>}
      {ended && <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-line-2 p-3 text-[13px]" data-testid={`ap-plan-${ended}`}>
        <span className="text-ink-2">{ended === "timeout" ? "Planning is taking longer than usual, so we stopped waiting. Nothing was changed." : "Stopped. Nothing was changed."}</span>
        <button onClick={run} className="btn rounded-full border border-accent/60 px-3 py-1 text-[12.5px] text-accent hover:bg-accent/10" data-testid="ap-plan-retry">{ended === "timeout" ? "Try again" : "Plan again"}</button>
      </div>}
      {err && <p role="alert" className="mt-3 text-[13px] text-short" data-testid="ap-plan-err">{err}</p>}
    </Card>
  );
}
