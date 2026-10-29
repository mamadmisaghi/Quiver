// M4.5 Autopilot engine (paper only). Pure scheduling over injected run controls; never touches keys, testnet or live.
// M4.5.1 concurrency model (gate 5d5c80f):
//  - every mutation for a user (step, put-save, disable, kill) runs under a per-user mutex (promise chain);
//  - step() is single-flight per user (a concurrent call joins the in-flight pass), stepAll() is single-flight globally;
//  - kill/disable bump `epoch` and flip the flags synchronously BEFORE taking the lock, so a pass that is mid-await sees it;
//  - after every await a pass re-checks enabled && !killed && same epoch before launching; a run that starts anyway is stopped;
//  - kill stops every still-live run autopilot ever started for the user (`owned`), not only the tracked one.
import type { z } from "zod";
import type { AutopilotDecision, PutAutopilotReq } from "../../contracts/src/autopilot";

type Cfg = z.infer<typeof PutAutopilotReq>; type Dec = z.infer<typeof AutopilotDecision>;
export interface AutopilotDeps {
  now: () => number; platformKill: () => boolean;
  /** starts a PAPER run through the normal guarded path; throws ApiErr on refusal */
  start: (userId: string, strategyId: string, equityUsd: string, approvalMode: "auto" | "confirm_each") => string;
  stop: (runId: string) => Promise<void>; // stop_and_flatten
  /** M4.9.1: structured error log (redacted by the caller); defaults to console.error */
  logError?: (msg: string, meta: Record<string, unknown>) => void;
  /** M4.9.1: stepAll concurrency cap (default 8) and per-user pass timeout (default 20 s) */
  concurrency?: number; userTimeoutMs?: number;
  /** null when the run is gone */
  stats: (runId: string) => { equity: number; peak: number; starting: number; stopped: boolean; status: string } | null;
}
/** JSON-safe (persisted with the dev store). */
export interface ApState { cfg: Cfg; killed: boolean; idx: number; currentRunId: string | null; currentStrategyId: string | null; since: number; day: string; rotations: number; dayRuns: string[]; log: Dec[]; epoch: number; owned: string[] }

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
export class AutopilotService {
  private locks = new Map<string, Promise<unknown>>(); private stepping = new Map<string, Promise<void>>(); private allInflight: Promise<void> | null = null;
  constructor(private d: AutopilotDeps, readonly users: Map<string, ApState> = new Map()) {}
  private lock<T>(uid: string, fn: () => Promise<T> | T): Promise<T> {
    const p = (this.locks.get(uid) ?? Promise.resolve()).then(fn, fn) as Promise<T>;
    const tail = p.catch(() => {}); this.locks.set(uid, tail); void tail.then(() => { if (this.locks.get(uid) === tail) this.locks.delete(uid); });
    return p;
  }
  private log(s: ApState, x: Omit<Dec, "at">) { const e = { at: new Date(this.d.now()).toISOString(), ...x }; s.log.push(e); if (s.log.length > 500) s.log.shift(); return e; }
  private live(s: ApState, ep: number) { return s.cfg.enabled && !s.killed && s.epoch === ep; }
  dayPnl(s: ApState) { return s.dayRuns.reduce((a, id) => { const st = this.d.stats(id); return a + (st ? st.equity - st.starting : 0); }, 0); }
  /** Saves config (under the user lock). Disabling bumps the epoch immediately so an in-flight pass cannot launch. */
  async put(userId: string, cfg: Cfg): Promise<"ok" | "killed"> {
    const s0 = this.users.get(userId);
    if (s0?.killed && cfg.enabled && !cfg.acknowledgeKill) return "killed";
    if (s0 && !cfg.enabled) { s0.cfg = { ...s0.cfg, enabled: false }; s0.epoch++; }
    return this.lock(userId, () => {
      const s = this.users.get(userId);
      if (!s) { this.users.set(userId, { cfg, killed: false, idx: 0, currentRunId: null, currentStrategyId: null, since: 0, day: dayOf(this.d.now()), rotations: 0, dayRuns: [], log: [], epoch: 0, owned: [] }); return "ok" as const; }
      if (s.killed && cfg.enabled && !cfg.acknowledgeKill) return "killed" as const;
      if (s.cfg.enabled !== cfg.enabled) s.epoch++;
      s.cfg = cfg; if (cfg.enabled && s.killed) s.killed = false;
      return "ok" as const;
    });
  }
  /** Disable or kill. Flags flip synchronously; stopping happens under the lock (after any in-flight pass). */
  async disable(userId: string, why: "disabled" | "killed", reason: string): Promise<{ stopped: number; failed: { runId: string; reason: string }[] }> {
    const s0 = this.users.get(userId); if (!s0) return { stopped: 0, failed: [] };
    s0.cfg = { ...s0.cfg, enabled: false }; s0.epoch++; if (why === "killed") s0.killed = true;
    return this.lock(userId, async () => {
      const s = this.users.get(userId)!; const from = s.currentRunId;
      const targets = why === "killed" ? this.liveOwned(s) : from ? [from] : [];
      // M4.9.1: one failing stop never aborts the rest; failures are logged and reported as a partial result
      const failed: { runId: string; reason: string }[] = []; let stopped = 0;
      for (const id of targets) {
        try { await this.d.stop(id); stopped++; }
        catch (e) { const code = (e as { code?: string }).code ?? "stop_failed"; failed.push({ runId: id, reason: code }); (this.d.logError ?? ((m, x) => console.error(JSON.stringify({ level: "error", msg: m, ...x }))))("autopilot stop failed", { userId, runId: id, why, code }); }
      }
      s.currentRunId = null; s.currentStrategyId = null;
      const tail = [targets.length > 1 ? `stopped ${stopped} of ${targets.length} runs` : null, failed.length ? `${failed.length} failed to stop` : null].filter(Boolean).join(", ");
      this.log(s, { action: why, fromRunId: from, toRunId: null, strategyId: null, reason: tail ? `${reason} (${tail})` : reason });
      return { stopped, failed };
    });
  }
  private liveOwned(s: ApState) { return s.owned.filter((id) => { const st = this.d.stats(id); return st && !st.stopped; }); }
  /** Sync between the final re-check and start(): nothing can interleave. */
  private async launch(userId: string, s: ApState, ep: number, from: string | null, action: "started" | "rotated", reason: string) {
    const n = s.cfg.strategyIds.length;
    for (let k = 0; k < n; k++) { // try each strategy once, round-robin, skipping ones that refuse (e.g. invalid, already running)
      if (!this.live(s, ep) || this.d.platformKill()) return null;
      const sid = s.cfg.strategyIds[(s.idx + k) % n]!;
      let id: string;
      try { id = this.d.start(userId, sid, s.cfg.startingEquityUsd, s.cfg.approvalMode ?? "auto"); }
      catch (e) { this.log(s, { action: "start_failed", fromRunId: from, toRunId: null, strategyId: sid, reason: (e as { code?: string }).code ?? "error" }); continue; }
      s.owned.push(id); if (s.owned.length > 200) s.owned = s.owned.filter((x) => { const st = this.d.stats(x); return st && !st.stopped; }).slice(-200);
      if (!this.live(s, ep)) { await this.d.stop(id); return null; } // belt and braces: never leave an untracked run
      s.idx = (s.idx + k + 1) % n; s.currentRunId = id; s.currentStrategyId = sid; s.since = this.d.now(); s.dayRuns.push(id);
      return this.log(s, { action, fromRunId: from, toRunId: id, strategyId: sid, reason });
    }
    s.currentRunId = null; s.currentStrategyId = null; s.cfg = { ...s.cfg, enabled: false }; s.epoch++;
    return this.log(s, { action: "disabled", fromRunId: from, toRunId: null, strategyId: null, reason: "no strategy could start" });
  }
  private skip(s: ApState, reason: string) { const l = s.log.at(-1); if (!(l?.action === "skipped" && l.reason === reason)) this.log(s, { action: "skipped", fromRunId: s.currentRunId, toRunId: null, strategyId: s.currentStrategyId, reason }); }
  private stopGuard(s: ApState, from: string, reason: string) { s.currentRunId = null; s.cfg = { ...s.cfg, enabled: false }; s.epoch++; this.log(s, { action: "guardrail_stop", fromRunId: from, toRunId: null, strategyId: s.currentStrategyId, reason }); s.currentStrategyId = null; }
  /** One scheduling pass for one user. Single-flight: a concurrent call joins the in-flight pass. */
  step(userId: string): Promise<void> {
    const cur = this.stepping.get(userId); if (cur) return cur;
    const p = this.lock(userId, () => this.pass(userId)).finally(() => this.stepping.delete(userId));
    this.stepping.set(userId, p); return p;
  }
  private async pass(userId: string) {
    const s = this.users.get(userId); if (!s || !s.cfg.enabled || s.killed) return; const ep = s.epoch;
    const t = this.d.now(); if (dayOf(t) !== s.day) { s.day = dayOf(t); s.rotations = 0; s.dayRuns = s.currentRunId ? [s.currentRunId] : []; }
    if (this.d.platformKill()) return; // platform kill switch: runs are halted by the platform; autopilot just waits
    const g = s.cfg.guardrails;
    if (!s.currentRunId) { await this.launch(userId, s, ep, null, "started", "autopilot enabled"); return; }
    const st = this.d.stats(s.currentRunId);
    if (!st || st.stopped) { // decision (P3): an external stop is the user taking over → autopilot disables itself (no restart loop)
      const from = s.currentRunId; s.currentRunId = null; s.currentStrategyId = null; s.cfg = { ...s.cfg, enabled: false }; s.epoch++;
      this.log(s, { action: "disabled", fromRunId: from, toRunId: null, strategyId: null, reason: "run was stopped outside autopilot" }); return;
    }
    const dd = st.peak > 0 ? ((st.peak - st.equity) / st.peak) * 100 : 0;
    if (dd >= g.maxDrawdownPct) { const from = s.currentRunId; this.stopGuard(s, from, `drawdown ${dd.toFixed(2)}% ≥ ${g.maxDrawdownPct}%`); await this.d.stop(from); return; }
    const loss = -this.dayPnl(s);
    if (loss >= g.maxDailyLossUsd) { const from = s.currentRunId; this.stopGuard(s, from, `daily loss $${loss.toFixed(2)} ≥ $${g.maxDailyLossUsd}`); await this.d.stop(from); return; }
    if (t - s.since < s.cfg.rotateEveryMin * 60_000) return;
    if (st.status === "paused" || st.status === "halted") { this.skip(s, `current run is ${st.status}; rotation skipped until it is resumed`); return; }
    if (s.rotations >= g.maxRotationsPerDay) { this.skip(s, `rotation cap ${g.maxRotationsPerDay}/day reached`); return; }
    if (s.cfg.strategyIds.length === 1) { s.since = t; return; } // nothing to rotate to
    const from = s.currentRunId; s.rotations++; await this.d.stop(from); s.currentRunId = null; s.currentStrategyId = null;
    if (!this.live(s, ep)) return; // killed/disabled while stopping: do not launch
    await this.launch(userId, s, ep, from, "rotated", `every ${s.cfg.rotateEveryMin} min`);
  }
  /** Single-flight across the whole service: the 30 s timer never overlaps a pass that is still running. */
  stepAll(): Promise<void> {
    if (this.allInflight) return this.allInflight;
    // M4.9.1: users run in parallel (cap `concurrency`); each pass is bounded by `userTimeoutMs` so one stuck user never stalls the rest.
    // A timed-out pass keeps its lock and single-flight slot, so the next tick joins it instead of starting a second one.
    const q = [...this.users.keys()]; const cap = Math.max(1, this.d.concurrency ?? 8); const ms = this.d.userTimeoutMs ?? 20_000;
    const one = async (u: string) => { let tm: ReturnType<typeof setTimeout> | undefined;
      const r = await Promise.race([this.step(u).then(() => "ok" as const, () => "error" as const), new Promise<"timeout">((res) => { tm = setTimeout(() => res("timeout"), ms); (tm as { unref?: () => void }).unref?.(); })]);
      clearTimeout(tm); if (r === "timeout") (this.d.logError ?? ((m, x) => console.error(JSON.stringify({ level: "error", msg: m, ...x }))))("autopilot pass timed out", { userId: u, timeoutMs: ms }); };
    this.allInflight = (async () => { const worker = async () => { for (let u = q.shift(); u !== undefined; u = q.shift()) await one(u); }; await Promise.all(Array.from({ length: Math.min(cap, q.length) }, worker)); })().finally(() => { this.allInflight = null; });
    return this.allInflight;
  }
  /** After a dev restart: tracked run resumes under guardrails; any other live run autopilot owned is stopped; disabled/killed users have none left. */
  async reconcile() {
    for (const [uid, s] of this.users) await this.lock(uid, async () => {
      for (const id of this.liveOwned(s)) if (id !== s.currentRunId || !s.cfg.enabled || s.killed) await this.d.stop(id);
      if (s.currentRunId && (!s.cfg.enabled || s.killed)) s.currentRunId = null;
    });
  }
}
