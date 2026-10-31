import { StrategyRecord as RecordSchema } from "@/lib/contracts";
import { cachePreviewDraft, previewDrafts, removePreviewDraft, savePreviewDraft } from "./preview-drafts";
import { ApiErr, type Strategy, type StrategyRecord } from "./types";
import { previewRecord } from "@/lib/preview/records";

export type PreviewWorkspace = { authenticated: boolean; cloudAvailable: boolean; aiAvailable: boolean; aiConfigured?: boolean; items: StrategyRecord[]; message?: string };
const empty: PreviewWorkspace = { authenticated: false, cloudAvailable: false, aiAvailable: false, items: [] };
let cloud: StrategyRecord[] = [], lastLocation: "online" | "browser" = "browser";
export const previewSaveLocation = () => lastLocation;
export async function getPreviewWorkspace(): Promise<PreviewWorkspace> {
  try {
    const r = await fetch("/api/preview/workspace", { cache: "no-store" });
    const data = await r.json() as PreviewWorkspace;
    cloud = Array.isArray(data.items) ? data.items.map((v) => RecordSchema.parse(v)) : [];
    return { ...empty, ...data, items: cloud };
  } catch { return { ...empty, message: "Online storage could not be reached. Browser drafts are still available; export a backup." }; }
}
export function mergePreviewDrafts(local: StrategyRecord[], online: StrategyRecord[]) {
  // Prefer the server's canonical representation of records that are present in both places.
  return [...new Map([...local, ...online].map((r) => [r.id, r])).values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function listPreviewDrafts() {
  const workspace = await getPreviewWorkspace();
  return mergePreviewDrafts(previewDrafts(), workspace.items);
}
export async function persistPreviewDraft(strategy: Strategy, forkedFrom: string | null = null) {
  const record = savePreviewDraft(strategy, forkedFrom); lastLocation = "browser";
  return uploadPreviewDraft(record);
}
export async function uploadPreviewDraft(record: StrategyRecord) {
  lastLocation = "browser";
  let response: Response;
  try { response = await fetch("/api/preview/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record) }); }
  catch { return record; }
  if (response.status === 401) return record;
  const data: unknown = await response.json().catch(() => null);
  const message = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "The online copy failed. Export a backup and try again.";
  if (!response.ok) throw new ApiErr("internal", `Saved in this browser. ${message}`, response.status);
  const saved = RecordSchema.parse(data); cloud = mergePreviewDrafts(cloud, [saved]); lastLocation = "online";
  cachePreviewDraft(saved); return saved;
}
export async function deletePreviewDraft(id: string) {
  const r = await fetch(`/api/preview/workspace?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok && r.status !== 401) throw new Error("The online draft could not be removed. Try again.");
  removePreviewDraft(id); cloud = cloud.filter((v) => v.id !== id);
}

export async function updatePreviewDraft(current: StrategyRecord, strategy: Strategy, expectedVersion: number) {
  if (current.version !== expectedVersion) throw new ApiErr("conflict", "This draft changed. Reload before saving.", 409);
  const record = { ...previewRecord(strategy, current.id, current.ownerId, current.createdAt, current.forkedFrom), version: expectedVersion + 1, updatedAt: new Date().toISOString() };
  // Only an already-online record uses the compare-and-swap endpoint. New/browser/example drafts are saved with the same id.
  const online = cloud.some((r) => r.id === current.id);
  if (!online) { cachePreviewDraft(record); return uploadPreviewDraft(record); }
  const response = await fetch("/api/preview/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: current.id, strategy, expectedVersion }) });
  const data = await response.json() as { message?: string };
  if (!response.ok) throw new ApiErr(response.status === 409 ? "conflict" : "internal", data.message ?? "Could not save the change. Reload and retry.", response.status);
  const saved = RecordSchema.parse(data); cachePreviewDraft(saved); cloud = mergePreviewDrafts(cloud, [saved]); lastLocation = "online"; return saved;
}
