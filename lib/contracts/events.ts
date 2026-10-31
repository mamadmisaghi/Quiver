// Live run event stream. Transport: SSE (canonical GET /v1/runs/:runId/events/stream?ticket=…; alias GET /v1/runs/:runId/events?ticket=…). Every frame: `id: <seq>`, `event: <type>`, `data: <JSON RunEvent>`.
import { z } from "zod";
import { Decimal, FillId, SignalSource, IsoTime, OrderId, RunId, RunMode, TxHash, Venue } from "./common";
import { Humanized, InstrumentId, Strategy, ValidationIssue } from "./strategy";

const Base = {
  v: z.literal(1),
  seq: z.number().int().nonnegative(), // monotonic per run; resume with Last-Event-ID
  runId: RunId,
  mode: RunMode,
  ts: IsoTime, // server time the event was produced
};

export const SignalValue = z.object({
  signalId: z.string(),
  field: z.string(), // "value" | "sma" | "odds" | "state" ...
  value: z.union([z.number(), z.string(), z.boolean(), z.null()]), // null = unknown (stale beyond maxAgeSeconds)
  observedAt: IsoTime, // source timestamp, not ingestion time
  source: SignalSource, // M3.2: PriceSource enum (indicators carry their input price source) or calendar | timer | portfolio
  stale: z.boolean(),
  /** Why the value is stale: market_closed = last close carried while NYSE is closed (value usable for display, orders blocked);
   *  no_data = no value within maxAgeSeconds (value is null). Absent when fresh. */
  staleReason: z.enum(["market_closed", "no_data"]).optional(),
});

export const TriggerState = z.enum(["ready", "holding", "cooldown", "done", "blocked"]);

/** M4.7: one trigger's live state (tick.triggers, triggers_snapshot, Run.triggerStates). */
export const TriggerStateItem = z.object({ triggerId: z.string(), state: TriggerState, conditionTrue: z.boolean().nullable(), heldForSec: z.number().nonnegative(), cooldownUntil: IsoTime.nullable(), fires: z.number().int() });

export const RunEvent = z.discriminatedUnion("type", [
  z.object({ ...Base, type: z.literal("status"), status: z.enum(["starting", "running", "paused", "stopped", "halted"]), reason: z.string().optional() }),
  /** One evaluation cycle. `signals` contains only values that changed since the previous tick (full snapshot on seq 0 / resume). */
  z.object({ ...Base, type: z.literal("tick"), cycle: z.number().int(), signals: z.array(SignalValue), triggers: z.array(TriggerStateItem) }),
  /** M4.7: sent (without an SSE id) right after connect/resume, after the status snapshot: current state of every trigger. Same item shape as tick.triggers and GET /runs/:id triggerStates. */
  z.object({ ...Base, type: z.literal("triggers_snapshot"), cycle: z.number().int(), triggers: z.array(TriggerStateItem) }),
  /** Condition became true (rising edge). If forMinutes > 0 the trigger is now "holding"; it fires when held. */
  z.object({ ...Base, type: z.literal("trigger_met"), triggerId: z.string(), forMinutes: z.number(), holdUntil: IsoTime.nullable(), path: z.array(z.string()) /* node ids that made it true, for edge highlighting */ }),
  z.object({ ...Base, type: z.literal("trigger_fired"), triggerId: z.string(), fireIndex: z.number().int(), actionIds: z.array(z.string()), intentIds: z.array(OrderId) }),
  /** Order intent after the risk check, before routing (paper: before the simulator). */
  z.object({ ...Base, type: z.literal("intent"), orderId: OrderId, actionId: z.string(), instrument: InstrumentId, venue: Venue, side: z.enum(["buy", "sell", "long", "short"]), notionalUsd: Decimal, maxSlippageBps: z.number().int() }),
  z.object({ ...Base, type: z.literal("rejected"), orderId: OrderId, code: z.string(), message: z.string() }),
  z.object({
    ...Base, type: z.literal("fill"), fillId: FillId, orderId: OrderId, actionId: z.string(), instrument: InstrumentId, venue: Venue,
    side: z.enum(["buy", "sell", "long", "short"]), qty: Decimal, price: Decimal, notionalUsd: Decimal, feeUsd: Decimal,
    slippageBps: z.number(), // realized vs reference price
    referencePrice: Decimal, referenceSource: z.string(),
    simulated: z.boolean(), // true for paper
    txHash: TxHash.nullable(), explorerUrl: z.string().url().nullable(),
    position: z.object({ qty: Decimal, avgEntry: Decimal, unrealizedPnlUsd: Decimal }),
  }),
  /** M4.2 approval-required run: an opening order passed the risk gate and now waits for the user (no intent yet). */
  z.object({ ...Base, type: z.literal("approval_requested"), approvalId: z.string(), orderId: OrderId, actionId: z.string(), strategyName: z.string(), actionTitle: z.string() /* M4.7 */, instrument: InstrumentId, venue: Venue, side: z.enum(["buy", "sell", "long", "short"]), notionalUsd: Decimal, expiresAt: IsoTime }),
  /** approved → an intent/fill (or rejected) with the same orderId follows immediately. */
  z.object({ ...Base, type: z.literal("approval_resolved"), approvalId: z.string(), orderId: OrderId, decision: z.enum(["approved", "rejected", "expired", "canceled"]) }),
  z.object({ ...Base, type: z.literal("warning"), code: z.string(), message: z.string(), signalId: z.string().optional() }),
  z.object({ ...Base, type: z.literal("error"), code: z.string(), message: z.string(), retryable: z.boolean(), orderId: OrderId.optional() }),
  /** Risk breach: engine stops opening positions. Existing positions are kept unless `flattened` is true. Only the user can resume. */
  z.object({ ...Base, type: z.literal("risk_halt"), rule: z.enum(["max_daily_loss", "max_orders_per_day", "max_total_exposure", "session_key_cap", "session_key_expired", "session_key_revoked", "oracle_sequencer_down", "geo_block", "kill_switch"]), observed: Decimal.nullable(), limit: Decimal.nullable(), flattened: z.boolean(), message: z.string() }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

/** SSE control frames. They are NOT part of the run log: no `seq`/`id`, never replayed, not returned by the polling route. */
export const HeartbeatFrame = z.object({ type: z.literal("heartbeat"), ts: IsoTime, lastSeq: z.number().int().min(-1) }); // sent only when idle for SSE_HEARTBEAT_MS (15s); show "Offline" after 45s silence
export const ResyncFrame = z.object({ type: z.literal("resync"), reason: z.literal("slow_consumer"), lastSeq: z.number().int().min(-1), reconnectWithLastEventId: z.literal(true) }); // server closes after this; reconnect with Last-Event-ID = lastSeq
/** Everything that can arrive on the run SSE stream (`event:` name equals `type`). Use this to parse frames. */
export const RunStreamFrame = z.union([RunEvent, HeartbeatFrame, ResyncFrame]);
export type RunStreamFrame = z.infer<typeof RunStreamFrame>;
export type RunEventType = RunEvent["type"];

/** Compile stream (POST /v1/compile, NDJSON). One JSON object per line. */
export const CompileEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), step: z.enum(["reading", "resolving_markets", "choosing_feeds", "writing_rules", "checking_risk", "repairing"]), label: z.string(), attempt: z.number().int().min(1) }),
  z.object({ type: z.literal("partial"), node: z.object({ id: z.string(), kind: z.enum(["watch", "when", "do", "exit"]), title: z.string(), detail: z.string(), venue: Venue.optional() }) }),
  z.object({ type: z.literal("result"), compileId: z.string(), strategy: Strategy, humanized: Humanized, issues: z.array(ValidationIssue), usage: z.object({ attempts: z.number().int(), inputTokens: z.number().int(), outputTokens: z.number().int(), costUsd: Decimal }),
    /** "demo" = deterministic keyword compiler (no AI key, or AI failed/timed out); show a "Demo compile" label with `notice`. */
    compiler: z.enum(["ai", "demo", "rules"]).default("ai"), notice: z.string().nullable().default(null) }),
  /** code: unsupported_prompt (demo compiler couldn't map the idea; show `suggestions` as clickable examples) | compile_failed | compile_cost_cap | ... */
  z.object({ type: z.literal("error"), code: z.string(), message: z.string(), suggestions: z.array(z.string()).optional() }),
]);
export type CompileEvent = z.infer<typeof CompileEvent>;
