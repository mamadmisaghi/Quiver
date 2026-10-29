// M5.3: write off a stuck paper position (zero recovery). Paper only.
import { z } from "zod";
import { RunId } from "./common";
import { InstrumentId } from "./strategy";

export const StuckReason = z.enum(["no_price", "price_stale", "venue_down", "close_rejected"]);
export const WriteOffPreviewRes = z.object({
  runId: RunId, instrument: z.string(), eligible: z.boolean(), reasons: z.array(StuckReason), message: z.string(),
  position: z.object({ qty: z.string(), avgEntry: z.string(), kind: z.string() }).nullable(),
  basis: z.literal("zero_recovery"), lossUsd: z.string().nullable(),
});
export const WriteOffReq = z.object({ instrument: InstrumentId, confirm: z.literal(true) });
export const WriteOffRes = z.object({ runId: RunId, instrument: z.string(), writtenOff: z.literal(true), reasons: z.array(StuckReason), qty: z.string(), avgEntry: z.string(), lossUsd: z.string(), basis: z.literal("zero_recovery"), at: z.string() });
