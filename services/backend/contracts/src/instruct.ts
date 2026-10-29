// M4.9 — natural-language instructions for a running paper strategy, compiled to a closed, bounded diff.
// Prompt-injection safety: the model (or the demo parser) can only emit InstructOps. Every op is strict, references
// existing local ids, carries bounded numbers/enums only (no free text reaches the strategy), and the result is
// re-validated with the same validateStrategy + risk caps as POST /strategies before anything is applied.
import { z } from "zod";
import { Decimal, IsoTime, RunId, StrategyId } from "./common";
import { ValidationIssue } from "./strategy";

const LocalId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const Pct = (max: number) => z.number().gt(0).max(max);
export const InstructOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_size"), actionId: LocalId, size: z.object({ unit: z.enum(["usd", "pct_equity"]), value: Decimal }).strict() }).strict(),
  z.object({ op: z.literal("set_leverage"), actionId: LocalId, leverage: z.number().min(1).max(10) }).strict(),
  z.object({ op: z.literal("set_exits"), actionId: LocalId, takeProfitPct: Pct(1000).optional(), stopLossPct: Pct(100).optional(), trailingStopPct: Pct(100).optional(), timeExitHours: z.number().min(1).max(8760).optional() }).strict()
    .refine((x) => x.takeProfitPct != null || x.stopLossPct != null || x.trailingStopPct != null || x.timeExitHours != null, "set_exits needs at least one exit"),
  /** "Pause a rule": removes the trigger and the actions that only it fires (a new strategy version; earlier versions keep it). */
  z.object({ op: z.literal("pause_rule"), triggerId: LocalId }).strict(),
  z.object({ op: z.literal("set_cooldown"), triggerId: LocalId, minutes: z.number().min(0).max(43_200) }).strict(),
  z.object({ op: z.literal("set_risk"), field: z.enum(["maxPositionPct", "maxTotalExposurePct", "maxDailyLossPct", "maxOrdersPerDay"]), value: z.number().min(1).max(500) }).strict(),
]);
export type InstructOp = z.infer<typeof InstructOp>;
/** What the compiler must return (LLM structured output schema). */
export const InstructDiff = z.object({ ops: z.array(InstructOp).min(1).max(8) }).strict();

export const InstructReq = z.object({ text: z.string().trim().min(3).max(500) }).strict();
export const InstructChange = z.object({ path: z.string(), before: z.unknown(), after: z.unknown(), summary: z.string() });
export const InstructProposal = z.object({
  id: z.string().regex(/^ins_[0-9A-Z]{20}$/), runId: RunId, strategyId: StrategyId, baseVersion: z.number().int().min(1),
  text: z.string(), ops: z.array(InstructOp), changes: z.array(InstructChange), issues: z.array(ValidationIssue),
  ok: z.boolean(), // false = the diffed strategy has validation errors; apply will refuse
  compiler: z.enum(["ai", "demo"]), notice: z.string().nullable(),
  status: z.enum(["proposed", "applied", "expired", "superseded"]),
  createdAt: IsoTime, expiresAt: IsoTime, appliedAt: IsoTime.nullable(), appliedVersion: z.number().int().nullable(),
});
export const InstructApplyRes = z.object({ proposal: InstructProposal, strategyVersion: z.number().int(), runId: RunId });
