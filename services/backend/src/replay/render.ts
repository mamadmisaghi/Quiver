// M5.7 replay render jobs. The renderer is pluggable; the only one shipped is a stub (no video is produced and
// nothing leaves the box). A real renderer would implement ReplayRenderer and return hosted video/poster URLs.
export interface RenderInput { token: string; width: number; height: number; fps: number; durationSec: number; totalFrames: number; /** M5.15: equity per replay frame (null = no point) */ equity?: (number | null)[] }
export type RenderOut = { ok: true; videoUrl: string; posterUrl: string | null } | { ok: false; notConfigured?: boolean; error: string };
export interface ReplayRenderer { name: string; configured: boolean; render(i: RenderInput): Promise<RenderOut> }
export const stubRenderer: ReplayRenderer = { name: "stub", configured: false, render: async () => ({ ok: false, notConfigured: true, error: "Video rendering is not connected yet; the replay link works without it." }) };
export const dims = (aspect: string) => aspect === "16:9" ? { width: 1920, height: 1080 } : aspect === "1:1" ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 };
