import { ActivityRow, fillNote, type ActivityNote } from "./observations";
import { notifyPaperEvent } from "@/lib/api/preview-alerts";
import { z } from "zod";
import { Strategy, BacktestRes } from "@/lib/contracts";
import type { StrategyRecord } from "@/lib/api/types";
import { PaperQuote, paperProblems, type PaperState } from "@/services/backend/src/workflows/paper";
const number = z.number().finite(), positive = number.nonnegative();
const dict = <T extends z.ZodType>(value: T) => z.record(z.string(), value);
const Checkpoint = z.object({
  readings: dict(z.union([number, z.boolean(), z.null()])).optional(),
  checks: dict(z.object({ met: positive, total: positive, unknown: positive, result: z.boolean().nullable() })).optional(),
  version: z.literal(1), startedAt: number, lastAt: number, budget: positive, principal: number, pools: dict(number),
  positions: dict(z.object({ assetId: z.string(), qty: positive, baseQty: positive, entry: positive, margin: positive, entryFee: positive, side: z.union([z.literal(1), z.literal(-1)]), leverage: positive, openedAt: number, peakPct: number, rungs: z.array(number), allocation: z.array(z.object({ source: z.string(), value: number })) })),
  stages: dict(z.object({ fills: positive, lastFillAt: number.nullable(), active: z.boolean(), latched: z.boolean(), closed: z.boolean(), resolved: z.boolean(), realized: number, status: z.string(), consumedDependency: z.string().optional() })),
  anchors: dict(number), history: dict(z.array(z.tuple([number, number]))), previous: dict(z.union([number, z.boolean(), z.null()])), quotes: dict(PaperQuote), fees: positive, realized: number, day: z.string(), dayStart: number, dayOrders: positive,
  events: z.array(z.object({ at: number, stageId: z.string(), kind: z.enum(["buy", "sell", "exit", "settle"]), amount: number, price: number, fee: number, detail: z.string() })), curve: z.array(z.tuple([number, number])),
});
export const PaperSessionSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^paper_[a-zA-Z0-9-]+$/), strategyId: z.string(), strategyVersion: z.number().int().positive(), name: z.string(), strategy: Strategy,
  mode: z.enum(["scenario", "quotes"]), status: z.enum(["ready", "running", "paused", "completed"]), createdAt: number, updatedAt: number, state: Checkpoint.nullable(),
  activity: z.array(ActivityRow).max(100).optional(), editRevision: z.number().int().nonnegative().optional(), rulesChangedAt: number.optional(), pausedRules: z.array(z.string()).optional(),
  activeMs: positive.optional(), // Time accrued through updatedAt. Older records have no measured duration.
  startingBalance: z.number().finite().positive().optional(), legacyResult: BacktestRes.optional(),
});
export type PaperSession = z.infer<typeof PaperSessionSchema>;
const prefix = "quiver.paper-session.v1.";
export const PAPER_SESSION_EVENT = "quiver:paper-sessions";
export function readPaperSession(id: string, storage: Storage = localStorage): PaperSession | null {
  try { const raw = storage.getItem(prefix + id); if (!raw) return null; const parsed = PaperSessionSchema.safeParse(JSON.parse(raw)); return parsed.success && parsed.data.id === id && (parsed.data.strategy.workflow || (parsed.data.mode === "scenario" && parsed.data.startingBalance)) ? parsed.data : null; } catch { return null; }
}
export function listPaperSessions(storage: Storage = localStorage) {
  const sessions: PaperSession[] = [];
  for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(prefix)) { const s = readPaperSession(key.slice(prefix.length), storage); if (s) sessions.push(s); } }
  return sessions.sort((a, b) => b.createdAt - a.createdAt);
}
/** Project only history that older checkpoints actually recorded. */
export function sessionActivity(session: PaperSession): ActivityRow[] {
  if (session.activity) return session.activity;
  const notes: ActivityNote[] = [{ at: session.createdAt, kind: "session", label: "Session created", detail: session.name }];
  if (session.strategy.workflow) for (const fill of session.state?.events ?? []) notes.push(fillNote(session.strategy.workflow, fill));
  if (session.state && session.state.lastAt >= session.state.startedAt) {
    notes.push({ at: session.state.lastAt, kind: "check", label: "Last recorded check", detail: "Restored from this session’s saved observations." });
  }
  if (session.status === "paused") notes.push({ at: session.updatedAt, kind: "session", label: "Session paused", detail: "Observation paused in this browser." });
  return notes.sort((a, b) => a.at - b.at).map((row, seq) => ({ ...row, seq })).slice(-100);
}
function appendActivity(session: PaperSession, notes: ActivityNote[]) {
  const rows = sessionActivity(session);
  let seq = rows.at(-1)?.seq ?? 0;
  return [...rows, ...notes.map(row => ({ ...row, seq: ++seq }))].slice(-100);
}
function write(session: PaperSession, storage: Storage) {
  try { storage.setItem(prefix + session.id, JSON.stringify(session)); }
  catch { throw new Error("This browser could not save the paper session. Free some browser storage and try again."); }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PAPER_SESSION_EVENT));
  return session;
}
export function createPaperSession(record: StrategyRecord, storage: Storage = localStorage) {
  const strategy = Strategy.parse(record.strategy);
  if (!strategy.workflow) throw new Error("Prepare this saved draft for live-quote paper trading.");
  const problems = paperProblems(strategy.workflow, true);
  if (problems.length) throw new Error(problems[0]);
  const now = Date.now();
  return write(PaperSessionSchema.parse({ version: 1, id: `paper_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")}`, strategyId: record.id, strategyVersion: record.version, name: record.name, strategy, mode: "quotes", status: "ready", activeMs: 0, createdAt: now, updatedAt: now, state: null }), storage);
}
/** Count an interval exactly once, only while a driver owns this session. */
export function activeSessionMs(session: PaperSession, now: number, observing: boolean) {
  const measured = session.activeMs ?? 0;
  return measured + (observing && session.activeMs !== undefined && session.status === "running" ? Math.max(0, now - session.updatedAt) : 0);
}
export function checkpointPaperSession(id: string, state: PaperState | null, status: PaperSession["status"], storage: Storage = localStorage, resume = false, driverActive = true, notes: ActivityNote[] = [], expectedEdit?: number) {
  const session = readPaperSession(id, storage); if (!session) throw new Error("This paper session is no longer available in this browser.");
  if (expectedEdit !== undefined && expectedEdit !== (session.editRevision ?? 0)) throw new Error("The session rules changed. Resume with the latest version.");
  if (status === "running" && session.status === "paused" && !resume) throw new Error("This session was paused in another tab.");
  const now = Math.max(Date.now(), session.updatedAt);
  const activeMs = activeSessionMs(session, now, !resume && driverActive);
  const added = [...notes];
  if (status !== session.status && (status === "paused" || status === "running")) {
    const label = status === "paused" ? "Session paused" : session.status === "ready" ? "Session started" : "Session resumed";
    added.push({ at: now, kind: "session", label, detail: status === "paused" ? "Market observation paused." : "Watching the selected markets." });
  }
  const next = write({ ...session, activity: appendActivity(session, added), activeMs, state: state ? Checkpoint.parse(state) : null, status, updatedAt: now }, storage);
  if (typeof window !== "undefined") {
    if (session.status !== status) notifyPaperEvent(id, "status", next.updatedAt, session.name + " · " + status);
    const event = next.state?.events.at(-1), old = session.state?.events.at(-1);
    if (event && (event.at !== old?.at || event.stageId !== old?.stageId || event.kind !== old?.kind))
      notifyPaperEvent(id, "fill", event.at, session.name + " · " + event.detail.slice(0,150));
    const stageStatus = Object.values(next.state?.stages ?? {});
    for (const [rule, phrase] of [["risk_halt","daily risk limit"], ["rejected","blocked"]] as const) {
      const blocked = stageStatus.some(s=>s.status.toLowerCase().includes(phrase));
      const wasBlocked = Object.values(session.state?.stages ?? {}).some(s=>s.status.toLowerCase().includes(phrase));
      if (blocked && !wasBlocked) notifyPaperEvent(id, rule, next.updatedAt, session.name + " · " + (rule==="risk_halt"?"Daily loss limit reached":"Order blocked by a risk limit"));
    }
  }
  return next;
}
export function savePaperEdit(id: string, expectedEdit: number, change: (current: PaperSession) => { strategy: PaperSession["strategy"]; pausedRules: string[]; summaries: string[] }, driverActive: boolean, storage: Storage = localStorage) {
  const session = readPaperSession(id, storage);
  if (!session || session.mode !== "quotes" || !session.strategy.workflow) throw new Error("Open a live-quote paper session to change its rules.");
  if ((session.editRevision ?? 0) !== expectedEdit) throw new Error("The rules changed since this preview. Preview the change again.");
  const { strategy, pausedRules, summaries } = change(session);
  const now = Math.max(session.updatedAt, Date.now());
  const editRevision = expectedEdit + 1;
  const row: ActivityNote = { at: now, kind: "edit", label: "Rules updated", detail: summaries.join(" · ") };
  return write({ ...session, strategy, pausedRules, editRevision, rulesChangedAt: now, updatedAt: now, activeMs: activeSessionMs(session, now, driverActive),
    activity: appendActivity(session, [row]) }, storage);
}
export function sessionStatus(session: PaperSession) {
  return session.status === "running" && Date.now() - session.updatedAt > 60_000 ? "paused" : session.status;
}

export function completeLegacySession(id: string, result: z.infer<typeof BacktestRes>, storage: Storage = localStorage) {
  const session = readPaperSession(id, storage);
  if (!session || session.strategy.workflow || !result.result || result.status !== "done") throw new Error("Could not save the completed rule simulation.");
  if (session.status === "completed") return session;
  return write({ ...session, legacyResult: BacktestRes.parse(result), status: "completed", updatedAt: Date.now() }, storage);
}
export function pauseAllPaperSessions(storage: Storage = localStorage) {
  const active = listPaperSessions(storage).filter(session => session.status === "running");
  for (const session of active) checkpointPaperSession(session.id, session.state, "paused", storage, false, sessionStatus(session) === "running");
  return active.length;
}
