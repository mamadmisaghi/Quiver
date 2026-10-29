// M4.5 Autopilot — PAPER ONLY. Rotates through the user's own strategies on a schedule, one paper run at a time,
// with guardrails (drawdown, daily loss, rotation cap), a per-user kill switch, and the platform kill switch.
import { z } from "zod";
import { Decimal, EquityUsd, IsoTime, RunId, StrategyId } from "./common";

export const AutopilotGuardrails = z.object({
  maxDrawdownPct: z.number().min(1).max(50).default(10), // from the current run's peak equity → stop_and_flatten + disable
  maxDailyLossUsd: z.number().positive().max(100_000).default(500), // realized+unrealized across today's autopilot runs → disable
  maxRotationsPerDay: z.number().int().min(1).max(48).default(12), // UTC day; extra rotations are skipped (current run keeps going)
});
export const PutAutopilotReq = z.object({
  enabled: z.boolean(),
  mode: z.literal("paper").default("paper"), // anything else → 422; there is no testnet/live autopilot
  strategyIds: z.array(StrategyId).min(1).max(10).refine((a) => new Set(a).size === a.length, "duplicate strategyId"),
  rotateEveryMin: z.number().int().min(15).max(1440).default(60),
  startingEquityUsd: EquityUsd.default("10000"),
  guardrails: AutopilotGuardrails.default({ maxDrawdownPct: 10, maxDailyLossUsd: 500, maxRotationsPerDay: 12 }),
  approvalMode: z.enum(["auto", "confirm_each"]).default("auto"), // M4.5.1: passed to every run autopilot starts; confirm_each → orders wait in /approvals
  acknowledgeKill: z.boolean().default(false), // required (true) to re-enable after POST /autopilot/kill
});
export const AutopilotDecision = z.object({
  at: IsoTime, action: z.enum(["started", "rotated", "skipped", "guardrail_stop", "killed", "disabled", "start_failed"]),
  fromRunId: RunId.nullable(), toRunId: RunId.nullable(), strategyId: StrategyId.nullable(), reason: z.string(),
});
/** M4.6: names resolved at read time (strategy's current name; run → its strategy). null when the id is null/unknown. */
export const AutopilotDecisionView = AutopilotDecision.extend({ strategyName: z.string().nullable(), fromStrategyName: z.string().nullable(), toStrategyName: z.string().nullable() });
export const Autopilot = z.object({
  configured: z.boolean(), enabled: z.boolean(), killed: z.boolean(), mode: z.literal("paper"),
  strategyIds: z.array(StrategyId), rotateEveryMin: z.number().int(), approvalMode: z.enum(["auto", "confirm_each"]), startingEquityUsd: Decimal, guardrails: z.object({ maxDrawdownPct: z.number(), maxDailyLossUsd: z.number(), maxRotationsPerDay: z.number().int() }),
  state: z.object({ currentRunId: RunId.nullable(), currentStrategyId: StrategyId.nullable(), currentStrategyName: z.string().nullable(), nextRotationAt: IsoTime.nullable(), rotationsToday: z.number().int(), dayPnlUsd: Decimal, platformKillSwitch: z.boolean(), lastDecision: AutopilotDecisionView.nullable() }),
});
export const AutopilotLog = z.object({ items: z.array(AutopilotDecisionView), nextCursor: z.string().nullable() });
export const AUTOPILOT_STEP_SEC = 30;

/** M4.9.1: POST /autopilot/kill. 200 when every run stopped; 207 when some failed (each listed, the rest still stopped). */
export const AutopilotKillRes = Autopilot.extend({ kill: z.object({ stopped: z.number().int(), failed: z.array(z.object({ runId: RunId, reason: z.string() })) }) });

/** M5.4: streamed autopilot plan (paper). Scores the user's strategies on a recent backtest and proposes a PutAutopilotReq.
 * It never applies anything: the client shows the plan, then PUTs /autopilot if the user accepts. */
export const AutopilotPlanReq = z.object({
  strategyIds: z.array(StrategyId).min(1).max(10).refine((a) => new Set(a).size === a.length, "duplicate strategyId").optional(), // default: your newest 10
  goal: z.enum(["balanced", "return", "low_risk"]).default("balanced"),
  lookbackDays: z.union([z.literal(7), z.literal(30)]).default(7),
  startingEquityUsd: EquityUsd.default("10000"),
});
export const AutopilotPlanStatus = z.object({ stage: z.enum(["loading", "scoring", "ranking"]), message: z.string() });
export const AutopilotPlanCandidate = z.object({
  strategyId: StrategyId, name: z.string(), index: z.number().int(), total: z.number().int(), ok: z.boolean(), error: z.string().nullable(),
  metrics: z.object({ returnPct: Decimal, maxDrawdownPct: Decimal, sharpe: Decimal.nullable(), trades: z.number().int() }).nullable(), score: z.number().nullable(),
});
export const AutopilotPlan = z.object({
  goal: z.enum(["balanced", "return", "low_risk"]), lookbackDays: z.number().int(), ranked: z.array(AutopilotPlanCandidate), excluded: z.array(AutopilotPlanCandidate),
  proposal: PutAutopilotReq.nullable(), // null when nothing qualified; enabled is always false; the user flips it on
  rationale: z.array(z.string()), source: z.literal("deterministic"), synthetic: z.boolean(), notice: z.string(),
});
// SSE frames: event: status|candidate|plan|error, data: the schema above (error = {code, message}). The stream ends after plan or error.
