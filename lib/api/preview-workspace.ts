import {
  cachePreviewDraft,
  previewDrafts,
  removePreviewDraft,
  savePreviewDraft,
} from "./preview-drafts";
import { ApiErr, type Strategy, type StrategyRecord } from "./types";
import { previewRecord } from "@/lib/preview/records";

export type PreviewWorkspace = {
  aiAvailable: boolean;
  aiDailyLimitsEnabled?: boolean;
};
export async function getPreviewWorkspace(): Promise<PreviewWorkspace> {
  try {
    const response = await fetch("/api/preview/workspace", {
      cache: "no-store",
    });
    if (response.ok) return (await response.json()) as PreviewWorkspace;
  } catch {
    /* Local drafts also work offline. */
  }
  return { aiAvailable: false };
}
export async function listPreviewDrafts() {
  return previewDrafts();
}
export async function persistPreviewDraft(
  strategy: Strategy,
  forkedFrom: string | null = null,
) {
  return savePreviewDraft(strategy, forkedFrom);
}
export async function deletePreviewDraft(id: string) {
  removePreviewDraft(id);
}
export async function updatePreviewDraft(
  current: StrategyRecord,
  strategy: Strategy,
  expectedVersion: number,
) {
  const latest = previewDrafts().find((draft) => draft.id === current.id);
  if (
    !latest ||
    latest.version !== expectedVersion ||
    current.version !== expectedVersion
  )
    throw new ApiErr(
      "conflict",
      "This draft changed or was removed. Reload before saving.",
      409,
    );
  return cachePreviewDraft({
    ...previewRecord(
      strategy,
      current.id,
      current.ownerId,
      current.createdAt,
      current.forkedFrom,
    ),
    version: expectedVersion + 1,
    updatedAt: new Date().toISOString(),
  });
}
