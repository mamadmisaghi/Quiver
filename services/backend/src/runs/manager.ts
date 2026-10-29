import type { ApprovalRec } from "../sim/executor";
import { RunEvent } from "../../contracts/src/events";
import type { Strategy } from "../../contracts/src/strategy";
import { iso, type Clock } from "../lib/clock";
import { dec, usd } from "../lib/dec";
import { Executor, type EventBody } from "../sim/executor";
import type { RunRow } from "../store";
import type { Adapters } from "../venues/adapters";
import type { MarketData } from "../venues/market";
import type { Registry } from "../venues/registry";
import { MemoMarket } from "../venues/memo-market";
import { captureExecutor, restoreExecutor, type RunCheckpoint } from "./checkpoint";

type Listener = (e: RunEvent) => void;
export interface ManagerDeps {
  clock: Clock; mkt: MarketData; adapters: Adapters; registry: Registry; cycleMs: number;
  killSwitch: () => boolean; validateEvents: boolean; autoTimers: boolean;
  /** M4.9.1: bound on how long a stop waits for an in-flight tick and the flatten (default 5000 ms); a stuck price fetch can never hold a kill. */
  stopTimeoutMs?: number;
  /** Max runs ticking at once within a wave (default 64). */
  concurrency?: number;
  sessionKey?: (run: RunRow) => (() => { perTxCapUsd: number; dailyCapUsd: number; spentTodayUsd: number; status: string } | null) | undefined;
  onSpend?: (run: RunRow, usd: number) => void;
  /** M4.0: every appended run event (alerts). Errors are swallowed. */
  onEvent?: (run: RunRow, ev: RunEvent) => void;
}
interface Live { run: RunRow; ex: Executor; timer: NodeJS.Timeout | null; listeners: Set<Listener>; chain: Promise<void>; stockOk: () => boolean; equity: [number, number][]; busy: boolean; skipped: number; ac: AbortController; closed: boolean; flattening?: boolean }

/** Owns active runs: engine timers, the per-run append-only event log (seq), and subscribers (SSE). */
export class RunManager {
  live = new Map<string, Live>();
  private memo: MemoMarket; private wave: NodeJS.Timeout | null = null; private waving = false;
  private stopping = false;
  /** Last wave stats (for /health and perf tests). */
  stats = { waves: 0, lastWaveMs: 0, lastWaveRuns: 0, skippedTicks: 0, overruns: 0 };
  constructor(private d: ManagerDeps) { this.memo = new MemoMarket(d.mkt); }

  /**
   * One shared engine timer for all runs (instead of one timer per run). Each wave evaluates every running run at the
   * SAME timestamp with bounded concurrency and a shared per-wave read cache. A run whose previous tick is still in
   * flight is skipped (counted), and a wave that is still running when the next is due is skipped (overrun), so a slow
   * venue or market read can never pile up work.
   */
  async runWave(t = this.d.clock.now()) {
    if (this.stopping) return;
    if (this.waving) { this.stats.overruns++; return; }
    this.waving = true; const t0 = performance.now();
    try {
      this.memo.reset();
      const ids = [...this.live.keys()]; const lim = Math.max(1, this.d.concurrency ?? 64); let k = 0;
      await Promise.all(Array.from({ length: Math.min(lim, ids.length) }, async () => { while (k < ids.length) { const id = ids[k++]; await this.tick(id, t); } }));
      this.stats = { ...this.stats, waves: this.stats.waves + 1, lastWaveMs: performance.now() - t0, lastWaveRuns: ids.length };
    } finally { this.waving = false; }
  }
  private ensureTimer() {
    if (this.stopping || !this.d.autoTimers || this.wave) return;
    this.wave = setInterval(() => void this.runWave(), this.d.cycleMs); this.wave.unref?.();
  }

  private emit(l: Live, body: EventBody, t?: number) {
    // M3.6: once stop is requested, an in-flight tick is aborted and nothing it produces reaches the log.
    if (l.closed || (l.ac.signal.aborted && body.type !== "status" && !l.flattening)) return;
    const ev = { v: 1, seq: l.run.events.length, runId: l.run.id, mode: l.run.mode, ts: iso(t ?? this.d.clock.now()), ...body } as RunEvent;
    if (this.d.validateEvents) RunEvent.parse(ev); // drift fails loudly in dev/test
    l.run.events.push(ev);
    if (ev.type === "risk_halt") { l.run.status = "halted"; }
    for (const f of l.listeners) try { f(ev); } catch { /* subscriber errors never break the engine */ }
    try { this.d.onEvent?.(l.run, ev); } catch { /* alert hook never breaks the engine */ }
  }

  start(run: RunRow, strategy: Strategy, stockTokensAllowed: () => boolean, opts?: { paused?: boolean; checkpoint?: RunCheckpoint; restoreStatus?: RunRow["status"] }) {
    const l: Live = { run, ex: null as unknown as Executor, timer: null, listeners: new Set(), chain: Promise.resolve(), stockOk: stockTokensAllowed, equity: [], busy: false, skipped: 0, ac: new AbortController(), closed: false };
    l.ex = new Executor({ strategy, mkt: this.memo, adapters: this.d.adapters, registry: this.d.registry, startingEquity: run.startingEquity,
      stockTokensAllowed, killSwitch: this.d.killSwitch, fillModel: "quote", approvals: this.approvalsOf(run.id), runStatus: () => run.status, approval: run.approvalMode === "confirm_each" ? { ttlMs: (run.approvalTtlSec ?? 300) * 1000, maxPending: 20 } : undefined, sessionKey: this.d.sessionKey?.(run), onSpend: (u) => this.d.onSpend?.(run, u),
      aborted: () => l.ac.signal.aborted, emit: (b, t) => this.emit(l, b, t) });
    if (opts?.checkpoint) {
      if (run.mode !== "paper" || opts.checkpoint.strategyVersion !== run.strategyVersion || opts.checkpoint.lastSeq !== run.events.length - 1) throw new Error("Paper checkpoint does not match its run");
      restoreExecutor(l.ex, opts.checkpoint); l.equity = [...opts.checkpoint.equity];
    }
    this.live.set(run.id, l);
    if (!(opts?.checkpoint && opts.restoreStatus === "stopped")) this.recordEquity(l, this.d.clock.now());
    if (!opts?.checkpoint) {
    this.emit(l, { type: "status", status: "starting" });
    run.status = "running"; this.emit(l, { type: "status", status: "running" });
    } else {
      run.status = opts.restoreStatus ?? "paused";
      if (run.status === "stopped") { l.ex.freeze(); l.closed = true; this.live.delete(run.id); this.stopped.set(run.id, l); return l; }
      this.emit(l, { type: "status", status: run.status, reason: "Paper account restored after server restart." });
    }
    if (opts?.paused) { run.status = "paused"; this.emit(l, { type: "status", status: "paused", reason: "still paused after dev restart" }); }
    if (this.d.autoTimers) { this.memo.reset(); void this.tick(run.id); this.ensureTimer(); }
    return l;
  }
  /** Append a warning event to a live run (used for dev-restart notices). */
  /** M4.9: hot-swap the strategy of a live paper run (new version). Trigger state is kept for unchanged ids; removed triggers drop out. */
  swapStrategy(runId: string, strategy: Strategy, version: number, message: string) {
    const l = this.live.get(runId); if (!l || l.run.status === "stopped") return false;
    l.ex.d.strategy = strategy; l.run.strategyVersion = version;
    const keep = new Set(strategy.triggers.map((t) => t.id));
    for (const id of Object.keys(l.ex.st.triggers)) if (!keep.has(id)) delete l.ex.st.triggers[id];
    for (const t of strategy.triggers) l.ex.st.triggers[t.id] ??= { state: "ready", heldSince: null, cooldownUntil: null, fires: 0, lastCond: null };
    this.warn(runId, "strategy_updated", message); return true;
  }
  warn(runId: string, code: string, message: string) { const l = this.live.get(runId); if (l) this.emit(l, { type: "warning", code, message } as EventBody); }
  /** Run one cycle now (serialized per run). Tests call this directly with a manual clock. */
  tick(runId: string, at?: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    const l = this.live.get(runId); if (!l) return Promise.resolve();
    if (l.busy) { l.skipped++; this.stats.skippedTicks++; return l.chain; }
    if (at === undefined) this.memo.reset(); // direct tick outside a wave: never reuse cached reads
    l.busy = true;
    l.chain = l.chain.then(async () => {
      if (l.ac.signal.aborted || (l.run.status !== "running" && l.run.status !== "halted")) return;
      const t = at ?? this.d.clock.now();
      try { await l.ex.cycle(t); this.recordEquity(l, t); }
      catch (e) { this.emit(l, { type: "error", code: "internal", message: "Engine cycle failed; retrying next cycle.", retryable: true }); }
    }).finally(() => { l.busy = false; });
    return l.chain;
  }
  /** M4.1: close `fraction` of a paper position now, serialized with ticks. Returns the events it appended. */
  closePartial(runId: string, instrument: string, fraction: number, orderId: string): Promise<RunEvent[]> | null {
    const l = this.live.get(runId); if (!l || l.ac.signal.aborted) return null;
    const p = l.chain.then(async () => { const t = this.d.clock.now(); const from = l.run.events.length; await l.ex.closePartial(instrument, fraction, orderId, t); this.recordEquity(l, t); return l.run.events.slice(from); });
    l.chain = p.then(() => {}, () => {}); return p;
  }
  /** M5.3: write off a stuck paper position (serialized with ticks). */
  writeOff(runId: string, instrument: string, note: string): Promise<ReturnType<Executor["writeOff"]>> | null {
    const l = this.live.get(runId); if (!l || l.ac.signal.aborted) return null;
    const p = l.chain.then(() => { const t = this.d.clock.now(); const r = l.ex.writeOff(instrument, t);
      if (r) { this.warn(runId, "position_written_off", `${note} Written off at zero recovery: −$${r.lossUsd.toFixed(2)} realized (paper).`); this.recordEquity(l, t); }
      return r; });
    l.chain = p.then(() => {}, () => {}); return p;
  }
  /** M4.2: decide a proposal (serialized with ticks). Sets rec.result from the events the approval produced. */
  decideApproval(runId: string, id: string, decision: "approve" | "reject") {
    const l = this.live.get(runId); if (!l) return null;
    const p = l.chain.then(async () => {
      // M4.2.1: re-check on the serialized chain — a pause/halt/stop that landed after the route's check wins.
      if (decision === "approve" && (l.closed || l.ac.signal.aborted || l.ex.halted || l.run.status === "paused" || l.run.status === "halted" || l.run.status === "stopped")) return "run_not_active" as const;
      const t = this.d.clock.now(); const from = l.run.events.length; const r = await l.ex.decide(id, decision, t);
      const rec = l.ex.approvals.get(id);
      if (r === "ok" && rec && decision === "approve") {
        const evs = l.run.events.slice(from); const f = evs.find((e) => e.type === "fill" && e.orderId === rec.orderId); const x = evs.find((e) => (e.type === "rejected" || e.type === "error") && (e as { orderId?: string }).orderId === rec.orderId) as { type: string; code: string; message: string } | undefined;
        rec.result = f ? { status: "filled", code: null, message: null } : x ? { status: x.type === "rejected" ? "rejected" : "error", code: x.code, message: x.message } : { status: "error", code: "internal", message: "No fill was produced." };
        this.recordEquity(l, t);
      }
      return r;
    });
    l.chain = p.then(() => {}, () => {}); return p;
  }
  private apv = new Map<string, Map<string, ApprovalRec>>();
  approvalsOf(runId: string) { let m = this.apv.get(runId); if (!m) this.apv.set(runId, (m = new Map())); return m; }
  /** M4.2: expire stale proposals now (paused runs do not tick). */
  sweepApprovals(runId: string) { const l = this.live.get(runId); if (l && !l.ac.signal.aborted) l.ex.expireApprovals(this.d.clock.now()); }
  async control(runId: string, action: "pause" | "resume" | "stop" | "stop_and_flatten") {
    const l = this.live.get(runId); if (!l) return;
    const r = l.run;
    if (action === "stop" || action === "stop_and_flatten") {
      // M3.6: stop cancels immediately: abort the in-flight tick (its events are dropped), never wait on a slow venue read.
      l.ex.cancelApprovals(this.d.clock.now()); // M4.2
      l.ac.abort();
      if (action === "stop_and_flatten") {
        const ms = this.d.stopTimeoutMs ?? 5000; let tm: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timeout">((res) => { tm = setTimeout(() => res("timeout"), ms); (tm as { unref?: () => void }).unref?.(); });
        l.flattening = true;
        const done = await Promise.race([(async () => { await l.chain.catch(() => {}); await l.ex.flatten(this.d.clock.now()); return "ok" as const; })(), timeout]).finally(() => { clearTimeout(tm); l.flattening = false; });
        if (done === "timeout") { l.ex.freeze(); l.flattening = true; this.emit(l, { type: "warning", code: "flatten_timeout", message: `Stopped without flattening: price data did not respond within ${Math.round(ms / 1000)} s. Open paper positions stay at their last mark; a fill that arrives later is blocked, not applied.` } as EventBody); l.flattening = false; }
      }
      if (l.timer) clearInterval(l.timer);
      l.ex.freeze(); // M4.9.2: nothing fills after "stopped" (aborted tick or late flatten)
      r.status = "stopped"; r.stoppedAt = this.d.clock.now(); this.recordEquity(l, r.stoppedAt); this.emit(l, { type: "status", status: "stopped", reason: action === "stop_and_flatten" ? "stopped and flattened" : "stopped by user" });
      l.closed = true; l.listeners.clear(); this.live.delete(runId); this.stopped.set(runId, l);
      return;
    }
    // M4.2.1: pause takes effect immediately (not queued behind the chain) so a queued approval or in-flight tick sees it;
    // it only ever blocks new exposure, so jumping the queue is safe. Resume still waits for the chain.
    if (action === "pause") { if (r.status === "running") { r.status = "paused"; this.emit(l, { type: "status", status: "paused" }); } return; }
    await l.chain;
    if (action === "resume" && (r.status === "paused" || r.status === "halted")) { if (r.status === "halted") l.ex.resume(); r.status = "running"; this.emit(l, { type: "status", status: "running", reason: "resumed by user" }); }
  }
  /** Equity sample per cycle (bounded: halves resolution past 10k samples, always keeps first and last). */
  private recordEquity(l: Live, t: number) {
    const e = l.ex.equity(t); const last = l.equity.at(-1);
    if (last && last[0] === t) last[1] = e; else l.equity.push([t, e]);
    if (l.equity.length > 10_000) l.equity = l.equity.filter((_, j, a) => j % 2 === 0 || j === a.length - 1);
  }
  /** Raw [ms, equityUsd] samples, oldest first, downsampled to <= points. */
  equityCurve(runId: string, points: number): [number, number][] {
    const l = this.get(runId); if (!l) return [];
    const c = l.equity; if (c.length <= points) return [...c];
    const step = (c.length - 1) / (points - 1);
    return Array.from({ length: points }, (_, j) => c[Math.round(j * step)]);
  }
  /** Halt from outside (kill switch, session-key revoke). */
  haltExternal(runId: string, rule: "kill_switch" | "session_key_revoked" | "geo_block", message: string) {
    const l = this.live.get(runId); if (!l || l.run.status === "stopped") return;
    l.ex.halt(rule, null, null, message, this.d.clock.now());
  }
  stopped = new Map<string, Live>();
  get(runId: string) { return this.live.get(runId) ?? this.stopped.get(runId); }
  subscribe(runId: string, f: Listener) { const l = this.live.get(runId); if (!l) return () => {}; l.listeners.add(f); return () => l.listeners.delete(f); }
  /** Synthetic snapshot frames for a (re)connecting client (no id: they are not part of the log). */
  snapshotFrames(runId: string): RunEvent[] {
    const l = this.get(runId); if (!l) return [];
    const base = { v: 1 as const, seq: Math.max(0, l.run.events.length - 1), runId, mode: l.run.mode, ts: iso(this.d.clock.now()) };
    const out: RunEvent[] = [{ ...base, type: "status", status: l.run.status }];
    if (l.ex.st.cycle > 0) out.push({ ...base, ...(l.ex.tickBody(l.ex.lastSnap, this.d.clock.now(), true) as any) });
    out.push({ ...base, type: "triggers_snapshot", cycle: l.ex.st.cycle, triggers: this.triggerStates(runId) }); // M4.7
    return out;
  }
  triggerStates(runId: string) {
    const l = this.get(runId); if (!l) return [];
    const t = this.d.clock.now();
    return l.ex.d.strategy.triggers.map((tr) => { const rt = l.ex.st.triggers[tr.id]!; return { triggerId: tr.id, state: rt.state, conditionTrue: rt.lastCond, heldForSec: rt.heldSince ? Math.max(0, (t - rt.heldSince) / 1000) : 0, cooldownUntil: rt.cooldownUntil ? iso(rt.cooldownUntil) : null, fires: rt.fires }; });
  }
  summary(run: RunRow) {
    const l = this.get(run.id); const t = run.stoppedAt ?? this.d.clock.now();
    const eq = l ? l.ex.equity(t) : run.startingEquity; const pnl = eq - run.startingEquity;
    return { id: run.id, strategyId: run.strategyId, strategyVersion: run.strategyVersion, mode: run.mode, status: run.status, startedAt: iso(run.startedAt), stoppedAt: run.stoppedAt ? iso(run.stoppedAt) : null,
      lastSeq: Math.max(0, run.events.length - 1), equityUsd: usd(eq), pnlUsd: usd(pnl), pnlPct: dec((pnl / run.startingEquity) * 100, 2),
      approvalMode: run.approvalMode ?? "auto", pendingApprovals: l ? [...this.approvalsOf(run.id).values()].filter((x) => x.status === "pending").length : 0,
      triggerStates: run.status === "stopped" ? [] : this.triggerStates(run.id), blockedFills: l ? l.ex.blockedFills : 0 };
  }
  shutdown() { this.stopping = true; if (this.wave) clearInterval(this.wave); this.wave = null; for (const l of this.live.values()) if (l.timer) clearInterval(l.timer); }
  /** A checkpoint is never taken halfway through a fill or approval. */
  async checkpoints(): Promise<Map<string, RunCheckpoint>> {
    const all = [...this.live.values(), ...this.stopped.values()];
    await Promise.all(all.map((l) => l.chain.catch(() => {})));
    const out = new Map<string, RunCheckpoint>();
    for (const l of all) {
      if (l.busy || l.flattening || l.run.mode !== "paper") continue;
      out.set(l.run.id, JSON.parse(JSON.stringify({ v: 1, lastSeq: l.run.events.length - 1, strategyVersion: l.run.strategyVersion, ...captureExecutor(l.ex), equity: l.equity })));
    }
    return out;
  }
}
