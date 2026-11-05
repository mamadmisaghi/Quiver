import { z } from "zod";
import { IsoTime, Strategy as StrategySchema, StrategyId } from "@/lib/contracts";
import { previewRecord } from "@/lib/preview/records";
import { USER_ID } from "./fixtures";
import type { Strategy, StrategyRecord } from "./types";

const Backup = z.object({ format: z.literal("quiver-drafts"), version: z.literal(1), exportedAt: IsoTime,
  drafts: z.array(z.object({ id: StrategyId, strategy: StrategySchema, updatedAt: IsoTime })).max(50) });
export function draftBackup(records: StrategyRecord[]) {
  return Backup.parse({ format: "quiver-drafts", version: 1, exportedAt: new Date().toISOString(),
    drafts: records.map(({ id, strategy, updatedAt }) => ({ id, strategy, updatedAt })) });
}
export function parseDraftBackup(text: string) {
  if (new TextEncoder().encode(text).length > 1_000_000) throw new Error("Use a Quiver backup under 1 MB.");
  let data;
  try { data = Backup.parse(JSON.parse(text)); }
  catch { throw new Error("Use an exported Quiver draft backup (version 1, up to 50 drafts). No drafts were imported."); }
  // Validate every market/rule before the first write, and ignore exported ownership or execution state.
  for (const d of data.drafts) previewRecord(d.strategy, d.id, USER_ID, d.updatedAt);
  return data.drafts;
}
export const draftFingerprint = (strategy: Strategy) => JSON.stringify(StrategySchema.parse(strategy));
