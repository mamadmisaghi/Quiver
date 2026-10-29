// MOCK M5.7 shareable replays (in-memory). Frozen snapshot = the M4 replay fixture; renderer is "stub" → not_configured.
import * as C from "@/lib/contracts";
import { ApiErr, type QuiverShareApi, type ReplayShareView } from "./types";
import runReplay from "./fixtures/m4/runs.replay.json";
const shares: ReplayShareView[] = [];
let n = 0;
const tok = () => "rpl_" + String(++n).padStart(32, "M");
const job = (spec: { aspect?: "9:16" | "16:9" | "1:1"; fps?: 24 | 30; durationSec?: number } | undefined) => {
  if (!spec) return { status: "none" as const, jobId: null, renderer: "stub", spec: null, requestedAt: null, finishedAt: null, videoUrl: null, posterUrl: null, error: null };
  const s = C.RenderSpec.parse(spec), [width, height] = s.aspect === "16:9" ? [1920, 1080] : s.aspect === "1:1" ? [1080, 1080] : [1080, 1920];
  return { status: "not_configured" as const, jobId: "rjb_mock" + n, renderer: "stub", spec: { ...s, width, height, totalFrames: s.fps * s.durationSec }, requestedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), videoUrl: null, posterUrl: null, error: "Video rendering isn't set up on this server yet." };
};
const clean = (t?: string) => (t ?? "").normalize("NFC").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
export const mockShare: QuiverShareApi = {
  async shareReplay(runId, b) {
    const r = C.CreateReplayShareReq.parse(b);
    if (shares.filter((x) => !x.revokedAt).length >= C.MAX_REPLAY_SHARES) throw new ApiErr("limit_exceeded", `Up to ${C.MAX_REPLAY_SHARES} shared replays. Revoke one first.`, 429);
    const x = C.ReplayShareView.parse({ token: tok(), path: "", runId, title: clean(r.title) ?? "Fed cut + NVDA dip replay", createdAt: new Date().toISOString(), revokedAt: null, frames: runReplay.totalFrames, digest: runReplay.digest, render: job(r.render) });
    x.path = `/v1/public/replays/${x.token}`; shares.unshift(x); return x;
  },
  async myReplays() { return C.ReplayShareList.parse({ items: shares }); },
  async renderReplay(t, b) {
    const x = shares.find((s) => s.token === t); if (!x) throw new ApiErr("not_found", "Replay not found.", 404);
    if (x.revokedAt) throw new ApiErr("conflict", "This replay link was revoked.", 409);
    x.render = C.RenderJob.parse(job(b)); return x.render;
  },
  async revokeReplay(t) { const x = shares.find((s) => s.token === t); if (!x) throw new ApiErr("not_found", "Replay not found.", 404); x.revokedAt ??= new Date().toISOString(); },
  async publicReplay(t) {
    const x = shares.find((s) => s.token === t);
    if (x?.revokedAt || (!x && !/^rpl_/.test(t))) throw new ApiErr("not_found", "Replay not found.", 404);
    const rep = { ...(runReplay as Record<string, unknown>) }; delete rep.runId;
    return C.PublicReplay.parse({ ...rep, token: x?.token ?? t, title: x?.title ?? "Fed cut + NVDA dip replay", handle: "@demo_marco", strategyName: "Fed cut + NVDA dip", mode: "paper", createdAt: x?.createdAt ?? "2026-10-27T15:46:00.000Z", render: { status: x?.render.status ?? "none", videoUrl: null, posterUrl: null } });
  },
};
