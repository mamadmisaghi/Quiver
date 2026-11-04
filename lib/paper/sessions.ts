import type { ActivityNote } from "./observations";
import { activeSessionMs, appendActivity, Checkpoint, PaperSessionSchema, type PaperSession } from "@/services/backend/src/workflows/session";
export { activeSessionMs, sessionActivity, PaperSessionSchema, type PaperSession } from "@/services/backend/src/workflows/session";
import { z } from "zod";
import { Strategy, BacktestRes } from "@/lib/contracts";
import type { StrategyRecord } from "@/lib/api/types";
import { paperProblems, type PaperState } from "@/services/backend/src/workflows/paper";
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
  return write({ ...session, activity: appendActivity(session, added), activeMs, state: state ? Checkpoint.parse(state) : null, status, updatedAt: now }, storage);
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
  return session.provenance !== "server" && session.status === "running" && Date.now() - session.updatedAt > 60_000 ? "paused" : session.status;
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
