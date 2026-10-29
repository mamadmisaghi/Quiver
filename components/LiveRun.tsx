"use client";
// Paper-run live view, driven by api.streamRun (live: SSE with Last-Event-ID resume; mock: fixture replay).
// Contract rules (HANDOFF-wren): null/stale = waiting; paper fills say "simulated"; live fills link to Blockscout;
// retryable error → toast + short-colour flash; risk_halt → persistent banner + Resume; heartbeat gap > 45 s → Offline.
import SessionKeyTerms, { termsFromDefaults, type SkCaps, type SkTerms, type SkFieldErr } from "./SessionKeyTerms";
import TriggerStates, { type TrigTick } from "./TriggerStates";
import ApprovalPrompt, { type Pending } from "./ApprovalPrompt";
import Link from "@/components/Link";
import dynamic from "next/dynamic";
// perf: conditional / below-the-fold panels load as separate chunks so they don't block hydration of the run header.
const RunResultCard = dynamic(() => import("./RunResultCard"));
const SigningSteps = dynamic(() => import("./SigningSteps"));
const ClosePosition = dynamic(() => import("./ClosePosition"));
const WriteOff = dynamic(() => import("./WriteOff"));
const InstructPanel = dynamic(() => import("./InstructPanel"));
import SignInButton from "./SignInButton";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import StrategyGraph from "./StrategyGraph";
import VenueMark from "./VenueMark";
import { Card, Details, Pill } from "./ui";
import { api, ApiErr, isValidation, fmtNum, fmtSignal, fmtTime, fmtUsd, fmtPct, fmtSource, fmtDur, localTz, errCopy, tone, strategyEdges, demoNodes, demoStrategy,
  EVENT_LABEL, RUN_STATUS, HALT_RULE, DEMO_LABEL, type GNode, type Run, type RunEvent, type NodeState, type StrategyRecord, type SessionKeyDefaults, type PrepareSessionKeyRes, type SessionKey, type Positions, errOf } from "@/lib/api";

type Sig = Extract<RunEvent, { type: "tick" }>["signals"][number];
type Fill = Extract<RunEvent, { type: "fill" }>;
type Halt = Extract<RunEvent, { type: "risk_halt" }>;
const SIDE: Record<string, string> = { buy: "Buy", sell: "Sell", long: "Long", short: "Short" };

const ROW_H = 58; // 2 lines of 12.5px + padding
const APV_NOTE: Record<string, string> = { approved: "Approved. Placing the order…", rejected: "Rejected. No order was placed.", expired: "An approval expired. No order was placed.", canceled: "An approval was canceled." };
const FIELD_ERR: Record<string, "caps" | "slip" | "expiry"> = { session_key_cap_ratio: "caps", session_key_slippage_above_cap: "slip", session_key_expiry_too_long: "expiry" };
export default function LiveRun({ runId: requested }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [rec, setRec] = useState<StrategyRecord | null>(null);
  const [stratWarn, setStratWarn] = useState<string | null>(null); // M4.9 strategy_updated
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [signals, setSignals] = useState<Record<string, Sig>>({});
  const [met, setMet] = useState<{ path: string[]; holdUntil: string; forMinutes: number } | null>(null);
  const [fired, setFired] = useState<string[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [pos, setPos] = useState<Positions | null>(null); // M4.6: server-marked open positions
  const [trig, setTrig] = useState<Record<string, TrigTick>>({}); // M4.6 trigger wait states from ticks
  const [posTick, setPosTick] = useState(0); // bump to refetch (fill / close)
  const [closing, setClosing] = useState<string | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]); // M4.2 confirm_each
  const [apvNote, setApvNote] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [halt, setHalt] = useState<Halt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "live" | "stop">(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [needAuth, setNeedAuth] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [skey, setSkey] = useState<SkTerms | null>(null); // active key's policy, else API defaults
  const [skDefaults, setSkDefaults] = useState<SessionKeyDefaults | null>(null); // QA P2: Stop pressed → badges clear at once
  const ended = useRef(false); // Stop pressed: only the status frame still gets through
  const terminal = useRef(false); // "stopped" received: drop every later frame
  const [attempt, setAttempt] = useState(0);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(0);
  const last = useRef(0);
  // Render-visible mirror of the stream clock (refs stay for handler-only bookkeeping; react-hooks/refs).
  const [meta, setMeta] = useState<{ last: number; clock: number; ticks: number[] }>({ last: 0, clock: 0, ticks: [] });
  const ticks = useRef<number[]>([]); // last two tick timestamps → cadence
  const intents = useRef<Record<string, string>>({}); // orderId → actionId
  const clock = useRef<number>(0); // run clock: latest event ts
  const runId = run?.id;
  const stratId = run?.strategyId;
  const refreshRec = useCallback(() => { if (stratId) api.strategy(stratId).then(setRec, () => {}); }, [stratId]); // M4.9: new version after instruct
  const refreshRef = useRef(refreshRec); useEffect(() => { refreshRef.current = refreshRec; }, [refreshRec]);
  const [streamIssue, setStreamIssue] = useState<string | null>(null); // M3.5: e.g. 429 streams cap

  useEffect(() => {
    let on = true;
    api.resolveRun(requested).then(async (r) => { if (!on) return; setRun(r); if (r.triggerStates?.length) setTrig((t) => ({ ...Object.fromEntries(r.triggerStates.map((x) => [x.triggerId, x])), ...t })); /* M4.7 seed */ const s = await api.strategy(r.strategyId).catch(() => null); if (on) setRec(s); })
      .catch((x) => { if (!on) return; if (x instanceof ApiErr && (x.code === "not_found" || x.status === 404 || x.code === "validation_failed")) setMissing(true); else { setNeedAuth(x instanceof ApiErr && x.code === "unauthorized"); setFatal(x instanceof ApiErr ? errCopy(x.code, x.message) : "Couldn't load this paper run."); } });
    return () => { on = false; };
  }, [requested, attempt]);
  function applyFill(e: Fill) { setFills((f) => [...f.filter((x) => x.actionId !== e.actionId), e]); }
  useEffect(() => {
    if (!runId) return;
    ended.current = false; terminal.current = false;
    return api.streamRun(runId, (e) => {
      // M3.6: "stopped" is terminal and always the last event. After the user presses Stop only the status frame
      // gets through; once stopped arrives, every later frame (late ticks, duplicates on reconnect) is dropped.
      if (terminal.current) return;
      if (ended.current && e.type !== "status") return;
      if (e.type === "status" && e.status === "stopped") { ended.current = true; terminal.current = true; }
      last.current = Date.now(); const ts0 = "ts" in e ? new Date(e.ts).getTime() : 0;
      setMeta((m) => ({ last: last.current, clock: e.type === "resync" ? m.clock : ts0, ticks: e.type === "tick" ? [...m.ticks.slice(-1), ts0] : m.ticks }));
      if (e.type === "resync") return;
      clock.current = new Date(e.ts).getTime();
      if (e.type === "heartbeat") return;
      if (e.type === "triggers_snapshot") { setTrig(Object.fromEntries(e.triggers.map((x) => [x.triggerId, x]))); return; } // M4.7: full state on connect/resume, not a log row
      setEvents((es) => (es.some((x) => x.seq === e.seq && x.type === e.type) ? es : [e, ...es].slice(0, 40)));
      if (e.type === "tick") { ticks.current = [...ticks.current.slice(-1), clock.current]; setSignals((s) => ({ ...s, ...Object.fromEntries(e.signals.map((x) => [x.signalId, x])) })); if (e.triggers.length) setTrig((t) => ({ ...t, ...Object.fromEntries(e.triggers.map((x) => [x.triggerId, x])) })); }
      if (e.type === "intent") intents.current[e.orderId] = e.actionId;
      if (e.type === "trigger_met") setMet({ path: e.path, holdUntil: e.holdUntil ?? e.ts, forMinutes: e.forMinutes });
      if (e.type === "trigger_fired") { setFired(e.actionIds); setMet(null); }
      if (e.type === "fill") { applyFill(e); setPosTick((t) => t + 1); }
      if (e.type === "approval_requested") setPending((p) => (p.some((x) => x.id === e.approvalId) ? p : [...p, { id: e.approvalId, actionId: e.actionId, instrument: e.instrument, venue: e.venue, side: e.side, notionalUsd: e.notionalUsd, expiresAt: e.expiresAt, strategyName: e.strategyName, actionTitle: e.actionTitle }])); // M4.7 names on the event
      if (e.type === "approval_resolved") setPending((p) => { if (p.some((x) => x.id === e.approvalId)) setApvNote(APV_NOTE[e.decision]); return p.filter((x) => x.id !== e.approvalId); });
      if (e.type === "error") { const act = e.orderId ? intents.current[e.orderId] : undefined; if (act) setFlash(act); setTimeout(() => setFlash(null), 1600); if (e.retryable) { setToast(e.message); setTimeout(() => setToast(null), 5000); } }
      if (e.type === "risk_halt") { setHalt(e); setRun((r) => (r ? { ...r, status: "halted" } : r)); }
      if (e.type === "status") setRun((r) => (r ? { ...r, status: e.status } : r));
      if (e.type === "warning" && e.code === "strategy_updated") { setStratWarn(e.message); refreshRef.current(); } // M4.9
    }, setStreamIssue);
  }, [runId]);
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  useEffect(() => { // fills that happened before the stream attached (stream starts at the tail)
    if (!runId) return; let on = true;
    api.runEvents(runId).then((es) => { if (on) for (const e of es) if (e.type === "fill") applyFill(e); }).catch(() => {});
    return () => { on = false; };
  }, [runId]);
  useEffect(() => { // M4.6 positions: on load, after each fill/close, and every 15s for fresh marks
    if (!runId) return; let on = true;
    const load = () => api.runPositions(runId).then((r) => { if (on) setPos(r); }).catch(() => {});
    load(); const iv = setInterval(load, 15_000);
    return () => { on = false; clearInterval(iv); };
  }, [runId, posTick]);
  useEffect(() => { // M4.2: approvals that were already waiting before this page opened
    if (!runId || run?.approvalMode !== "confirm_each") return; let on = true;
    api.approvals({ runId, status: "pending" }).then((l) => on && setPending((p) => [...p, ...l.items.filter((a) => !p.some((x) => x.id === a.id))])).catch(() => {});
    return () => { on = false; };
  }, [runId, run?.approvalMode]);
  const offline = now > 0 && meta.last > 0 && now - meta.last > 45_000;

  const control = async (a: "pause" | "resume" | "stop") => {
    if (!runId) return;
    if (a === "stop") { ended.current = true; setStopping(true); setMet(null); }
    try { const r = await api.control(runId, a); setRun(r); if (a === "resume") setHalt(null); }
    catch (x) { if (a === "stop") { ended.current = false; setStopping(false); } setNotice(errOf(x, "That didn't work. Try again.")); }
    setConfirm(null);
  };
  useEffect(() => {
    if (confirm !== "live") return; let on = true;
    // M3.6.1: an active key's policy wins; otherwise prefill from GET /session-keys/defaults (local fallback if it fails).
    api.sessionKeyDefaults().then((d) => { if (on) { setSkDefaults(d); setSkey((k) => k ?? termsFromDefaults(d)); } }).catch(() => {});
    api.sessionKeys().then((p) => { const k = p.items.find((x) => x.status === "active"); if (on && k) setSkey({ perTxCapUsd: k.policy.perTxCapUsd, windowCapUsd: k.policy.dailyCapUsd, maxSlippagePct: k.policy.maxSlippagePct, active: true }); }).catch(() => {});
    return () => { on = false; };
  }, [confirm]);
  // M3.9: Go live sends caps, slippage and expiresInHours to POST /session-keys/prepare, then SigningSteps walks the
  // owner through sign → install → submit, one click each. Field 422s (cap ratio, slippage, expiry) show inline.
  const [caps, setCaps] = useState<SkCaps>(null);
  const [prepared, setPrepared] = useState<PrepareSessionKeyRes | null>(null);
  const [fieldErr, setFieldErr] = useState<(SkFieldErr & { key: string }) | null>(null); // shown until the inputs change
  const [skUnavailable, setSkUnavailable] = useState(false);
  const onCaps = useCallback((c: SkCaps) => setCaps(c), []);
  const capsKey = caps ? JSON.stringify(caps) : "";
  const onActive = useCallback((k: SessionKey) => setSkey({ perTxCapUsd: k.policy.perTxCapUsd, windowCapUsd: k.policy.dailyCapUsd, maxSlippagePct: k.policy.maxSlippagePct, active: true }), []);
  const [busy, setBusy] = useState(false);
  const rhTokens = useMemo(() => [...new Set((rec?.strategy.actions ?? []).map((a) => a.instrument).filter((i) => i.startsWith("robinhood:token:")))], [rec]);
  const goLive = async () => {
    if (skey?.active) {
      try { await api.startRun({ strategyId: run!.strategyId, mode: "live" }); setConfirm(null); }
      catch (x) { setNotice(x instanceof ApiErr && x.code === "mode_not_enabled" ? "Paper only for now — live trading isn’t enabled yet." : "Couldn’t start live trading."); setConfirm(null); }
      return;
    }
    if (!caps) return;
    if (!rhTokens.length) { setNotice("This strategy doesn’t trade Robinhood Chain tokens, so there’s no session key to set up."); setConfirm(null); return; }
    setBusy(true); setFieldErr(null);
    try {
      const r = await api.prepareSessionKey({ chainId: 46630, perTxCapUsd: caps.perTxCapUsd, dailyCapUsd: caps.dailyCapUsd, maxSlippagePct: caps.maxSlippagePct, expiresInHours: caps.expiresInHours, tokens: rhTokens });
      setPrepared(r);
    } catch (x) {
      if (x instanceof ApiErr && FIELD_ERR[x.code]) { setFieldErr({ field: FIELD_ERR[x.code], message: x.message, key: JSON.stringify(caps) }); return; }
      if (x instanceof ApiErr && x.code === "signing_unavailable") { setSkUnavailable(true); return; }
      setNotice(x instanceof ApiErr && x.code === "mode_not_enabled" ? `Paper only for now — ${x.message}` : x instanceof ApiErr && isValidation(x) ? errOf(x, "Couldn’t prepare the session key.") : "Couldn’t prepare the session key.");
      setConfirm(null);
    } finally { setBusy(false); }
  };

  const open = useMemo(() => (pos?.items ?? []).filter((p) => Number(p.qty) !== 0), [pos]);
  const lastFill = (inst: string) => fills.filter((f) => f.instrument === inst).sort((a, b) => b.seq - a.seq)[0];
  const baseNodes: GNode[] = useMemo(() => (rec?.nodes.length ? rec.nodes : rec ? [] : demoNodes) as GNode[], [rec]);
  const title = (id: string) => baseNodes.find((n) => n.id === id)?.title ?? "an action";
  const nodes: GNode[] = useMemo(() => baseNodes.map((n) => {
    let state: NodeState = "idle"; let value: string | undefined;
    const s = signals[n.id];
    if (n.kind === "watch") { value = fmtSignal(n.id, s?.value ?? null, s?.stale); if (met?.path.includes(n.id)) state = "met"; if (!s || s.value == null || s.stale) state = "waiting"; }
    if (n.kind === "when") state = met ? "holding" : fired.length ? "fired" : "idle";
    if (n.kind === "do") state = flash === n.id ? "error" : fired.includes(n.id) ? "active" : "idle";
    if (n.kind === "exit" && fills.some((f) => `${f.actionId}.exit` === n.id)) state = "active";
    return { ...n, state, value };
  }), [baseNodes, signals, met, fired, flash, fills]);
  const edges = useMemo(() => strategyEdges(rec?.strategy ?? demoStrategy).map((e) => ({
    ...e, hot: (met ? met.path.includes(e.from) && met.path.includes(e.to) : false) || (fired.includes(e.to)) || fills.some((f) => f.actionId === e.from),
  })), [rec, met, fired, fills]);

  function describe(e: RunEvent): string {
    switch (e.type) {
      case "status": return RUN_STATUS[e.status] + (e.reason ? ` · ${e.reason}` : "");
      case "tick": return e.signals.length ? `Read ${e.signals.length} new ${e.signals.length === 1 ? "value" : "values"}` : "No changes";
      case "trigger_met": return e.forMinutes > 0 ? `Conditions met, holding ${e.forMinutes} min` : "Conditions met";
      case "trigger_fired": return `Trigger fired → ${e.actionIds.map(title).join(", ")}`;
      case "intent": return `${SIDE[e.side]} ${fmtUsd(e.notionalUsd)} · ${title(e.actionId)} · max slippage ${(e.maxSlippageBps / 100).toFixed(1)}%`;
      case "fill": return `${SIDE[e.side]} ${fmtNum(e.qty, 4)} @ ${fmtUsd(e.price)} · fee ${fmtUsd(e.feeUsd)} · ${e.simulated ? "simulated" : "on-chain"}`;
      case "rejected": return errCopy(e.code, e.message);
      case "error": return e.message;
      case "risk_halt": return e.message;
      case "approval_requested": return `${e.actionTitle ?? `${SIDE[e.side]} ~${fmtUsd(e.notionalUsd)} · ${title(e.actionId)}`} · waiting for you`;
      case "approval_resolved": return APV_NOTE[e.decision];
      default: return EVENT_LABEL[(e as { type: string }).type] ?? "Update";
    }
  }

  const holdLeft = met ? Math.max(0, Math.round((new Date(met.holdUntil).getTime() - (meta.clock || 0)) / 1000)) : 0;
  const [t0, t1] = meta.ticks.length === 2 ? meta.ticks : [0, 0];
  const cadence = t1 && t0 ? (t1 - t0) / 1000 : 0;
  const nextIn = cadence && meta.last ? Math.max(0, cadence - (now - meta.last) / 1000) : null;
  const status = stopping || run?.status === "stopped" ? "stopped" : offline ? "offline" : run?.status ?? "starting";
  const statusText = status === "offline" ? "Offline — no heartbeat for 45 s" : RUN_STATUS[status] ?? "Starting";
  const watching = run?.status === "stopped" || stopping ? "Stopped" : met ? `Conditions met, holding ${fmtDur(holdLeft)}` : fired.length ? "Trigger fired · exits armed" : "Watching";
  const done = run?.status === "stopped" || stopping;

  if (missing) return (
    <div className="mx-auto max-w-[1240px] px-5 py-10 sm:px-8"><Card className="p-6">
      <h1 className="text-[20px] font-medium tracking-[-0.02em]">Run not found</h1>
      <p className="mt-2 text-[14px] text-muted">There’s no paper run with this link. It may have been removed, or it belongs to another account.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/app/strategies" className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-white/30">Your strategies</Link>
        <Link href="/app/run/demo" className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:brightness-110">Open the demo run</Link>
      </div>
    </Card></div>);
  if (fatal) return <div className="mx-auto max-w-[1240px] px-5 py-10 sm:px-8"><Card className="flex flex-col items-start gap-4 p-6 text-[14px] text-muted"><p role="alert">{fatal}</p>{needAuth ? <SignInButton onDone={() => { setFatal(null); setAttempt((n) => n + 1); }} /> : <button type="button" onClick={() => { setFatal(null); setAttempt((n) => n + 1); }} className="btn rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:border-white/30">Try again</button>}</Card></div>;
  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 sm:px-8 sm:py-10">
      {halt && (
        <div role="alert" className="mb-6 flex flex-col gap-3 rounded-[14px] border border-short/40 bg-short/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="text-[14px] font-medium text-short">Paused by a risk limit · {HALT_RULE[halt.rule] ?? "Risk limit"}</div><p className="mt-1 text-[13.5px] text-ink-2">{halt.message}</p></div>
          <button onClick={() => control("resume")} className="btn shrink-0 rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-white/30">Resume</button>
        </div>
      )}
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span data-motion={status === "running" ? "pulse-dot" : undefined} className={`relative h-2 w-2 shrink-0 rounded-full ${status === "running" ? "bg-long" : status === "halted" || status === "offline" ? "bg-short" : "bg-muted"}`} />
            <h1 className="text-[clamp(1.6rem,2.6vw,2.1rem)] font-medium tracking-[-0.03em]">{rec?.name ?? "Paper run"}</h1>
            <Pill tone="paper">Paper</Pill>
          </div>
          {/* F1 (CLS): on phones the line wraps to 2 rows once "started …" arrives; reserve both rows. perf (LCP): status + start time fill in after the run loads; as separate flex items they never grow the
              server-rendered line into a new, later LCP candidate. */}
          <p className="mt-1.5 flex flex-wrap gap-x-[.3em] text-[13.5px] text-muted max-sm:min-h-[2lh]">
            <span className={status === "offline" ? "text-short" : ""}>{statusText}</span>
            {run && <span>· started {fmtTime(run.startedAt)} {localTz()}</span>}<span>· {DEMO_LABEL}</span>
          </p>
          {streamIssue && !done && <p role="status" className="mt-3 rounded-[10px] border border-short/40 px-3 py-2 text-[13px] text-ink-2">{streamIssue}</p>}
          <Details items={[["Run", run?.id ?? "—"], ["Strategy", run?.strategyId ?? "—"], ["Last event", events[0] ? `#${events[0].seq}` : "—"]]} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice && <span className="mr-1 max-w-[280px] text-[13px] text-muted" role="status">{notice}</span>}
          <button autoFocus onClick={() => control(run?.status === "paused" ? "resume" : "pause")} disabled={!run || done} className="btn rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:bg-white disabled:opacity-40">{run?.status === "paused" ? "Resume" : "Pause"}</button>
          <button onClick={() => setConfirm("stop")} disabled={!run || done} className="btn rounded-full border border-short/40 px-4 py-2 text-[13px] text-short hover:bg-short/10 disabled:opacity-40">Stop</button>
          {run && <Link href={`/app/run/${run.id}/replay`} data-testid="replay-link" className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] text-ink-2 hover:border-white/30 hover:bg-white/5">Replay</Link>}
          <button onClick={() => setConfirm("live")} disabled={!run} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] text-ink-2 hover:border-white/30 hover:bg-white/5 disabled:opacity-40">Go live…</button>
        </div>
      </div>

      {confirm === "stop" && (
        <Card className="mt-5 flex flex-col gap-3 border-short/30 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13.5px] text-ink-2">Stop this paper run? Signals stop updating and no new orders are placed. Open paper positions stay as they are.</p>
          <div className="flex shrink-0 gap-2"><button onClick={() => setConfirm(null)} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5">Cancel</button><button onClick={() => control("stop")} className="btn rounded-full bg-short px-4 py-2 text-[13px] font-medium text-bg">Stop run</button></div>
        </Card>)}
      {confirm === "live" && (
        <Card className="mt-5 p-6" >
          <div role="dialog" aria-label="Go live">
            <div className="text-[15px] font-medium">Before this trades real money</div>
            <ul className="mt-4 grid gap-3 text-[13.5px] text-ink-2 md:grid-cols-3">
              <li className="rounded-[12px] border border-line p-4"><div className="text-[12.5px] text-muted">Wallet</div>Connect a wallet on each venue this strategy trades{rec ? `: ${rec.venues.filter((v) => v !== "polymarket").length} venue(s)` : ""}.</li>
              <li className="rounded-[12px] border border-line p-4"><div className="text-[12.5px] text-muted">Session key scope</div><SessionKeyTerms terms={skey} defaults={skDefaults} onCaps={onCaps} serverErr={fieldErr && fieldErr.key === capsKey ? fieldErr : null} locked={!!prepared} />
                <p className="mt-2 font-mono text-[12px] text-muted">Robinhood Chain testnet 46630</p>
                {skUnavailable && <div className="mt-3 rounded-[10px] border border-line-2 p-3 text-[12.5px]" role="status" data-testid="sk-unavailable"><div className="text-ink-2">Signing isn’t available yet</div><div className="mt-1 text-muted">This server can’t set up session keys yet. Nothing was signed and no funds moved.</div></div>}
                {prepared && !skey?.active && <SigningSteps prep={prepared} onActive={onActive} />}</li>
              <li className="rounded-[12px] border border-line p-4"><div className="text-[12.5px] text-muted">Risk limits</div>{rec ? `Max position ${rec.strategy.risk.maxPositionPct}% · daily loss halt ${rec.strategy.risk.maxDailyLossPct}% · ${rec.strategy.risk.maxOrdersPerDay} orders/day.` : "Your strategy's limits apply."}</li>
            </ul>
            <p className="mt-4 text-[13.5px] text-warn">Live trading uses real funds and can lose money. Paper results don&apos;t predict live results.</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button autoFocus onClick={() => setConfirm(null)} className="btn rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:bg-white">Keep paper trading</button>
              <button onClick={goLive} disabled={busy || skUnavailable || (!skey?.active && (!caps || !!prepared))} className="btn disabled:cursor-not-allowed disabled:opacity-50 rounded-full border border-line-2 px-4 py-2 text-[13px] text-ink-2 hover:bg-white/5">{skey?.active ? "Start live run" : busy ? "Preparing…" : "Prepare session key"}</button>
              <span className="ml-1 text-[12.5px] text-muted">Live and testnet are paper only during the beta.</span>
            </div>
          </div>
        </Card>)}

      {runId && (pending.length > 0 || apvNote) && (
        <section aria-label="Approvals" className="mt-5 grid gap-2">
          {pending.map((a) => <ApprovalPrompt key={a.id} item={a} runId={run?.id} title={title(a.actionId)} onResolved={(id, note) => { setPending((p) => p.filter((x) => x.id !== id)); setApvNote(note); }} />)}
          {apvNote && pending.length === 0 && <p role="status" className="flex items-center gap-3 text-[13px] text-muted" data-testid="approval-note">{apvNote}<Link href="/app/approvals" className="underline">All approvals</Link><button onClick={() => setApvNote(null)} className="ml-auto text-[12.5px] underline">Dismiss</button></p>}
        </section>)}
      {done && runId && run?.status === "stopped" && <RunResultCard runId={runId} />}
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line md:grid-cols-5">
        {([["Paper equity", fmtUsd(run?.equityUsd), ""], ["PnL", fmtUsd(run?.pnlUsd, { sign: true }), tone(run?.pnlUsd)], ["PnL %", fmtPct(run?.pnlPct, { sign: true }), tone(run?.pnlPct)],
          ["Fills", String(fills.length), ""], ["Next check in", done ? "—" : nextIn == null ? "…" : fmtDur(nextIn), ""]] as const).map(([k, v, c]) => (
          <div key={k} className="bg-bg-2 px-5 py-4">
            <div className="text-[12px] text-muted">{k}</div>
            <div key={k === "Next check in" ? k : v} data-motion="tick" className={`tnum mt-1 rounded font-mono text-[17px] ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      <Card className="mt-5 bg-bg-2 p-5 sm:p-6">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink-2">Live graph</span>
          <span className="min-w-0 truncate pl-3 text-[12.5px] text-muted">{watching}</span>
        </div>
        {baseNodes.length ? <StrategyGraph nodes={nodes} edges={edges} /> : <div className="h-[280px]" />}
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_440px]">
        <Card className="overflow-x-auto bg-bg-2" tabIndex={0} role="region" aria-label="Signals table">
          <div className="border-b border-line px-5 py-4 text-[14px] font-medium">Signals</div>
          <table className="rtable w-full min-w-[520px] text-left text-[13.5px]">
            <thead className="text-[12px] text-muted"><tr className="border-b border-line">{["Signal", "Value", "Source"].map((h) => <th key={h} className="px-5 py-3 font-normal">{h}</th>)}</tr></thead>
            <tbody className="tnum">
              {baseNodes.filter((n) => n.kind === "watch").map((n) => { const s = signals[n.id]; const closed = !!s && s.staleReason === "market_closed" && s.value != null; const waiting = !s || s.value == null || (s.stale && !closed); return (
                <tr key={n.id} className="border-b border-line last:border-0">
                  <td data-label="Signal" className="px-5 py-3"><span className="flex items-center gap-2.5">{n.venue && <VenueMark venue={n.venue} />}<span>{n.title}</span></span></td>
                  <td data-label="Value" className={`px-5 font-mono ${waiting ? "text-muted" : "text-cream"}`}><span key={String(s?.value)} data-motion="tick">{closed ? <>{fmtSignal(n.id, s!.value, false)} <span className="ml-1 font-sans text-[12px] text-muted">Market closed</span></> : fmtSignal(n.id, s?.value ?? null, s?.stale)}</span></td>
                  <td data-label="Source" className="px-5 text-muted">{s ? fmtSource(s.source, s.observedAt, meta.clock || now) : "Waiting"}</td>
                </tr>); })}
            </tbody>
          </table>
        </Card>
        <Card className="flex h-[440px] flex-col bg-bg-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <span className="text-[14px] font-medium">Activity</span>
            <span className="text-[12px] text-muted">{done ? "Stopped" : streamIssue ? <span className="text-short">Limit reached</span> : events[0] ? "Live" : "Connecting…"}</span>
          </div>
          <div className="flex-1 overflow-y-auto" tabIndex={0} role="region" aria-label="Event log">
          {/* fixed-height rows placed by transform: new events slide existing rows without a layout shift */}
          <ol className="relative text-[12.5px]" style={{ height: events.length * ROW_H }} aria-live="polite" data-motion="run-feed">
            {events.map((e, i) => (
              <li key={`${e.seq}-${e.type}`} style={{ height: ROW_H, transform: `translateY(${i * ROW_H}px)` }} className="absolute inset-x-0 top-0 overflow-hidden border-b border-line">
                <div data-motion="rise" className="grid h-full grid-cols-[4.2rem_7.4rem_1fr] gap-2 px-5 py-2.5">
                <span className="tnum font-mono text-muted">{fmtTime(e.ts)}</span>
                <span className={e.type === "fill" ? "text-paper" : e.type === "error" || e.type === "risk_halt" || e.type === "rejected" ? "text-short" : e.type.startsWith("trigger") ? "text-ink" : "text-muted"}>{EVENT_LABEL[e.type] ?? "Update"}</span>
                <span className="line-clamp-2 text-ink-2" title={describe(e)}>{describe(e)}{e.type === "fill" && e.explorerUrl && <> · <a className="underline" href={e.explorerUrl} target="_blank" rel="noreferrer">Blockscout ↗</a></>}</span>
              </div>
              </li>
            ))}
          </ol>
          </div>
        </Card>
      </div>

      {rec && rec.strategy.triggers.length > 0 && <TriggerStates rec={rec} states={trig} now={now} />}
      {runId && run?.mode === "paper" && !done && <InstructPanel runId={runId} warning={stratWarn} onAsk={() => setStratWarn(null)} onApplied={() => refreshRec()} />}
      <Card className="mt-5 overflow-x-auto" tabIndex={0} role="region" aria-label="Positions and fills table">
        <table className="rtable w-full min-w-[800px] text-left text-[13.5px]">
          <thead className="text-[12px] text-muted">
            <tr className="border-b border-line">{["Position", "Side", "Qty", "Avg entry", "Mark", "Unrealized", "Fill", ""].map((h, i) => <th key={i} className="px-5 py-3 font-normal">{h || <span className="sr-only">Actions</span>}</th>)}</tr>
          </thead>
          <tbody className="tnum font-mono">
            {open.length === 0 && <tr><td colSpan={8} className="px-5 py-5 font-sans text-muted">{fills.length ? "No open positions." : "No fills yet. Positions appear when an action fills."}</td></tr>}
            {open.map((p) => { const f = lastFill(p.instrument); const label = f ? title(f.actionId) : p.symbol; return (
              <Fragment key={p.instrument}>
              <tr className="border-b border-line last:border-0" data-testid="run-position">
                <td data-label="Position" className="px-5 py-3.5 font-sans"><span className="flex items-center gap-2.5"><VenueMark venue={p.venue} />{label}</span></td>
                <td data-label="Side" className="px-5 font-sans">{p.side === "long" ? "Long" : "Short"}</td>
                <td data-label="Qty" className="px-5">{fmtNum(p.qty, 4)}</td>
                <td data-label="Avg entry" className="px-5">{fmtUsd(p.avgEntry)}</td>
                <td data-label="Mark" className="px-5">{p.markPrice == null ? <span className="font-sans text-muted" title="No fresh price from the venue yet">No mark</span> : fmtUsd(p.markPrice)}</td>
                <td data-label="Unrealized" className={`px-5 ${p.unrealizedPnlUsd == null ? "text-muted" : tone(p.unrealizedPnlUsd)}`}>{p.unrealizedPnlUsd == null ? "—" : fmtUsd(p.unrealizedPnlUsd, { sign: true })}</td>
                <td data-label="Fill" className="px-5 font-sans">{f?.simulated ? <span className="text-paper">Simulated</span> : f?.explorerUrl ? <a href={f.explorerUrl} className="underline" target="_blank" rel="noreferrer">Blockscout ↗</a> : "—"}</td>
                <td data-label="" className="px-5 text-right font-sans">{run?.mode === "paper" && !done && <button onClick={() => setClosing(closing === p.instrument ? null : p.instrument)} aria-expanded={closing === p.instrument} className="btn rounded-full border border-line-2 px-3 py-1 text-[12.5px] text-ink-2 hover:bg-white/5" data-testid="close-open">Close…</button>}
                  {run?.mode === "paper" && !done && <button onClick={() => { setClosing(null); setWriting(writing === p.instrument ? null : p.instrument); }} aria-expanded={writing === p.instrument} className="btn ml-1 rounded-full px-2 py-1 text-[12.5px] text-muted hover:text-ink" data-testid="wo-open">Write off…</button>}</td>
              </tr>
              {closing === p.instrument && runId && <tr className="border-b border-line"><td colSpan={8} className="px-5 py-3"><ClosePosition runId={runId} instrument={p.instrument} label={label} onCancel={() => setClosing(null)}
                onDone={() => setPosTick((t) => t + 1)} /></td></tr>}
              {writing === p.instrument && runId && <tr className="border-b border-line"><td colSpan={8} className="px-5 py-3"><WriteOff runId={runId} instrument={p.instrument} label={label} onCancel={() => setWriting(null)}
                onDone={() => setPosTick((t) => t + 1)} onUseClose={() => { setWriting(null); setClosing(p.instrument); }} /></td></tr>}
              </Fragment>
            ); })}
          </tbody>
        </table>
        {(run?.blockedFills ?? 0) > 0 && <p role="status" className="border-t border-line px-5 py-2.5 text-[12.5px] text-ink-2" data-testid="run-blocked-fills"><span className="tabular-nums">{run!.blockedFills}</span> {run!.blockedFills === 1 ? "fill" : "fills"} arrived after a timed-out stop and {run!.blockedFills === 1 ? "was" : "were"} refused — never applied to this paper run.</p>}
        {pos && <p className="border-t border-line px-5 py-2.5 text-[12px] text-muted" data-testid="positions-asof">Marked {new Date(pos.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · refreshes every 15s</p>}
      </Card>
      {toast && <div role="status" className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-4 right-4 z-50 sm:left-auto sm:right-6 lg:bottom-6 max-w-[360px] rounded-[12px] border border-short/40 bg-raised px-4 py-3 text-[13.5px] shadow-[var(--q-shadow-card)]"><span className="text-short">Retrying · </span>{toast}</div>}
      <p className="mt-6 text-[12px] text-muted">Paper fills are simulated against live reference prices with modelled slippage and fees. Paper results don&apos;t predict live results.</p>
    </div>
  );
}
