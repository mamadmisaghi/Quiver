import { z } from "zod";
import { Strategy } from "@/lib/contracts";
import type { StrategyRecord } from "@/lib/api/types";
import { PaperQuote, paperProblems, type PaperState } from "@/services/backend/src/workflows/paper";
const number = z.number().finite(), positive = number.nonnegative();
const dict = <T extends z.ZodType>(value: T) => z.record(z.string(), value);
const Checkpoint = z.object({
  version: z.literal(1), startedAt: number, lastAt: number, budget: positive, principal: number, pools: dict(number),
  positions: dict(z.object({ assetId: z.string(), qty: positive, baseQty: positive, entry: positive, margin: positive, entryFee: positive, side: z.union([z.literal(1), z.literal(-1)]), leverage: positive, openedAt: number, peakPct: number, rungs: z.array(number), allocation: z.array(z.object({ source: z.string(), value: number })) })),
  stages: dict(z.object({ fills: positive, lastFillAt: number.nullable(), active: z.boolean(), latched: z.boolean(), closed: z.boolean(), resolved: z.boolean(), realized: number, status: z.string(), consumedDependency: z.string().optional() })),
  anchors: dict(number), history: dict(z.array(z.tuple([number, number]))), previous: dict(z.union([number, z.boolean(), z.null()])), quotes: dict(PaperQuote), fees: positive, realized: number, day: z.string(), dayStart: number, dayOrders: positive,
  events: z.array(z.object({ at: number, stageId: z.string(), kind: z.enum(["buy", "sell", "exit", "settle"]), amount: number, price: number, fee: number, detail: z.string() })), curve: z.array(z.tuple([number, number])),
});
export const PaperSessionSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^paper_[a-zA-Z0-9-]+$/), strategyId: z.string(), strategyVersion: z.number().int().positive(), name: z.string(), strategy: Strategy,
  mode: z.enum(["scenario", "quotes"]), status: z.enum(["ready", "running", "paused", "completed"]), createdAt: number, updatedAt: number, state: Checkpoint.nullable(),
});
export type PaperSession = z.infer<typeof PaperSessionSchema>;
const prefix = "quiver.paper-session.v1.";
export const PAPER_SESSION_EVENT = "quiver:paper-sessions";
export function readPaperSession(id: string, storage: Storage = localStorage): PaperSession | null {
  try { const raw = storage.getItem(prefix + id); if (!raw) return null; const parsed = PaperSessionSchema.safeParse(JSON.parse(raw)); return parsed.success && parsed.data.id === id && parsed.data.strategy.workflow ? parsed.data : null; } catch { return null; }
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
export function createPaperSession(record: StrategyRecord, mode: PaperSession["mode"], storage: Storage = localStorage) {
  const strategy = Strategy.parse(record.strategy);
  if (!strategy.workflow) throw new Error("This strategy needs the connected paper engine.");
  const problems = paperProblems(strategy.workflow, mode === "quotes"); if (problems.length) throw new Error(problems[0]);
  const now = Date.now();
  return write(PaperSessionSchema.parse({ version: 1, id: `paper_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")}`, strategyId: record.id, strategyVersion: record.version, name: record.name, strategy, mode, status: "ready", createdAt: now, updatedAt: now, state: null }), storage);
}
export function checkpointPaperSession(id: string, state: PaperState | null, status: PaperSession["status"], storage: Storage = localStorage) {
  const session = readPaperSession(id, storage); if (!session) throw new Error("This paper session is no longer available in this browser.");
  return write({ ...session, state: state ? Checkpoint.parse(state) : null, status, updatedAt: Date.now() }, storage);
}
export function sessionStatus(session: PaperSession) {
  return session.status === "running" && Date.now() - session.updatedAt > 60_000 ? "paused" : session.status;
}
