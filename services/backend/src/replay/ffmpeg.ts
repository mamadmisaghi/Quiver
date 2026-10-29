// M5.15 local ffmpeg replay renderer (opt-in: REPLAY_RENDERER=ffmpeg). Draws an equity-line chart per replay frame
// in-process (raw RGB, small internal canvas) and pipes it to a local ffmpeg binary, which scales and encodes H.264.
// Safety: spawn with a fixed argv (no shell), empty env, fixed output dir, names derived only from validated ids,
// a wall-clock kill timer, an ffmpeg -fs size cap plus a post-check, one job at a time.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, statSync, renameSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ReplayRenderer, RenderInput, RenderOut } from "./render";

export interface FfmpegOpts { bin: string; dir: string; maxSec: number; maxBytes: number; spawnFn?: typeof spawn }
const SAFE = /^[A-Za-z0-9_-]{8,80}$/;
export const renderPaths = (dir: string, token: string) => {
  if (!SAFE.test(token)) throw new Error("bad token");
  const d = join(resolve(dir), token); return { d, video: join(d, "video.mp4"), poster: join(d, "poster.png") };
};
export const removeRender = (dir: string, token: string) => { try { rmSync(renderPaths(dir, token).d, { recursive: true, force: true }); } catch { /* best effort */ } };

const IW = 180; // internal canvas width; height follows the aspect ratio, ffmpeg scales up
/** M5.20: bounded memory. Internal height ≤ MAX_IH, at most MAX_FRAMES frames (equity is downsampled), and frames are
 *  generated lazily one at a time (≈ IW×MAX_IH×3 ≈ 173 KB each), so memory is bounded and flat in the input length.
 *  Measured process peak (heap + arrayBuffers, 1080×1920, Robin M5.20 gate) is about 52–71 MB, mostly frame copies awaiting GC; was ~150–450 MB. */
export const MAX_IH = 320, MAX_FRAMES = 900;
export const frameDims = (w: number, h: number) => ({ iw: IW, ih: Math.min(MAX_IH, Math.max(2, Math.round((IW * h) / Math.max(1, w) / 2) * 2)) });
export const capFrames = (eq: (number | null)[]) => eq.length <= MAX_FRAMES ? eq : Array.from({ length: MAX_FRAMES }, (_, i) => eq[Math.round((i * (eq.length - 1)) / (MAX_FRAMES - 1))]);
export function* frameIter(eq0: (number | null)[], w: number, h: number, only?: "last"): Generator<Buffer> {
  const eq = capFrames(eq0); const { ih } = frameDims(w, h); const vals = eq.filter((v): v is number => v != null);
  let lo = 0, hi = 1; if (vals.length) { lo = Infinity; hi = -Infinity; for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  const span = hi - lo || 1; const n = Math.max(1, eq.length); const ys = eq.map((v) => v == null ? null : Math.round(ih * 0.8 - ((v - lo) / span) * ih * 0.6));
  const up = (vals.at(-1) ?? 0) >= (vals[0] ?? 0);
  const b = Buffer.alloc(IW * ih * 3); for (let p = 0; p < b.length; p += 3) { b[p] = 12; b[p + 1] = 14; b[p + 2] = 22; }
  const px = (x: number, y: number, r: number, g: number, bl: number) => { if (x < 0 || y < 0 || x >= IW || y >= ih) return; const o = (y * IW + x) * 3; b[o] = r; b[o + 1] = g; b[o + 2] = bl; };
  // Each frame only adds the next point and extends the progress bar, so one canvas is drawn incrementally.
  for (let i = 0; i < n; i++) {
    const y = ys[i]; if (y != null) { const x = Math.round((i / Math.max(1, n - 1)) * (IW - 1)); for (let t = -1; t <= 1; t++) px(x, y + t, up ? 60 : 230, up ? 220 : 70, up ? 120 : 70); }
    const bar = Math.round(((i + 1) / n) * IW); for (let x = 0; x < bar; x++) for (let yy = ih - 4; yy < ih - 1; yy++) px(x, yy, 120, 140, 255);
    if (!only || i === n - 1) yield Buffer.from(b); // copy: the consumer may hold it while we draw the next one
  }
}
/** Kept for callers/tests; materializes the (capped) frames. Prefer frameIter for rendering. */
export function drawFrames(eq: (number | null)[], w: number, h: number): Buffer[] { return [...frameIter(eq, w, h)]; }

function run(o: FfmpegOpts, args: string[], input: Iterable<Buffer>, deadline: number): Promise<void> {
  return new Promise((res, rej) => {
    const p = (o.spawnFn ?? spawn)(o.bin, args, { shell: false, env: {}, stdio: ["pipe", "ignore", "pipe"] });
    let err = ""; const ms = Math.max(1, deadline - Date.now());
    const t = setTimeout(() => { p.kill("SIGKILL"); rej(new Error("Render took too long and was stopped.")); }, ms);
    p.stderr?.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-400); });
    p.on("error", (e) => { clearTimeout(t); rej(new Error("ffmpeg could not start: " + e.message.slice(0, 80))); });
    p.on("close", (code) => { clearTimeout(t); if (code === 0) res(); else rej(new Error(`ffmpeg failed (exit ${code}).`)); });
    p.stdin?.on("error", () => { /* surfaced via close */ });
    (async () => { for (const b of input) { if (p.stdin!.destroyed) break; if (!p.stdin!.write(b)) await new Promise((r) => p.stdin!.once("drain", r)); } p.stdin!.end(); })().catch(() => {});
  });
}

export function ffmpegRenderer(o: FfmpegOpts): ReplayRenderer {
  return {
    name: "ffmpeg", configured: true,
    async render(i: RenderInput): Promise<RenderOut> {
      const { d, video, poster } = renderPaths(o.dir, i.token); mkdirSync(d, { recursive: true, mode: 0o700 });
      const eq = capFrames((i.equity ?? []).slice(0, i.totalFrames)); const { ih } = frameDims(i.width, i.height);
      const inRate = Math.max(0.1, Math.max(1, eq.length) / i.durationSec).toFixed(4); const deadline = Date.now() + o.maxSec * 1000;
      const raw = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${IW}x${ih}`];
      const tmp = join(d, "video.tmp.mp4"); const tmpP = join(d, "poster.tmp.png");
      try {
        await run(o, [...raw.filter((a) => a !== "-nostdin"), "-framerate", inRate, "-i", "pipe:0", "-t", String(i.durationSec), "-vf", `scale=${i.width}:${i.height}:flags=neighbor,fps=${i.fps}`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart", "-fs", String(o.maxBytes), "-f", "mp4", tmp], frameIter(eq, i.width, i.height), deadline);
        if (statSync(tmp).size >= o.maxBytes) throw new Error("Render was larger than the size limit.");
        await run(o, [...raw.filter((a) => a !== "-nostdin"), "-i", "pipe:0", "-vf", `scale=${i.width}:${i.height}:flags=neighbor`, "-frames:v", "1", "-f", "image2", "-c:v", "png", tmpP], frameIter(eq, i.width, i.height, "last"), deadline);
        renameSync(tmp, video); renameSync(tmpP, poster);
        return { ok: true, videoUrl: `/v1/public/replays/${i.token}/video.mp4`, posterUrl: `/v1/public/replays/${i.token}/poster.png` };
      } catch (e) {
        for (const f of [tmp, tmpP]) if (existsSync(f)) rmSync(f, { force: true });
        return { ok: false, error: String((e as Error).message).slice(0, 200) };
      }
    },
  };
}
