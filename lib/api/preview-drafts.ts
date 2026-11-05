import * as C from "@/lib/contracts";
import { previewRecord } from "@/lib/preview/records";
import { USER_ID } from "./fixtures";
import { randomHex } from "./live";
import { ApiErr, type Strategy, type StrategyRecord } from "./types";

const KEY = "quiver.preview.drafts.v1";
export function previewDrafts(): StrategyRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.map((x) => C.StrategyRecord.safeParse(x)).flatMap((x) => x.success ? [x.data] : []) : [];
  } catch { return []; }
}

export function cachePreviewDraft(record: StrategyRecord): StrategyRecord {
  const current = previewDrafts().filter((r) => r.id !== record.id);
  if (current.length >= 50) throw new ApiErr("conflict", "This browser has 50 drafts. Export a backup and remove an old draft before saving another.", 409);
  try { localStorage.setItem(KEY, JSON.stringify([record, ...current])); }
  catch { throw new ApiErr("internal", "This browser could not save the draft. Free some browser storage and try again.", 500); }
  return record;
}
export function savePreviewDraft(raw: Strategy, forkedFrom: string | null = null): StrategyRecord {
  return cachePreviewDraft(previewRecord(raw, `stg_${randomHex(20)}`, USER_ID, undefined, forkedFrom));
}
export function removePreviewDraft(id: string) {
  localStorage.setItem(KEY, JSON.stringify(previewDrafts().filter((r) => r.id !== id)));
}
