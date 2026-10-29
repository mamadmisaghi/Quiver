// M5.7 Shareable video replays: an immutable, public snapshot of a run replay plus a render job (renderer is a stub).
import { z } from "zod";
import { IsoTime, RunId } from "./common";
import { Replay } from "./api";

export const ReplayShareToken = z.string().regex(/^rpl_[A-Za-z0-9_-]{32}$/);
export const ReplayAspect = z.enum(["9:16", "16:9", "1:1"]);
// M5.15: absolute URL (external renderer) or our own same-origin media path (local ffmpeg renderer).
export const MediaUrl = z.union([z.string().url(), z.string().regex(/^\/v1\/public\/replays\/rpl_[A-Za-z0-9_-]{32}\/(video\.mp4|poster\.png)$/)]);
export const RenderStatus = z.enum(["none", "queued", "rendering", "done", "failed", "not_configured"]);
export const RenderSpec = z.object({ aspect: ReplayAspect.default("9:16"), fps: z.union([z.literal(24), z.literal(30)]).default(30), durationSec: z.number().int().min(5).max(60).default(20) });
/** POST /v1/runs/:id/replay/share (paper/testnet runs only). Frames are frozen at creation. */
export const CreateReplayShareReq = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  frameMs: z.number().int().min(1000).max(86_400_000).default(60_000), maxFrames: z.number().int().min(10).max(500).default(300),
  from: IsoTime.optional(), to: IsoTime.optional(),
  render: RenderSpec.optional(), // present = queue a render job right away
});
export const RenderJob = z.object({
  status: RenderStatus, jobId: z.string().nullable(), renderer: z.string(), spec: RenderSpec.extend({ width: z.number().int(), height: z.number().int(), totalFrames: z.number().int() }).nullable(),
  requestedAt: IsoTime.nullable(), finishedAt: IsoTime.nullable(), videoUrl: MediaUrl.nullable(), posterUrl: MediaUrl.nullable(), error: z.string().nullable(),
});
/** POST /v1/replays/:token/render body. 409 while a job is queued/rendering. */
export const RenderReq = RenderSpec;
export const ReplayShareView = z.object({ token: ReplayShareToken, path: z.string(), runId: RunId, title: z.string(), createdAt: IsoTime, revokedAt: IsoTime.nullable(), frames: z.number().int(), digest: z.string(), render: RenderJob });
export const ReplayShareList = z.object({ items: z.array(ReplayShareView) });
/** GET /v1/public/replays/:token (no auth, noindex). No run id, owner id, or account data beyond the frozen replay. */
export const PublicReplay = Replay.omit({ runId: true }).extend({
  token: ReplayShareToken, title: z.string(), handle: z.string(), strategyName: z.string(), mode: z.enum(["paper", "testnet"]), createdAt: IsoTime,
  render: RenderJob.pick({ status: true, videoUrl: true, posterUrl: true }),
});
export const MAX_REPLAY_SHARES = 20;
