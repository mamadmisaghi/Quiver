// M5.15: render.videoUrl / posterUrl are either absolute (external renderer) or our own "/v1/public/replays/…" path
// (local ffmpeg). Paths resolve against the API origin, never the page origin, so they work when the API is on
// another host/port. Anything that isn't http(s) or our media path is dropped (null), never rendered.
const MEDIA_PATH = /^\/v1\/public\/replays\/rpl_[A-Za-z0-9_-]{32}\/(video\.mp4|poster\.png)$/;
/** base: an API base such as "/v1" (same origin as the page) or "http://host:8795/v1". */
export function resolveMedia(u: string | null | undefined, base: string): string | null {
  if (!u) return null;
  if (MEDIA_PATH.test(u)) {
    if (!/^https?:\/\//.test(base)) return u; // relative API base → the page origin proxies /v1
    try { return new URL(u, new URL(base).origin).toString(); } catch { return null; }
  }
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null; } catch { return null; }
}
/** Browser: NEXT_PUBLIC_API_BASE (default "/v1"). */
export const clientMedia = (u: string | null | undefined) => resolveMedia(u, process.env.NEXT_PUBLIC_API_BASE ?? "/v1");
