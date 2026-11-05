import { z } from "zod";
import { Strategy } from "../../contracts/src/strategy";
import { BacktestRes } from "../../contracts/src/api";
import { PaperQuote } from "./paper";
import { ActivityRow, fillNote, type ActivityNote } from "./observations";

const number = z.number().finite(),
  positive = number.nonnegative();
const dict = <T extends z.ZodType>(value: T) => z.record(z.string(), value);
export const Checkpoint = z.object({
  readings: dict(z.union([number, z.boolean(), z.null()])).optional(),
  checks: dict(
    z.object({ met: positive, total: positive, unknown: positive, result: z.boolean().nullable() }),
  ).optional(),
  version: z.literal(1),
  startedAt: number,
  lastAt: number,
  budget: positive,
  principal: number,
  pools: dict(number),
  positions: dict(
    z.object({
      assetId: z.string(),
      qty: positive,
      baseQty: positive,
      entry: positive,
      margin: positive,
      entryFee: positive,
      side: z.union([z.literal(1), z.literal(-1)]),
      leverage: positive,
      openedAt: number,
      peakPct: number,
      rungs: z.array(number),
      allocation: z.array(z.object({ source: z.string(), value: number })),
    }),
  ),
  stages: dict(
    z.object({
      fills: positive,
      lastFillAt: number.nullable(),
      active: z.boolean(),
      latched: z.boolean(),
      closed: z.boolean(),
      resolved: z.boolean(),
      realized: number,
      status: z.string(),
      consumedDependency: z.string().optional(),
    }),
  ),
  anchors: dict(number),
  history: dict(z.array(z.tuple([number, number]))),
  previous: dict(z.union([number, z.boolean(), z.null()])),
  quotes: dict(PaperQuote),
  fees: positive,
  realized: number,
  day: z.string(),
  dayStart: number,
  dayOrders: positive,
  events: z.array(
    z.object({
      at: number,
      stageId: z.string(),
      kind: z.enum(["buy", "sell", "exit", "settle"]),
      amount: number,
      price: number,
      fee: number,
      detail: z.string(),
    }),
  ),
  curve: z.array(z.tuple([number, number])),
});
export const PaperSessionSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^(?:paper|srvpaper)_[a-zA-Z0-9-]+$/),
  strategyId: z.string(),
  strategyVersion: z.number().int().positive(),
  name: z.string(),
  strategy: Strategy,
  mode: z.enum(["scenario", "quotes"]),
  status: z.enum(["ready", "running", "paused", "completed"]),
  createdAt: number,
  updatedAt: number,
  state: Checkpoint.nullable(),
  activity: z.array(ActivityRow).max(100).optional(),
  editRevision: z.number().int().nonnegative().optional(),
  rulesChangedAt: number.optional(),
  pausedRules: z.array(z.string()).optional(),
  provenance: z.enum(["server", "imported"]).optional(),
  controlVersion: z.number().int().nonnegative().optional(),
  activeMs: positive.optional(), // Time accrued through updatedAt. Older records have no measured duration.
  startingBalance: z.number().finite().positive().optional(),
  legacyResult: BacktestRes.optional(),
});
export type PaperSession = z.infer<typeof PaperSessionSchema>;

// Consecutive identical polls share one row. Intervening quotes, fills or edits always keep their place.
function compactChecks(rows: ActivityRow[]) {
  const out: ActivityRow[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (
      last &&
      row.kind === "check" &&
      last.kind === "check" &&
      row.label === last.label &&
      row.detail === last.detail
    ) {
      out[out.length - 1] = {
        ...last,
        at: row.at,
        since: last.since ?? last.at,
        count: (last.count ?? 1) + (row.count ?? 1),
      };
    } else out.push(row);
  }
  return out.slice(-100);
}
/** Project only history that older checkpoints actually recorded. */
export function sessionActivity(session: PaperSession): ActivityRow[] {
  if (session.activity) return compactChecks(session.activity);
  const notes: ActivityNote[] = [
    { at: session.createdAt, kind: "session", label: "Session created", detail: session.name },
  ];
  if (session.strategy.workflow)
    for (const fill of session.state?.events ?? []) notes.push(fillNote(session.strategy.workflow, fill));
  if (session.state && session.state.lastAt >= session.state.startedAt) {
    notes.push({
      at: session.state.lastAt,
      kind: "check",
      label: "Last recorded check",
      detail: "Restored from this session’s saved observations.",
    });
  }
  if (session.status === "paused")
    notes.push({
      at: session.updatedAt,
      kind: "session",
      label: "Session paused",
      detail: "Observation paused in this browser.",
    });
  return notes
    .sort((a, b) => a.at - b.at)
    .map((row, seq) => ({ ...row, seq }))
    .slice(-100);
}
export function appendActivity(session: PaperSession, notes: ActivityNote[]) {
  const rows = sessionActivity(session);
  let seq = rows.at(-1)?.seq ?? 0;
  return compactChecks([...rows, ...notes.map((row) => ({ ...row, seq: ++seq }))]);
}
/** Count an interval exactly once, only while a driver owns this session. */
export function activeSessionMs(session: PaperSession, now: number, observing: boolean) {
  const measured = session.activeMs ?? 0;
  return (
    measured +
    (observing && session.activeMs !== undefined && session.status === "running"
      ? Math.max(0, now - session.updatedAt)
      : 0)
  );
}
