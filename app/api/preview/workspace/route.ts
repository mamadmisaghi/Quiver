import { StrategyRecord, UpdateStrategyReq } from "@/lib/contracts";
import type { StrategyRecord as RecordData } from "@/lib/api/types";
import { previewRecord } from "@/lib/preview/records";
import { previewAiEnabled, previewPublicAiEnabled, previewDatabase, previewJson, previewOwner, readPreviewBody, sameOrigin } from "@/lib/preview/server";
import { readOnlineDrafts, removeOnlineDraft, writeOnlineDraft, replaceOnlineDraft } from "@/lib/preview/storage";

export async function GET(request: Request) {
  const owner = previewOwner(request);
  if (!owner) return previewJson({ authenticated: false, cloudAvailable: false, aiAvailable: previewPublicAiEnabled(), aiConfigured: previewAiEnabled(), items: [] });
  try {
    const db = await previewDatabase();
    const items = await readOnlineDrafts(db, owner);
    return previewJson({ authenticated: true, cloudAvailable: true, aiAvailable: previewAiEnabled(), aiConfigured: previewAiEnabled(), items });
  } catch { return previewJson({ authenticated: true, cloudAvailable: false, aiAvailable: false, items: [], message: "Online storage is unavailable. Your browser drafts are still available; export a backup and try again." }, 503); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return previewJson({ message: "Save drafts from the Quiver website." }, 403);
  const owner = previewOwner(request); if (!owner) return previewJson({ message: "Sign in with ChatGPT to save online." }, 401);
  let incoming: RecordData;
  try { incoming = StrategyRecord.parse(await readPreviewBody(request, 64_000)); }
  catch (e) { return previewJson({ message: e instanceof RangeError ? "That draft is too large." : "Send a valid Quiver draft." }, e instanceof RangeError ? 413 : 422); }
  let record: RecordData;
  try {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(owner));
    const uid = "usr_" + Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
    record = previewRecord(incoming.strategy, incoming.id, uid, incoming.createdAt, incoming.forkedFrom ?? null);
    record.version = incoming.version; record.updatedAt = new Date().toISOString();
  } catch { return previewJson({ message: "Fix the draft's markets, rules and risk limits before saving." }, 422); }
  try {
    const db = await previewDatabase();
    const current = (await readOnlineDrafts(db, owner)).find((r) => r.id === record.id);
    if (current) {
      if (JSON.stringify(current.strategy) === JSON.stringify(record.strategy)) return previewJson(current);
      return previewJson({ message: "This draft already has an online version. Reload it before editing; the online copy was not overwritten." }, 409);
    }
    if (!await writeOnlineDraft(db, owner, record, true)) return previewJson({ message: "The workspace is full or this draft was saved in another tab. Reload before retrying." }, 409);
    return previewJson(record);
  } catch { return previewJson({ message: "The online copy could not be saved. Export your browser backup and try again." }, 503); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return previewJson({ message: "Use the Quiver website." }, 403);
  const owner = previewOwner(request); if (!owner) return previewJson({ message: "Sign in to update your online draft." }, 401);
  try {
    const body = UpdateStrategyReq.extend({ id: StrategyRecord.shape.id }).parse(await readPreviewBody(request, 64_000));
    const db = await previewDatabase();
    const current = (await readOnlineDrafts(db, owner)).find((r) => r.id === body.id);
    if (!current) return previewJson({ message: "That draft was not found in your workspace." }, 404);
    if (current.version !== body.expectedVersion) return previewJson({ message: "This draft changed in another tab. Reload and try again." }, 409);
    const next = { ...previewRecord(body.strategy, current.id, current.ownerId, current.createdAt, current.forkedFrom), version: current.version + 1, updatedAt: new Date().toISOString() };
    if (!await replaceOnlineDraft(db, owner, next, body.expectedVersion)) return previewJson({ message: "This draft changed in another tab. Reload and try again." }, 409);
    return previewJson(next);
  } catch { return previewJson({ message: "Could not save valid changes. Check the values and retry." }, 422); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return previewJson({ message: "Use the Quiver website." }, 403);
  const owner = previewOwner(request); if (!owner) return previewJson({ message: "Sign in first." }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^stg_[A-Za-z0-9_-]{6,64}$/.test(id)) return previewJson({ message: "Choose a valid draft." }, 422);
  try { await removeOnlineDraft(await previewDatabase(), owner, id); return previewJson({ deleted: true }); }
  catch { return previewJson({ message: "Could not delete the online draft. Try again." }, 503); }
}
