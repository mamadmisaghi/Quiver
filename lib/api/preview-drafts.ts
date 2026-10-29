import * as C from "@/lib/contracts";
import { humanize } from "@/services/backend/src/engine/humanize";
import { strategyNodes } from "@/services/backend/src/engine/nodes";
import { MOCK_INSTRUMENTS, Registry } from "@/services/backend/src/venues/registry";
import { USER_ID } from "./fixtures";
import { randomHex } from "./live";
import { ApiErr, type Strategy, type StrategyRecord } from "./types";

const KEY = "quiver.preview.drafts.v1", registry = new Registry(MOCK_INSTRUMENTS);
export function previewDrafts(): StrategyRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.map((x) => C.StrategyRecord.safeParse(x)).flatMap((x) => x.success ? [x.data] : []) : [];
  } catch { return []; }
}

export function savePreviewDraft(raw: Strategy, forkedFrom: string | null = null): StrategyRecord {
  const strategy = C.Strategy.parse(raw), now = new Date().toISOString(), h = humanize(strategy, registry);
  const record = C.StrategyRecord.parse({ id: `stg_${randomHex(20)}`, ownerId: USER_ID, name: strategy.name, version: 1,
    status: "draft", strategy, humanized: h, nodes: strategyNodes(strategy, registry, h),
    issues: [], venues: [...new Set(strategy.actions.map((a) => registry.get(a.instrument)!.venue))], createdAt: now, updatedAt: now, activeRunId: null, forkedFrom });
  try { localStorage.setItem(KEY, JSON.stringify([record, ...previewDrafts()].slice(0, 50))); }
  catch { throw new ApiErr("internal", "This browser could not save the draft. Free some browser storage and try again.", 500); }
  return record;
}
