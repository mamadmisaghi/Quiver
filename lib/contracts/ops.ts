// M3.7 operator routes (/v1/ops/*). Enabled only when OPS_TOKEN is set; auth = "Authorization: Bearer <OPS_TOKEN>".
// Run list/stop is additionally refused (404) when NODE_ENV=production or QUIVR_MODE=mainnet; paper/testnet runs only.
import { z } from "zod";
import { IsoTime, WarmupNotice } from "./common";
import { Run } from "./api";

export const OpsShutdownRes = z.object({ ok: z.literal(true), shuttingDown: z.literal(true), activeRuns: z.number().int().min(0) });
export const OpsRunsQuery = z.object({ status: z.enum(["active", "all"]).default("active") });
export const OpsRun = Run.extend({ ownerId: z.string(), ownerLabel: z.string().nullable() });
export const OpsRunsRes = z.object({ items: z.array(OpsRun), asOf: IsoTime });
export const OpsStopRes = z.object({ run: OpsRun, alreadyStopped: z.boolean() });

// M5.22 (Slice A): machine-readable warmup. Clients branch on `warmup` / `code`, never on message text.
export const WarmupState = z.enum(["warming", "ready", "partial", "timeout", "off"]);
/** GET /v1/health (public, no auth). Always 200 once the process listens. */
export const HealthRes = z.object({
  ok: z.literal(true),
  /** false only while state = "warming". */
  ready: z.boolean(),
  warmup: z.object({ state: WarmupState, startedAt: IsoTime.nullable(), finishedAt: IsoTime.nullable(), errors: z.number().int().min(0), message: z.string().nullable() }),
  /** Same object as history/backtest `warmupNotice`; null when not warming. */
  notice: WarmupNotice.nullable(),
}).strict();
export type HealthRes = z.infer<typeof HealthRes>;
