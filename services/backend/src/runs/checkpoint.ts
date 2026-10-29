import type { Executor, ApprovalRec } from "../sim/executor";
import type { PaperAccount, Pos } from "../sim/account";
import type { EngineState } from "../engine/engine";
import type { Snapshot } from "../engine/snapshot";

/** Versioned, JSON-only state captured between completed operations. Paper execution only. */
export interface RunCheckpoint {
  v: 1; lastSeq: number; strategyVersion: number;
  engine: EngineState;
  account: Pick<PaperAccount, "cash" | "realized" | "fees" | "dayKey" | "dayStartEquity" | "ordersToday"> & { positions: [string, Pos][] };
  halted: boolean; haltReason: string | null;
  processed: string[]; pending: Executor["pending"]; awaitingOpen: Executor["awaitingOpen"]; blockedFills: number; fills: Executor["fills"]; costs: Executor["costs"];
  fires: Executor["fires"]; lastSnap: Snapshot; approvals: [string, ApprovalRec][];
  lastTickSignals: [string, string][]; equity: [number, number][];
}

export function captureExecutor(ex: Executor): Omit<RunCheckpoint, "v" | "lastSeq" | "strategyVersion" | "equity"> {
  const a = ex.acct;
  return {
    engine: ex.st, account: { cash: a.cash, realized: a.realized, fees: a.fees, dayKey: a.dayKey, dayStartEquity: a.dayStartEquity, ordersToday: a.ordersToday, positions: [...a.positions] },
    halted: ex.halted, haltReason: ex.haltReason, processed: [...ex.processed], pending: ex.pending, awaitingOpen: ex.awaitingOpen, blockedFills: ex.blockedFills, fills: ex.fills,
    costs: ex.costs, fires: ex.fires, lastSnap: ex.lastSnap, approvals: [...ex.approvals], lastTickSignals: [...ex.lastTickSignals],
  };
}

export function restoreExecutor(ex: Executor, cp: RunCheckpoint) {
  // Checkpoints originate in our database. Corrupt/incompatible state fails startup instead of resetting money.
  if (cp.v !== 1 || !Number.isInteger(cp.lastSeq) || !Number.isFinite(cp.account?.cash) || !Number.isFinite(cp.account?.dayStartEquity) || !Array.isArray(cp.account?.positions) || !cp.engine?.triggers || !Array.isArray(cp.processed) || !Array.isArray(cp.equity)) throw new Error("Invalid paper-engine checkpoint");
  const cloned = JSON.parse(JSON.stringify(cp)) as RunCheckpoint;
  ex.st = cloned.engine;
  const { positions, ...account } = cloned.account;
  Object.assign(ex.acct, account); ex.acct.positions = new Map(positions);
  ex.halted = cloned.halted; ex.haltReason = cloned.haltReason; ex.processed = new Set(cloned.processed);
  ex.pending = cloned.pending; ex.awaitingOpen = cloned.awaitingOpen; ex.blockedFills = cloned.blockedFills; ex.fills = cloned.fills; ex.costs = cloned.costs; ex.fires = cloned.fires; ex.lastSnap = cloned.lastSnap;
  ex.approvals.clear(); for (const [id, rec] of cloned.approvals) ex.approvals.set(id, rec);
  ex.lastTickSignals = new Map(cloned.lastTickSignals);
}
