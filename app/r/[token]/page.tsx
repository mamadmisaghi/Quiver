import PublicReplayView from "@/components/PublicReplayView";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
// M5.7: public, read-only replay link. Not indexed (the API also sends x-robots-tag: noindex).
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { serverFetch, serverMediaUrl } from "@/lib/server-api";
const BASE_META: Metadata = { title: "Shared replay — Quiver", robots: { index: false, follow: false } };
// M5.15: when a video was rendered, its poster becomes the link preview (resolved to a browser-reachable API origin).
async function posterFor(token: string): Promise<{ title: string; poster: string | null } | null> {
  "use cache"; cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  if (!/^rpl_[A-Za-z0-9_-]{32}$/.test(token)) return null;
  try {
    const r = await serverFetch(`/public/replays/${token}`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null; const j = (await r.json()) as { title?: unknown; render?: { status?: unknown; posterUrl?: unknown } };
    return { title: typeof j.title === "string" ? j.title.slice(0, 120) : "Shared replay", poster: j.render?.status === "done" && typeof j.render.posterUrl === "string" ? serverMediaUrl(j.render.posterUrl) : null };
  } catch { return null; }
}
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const p = await posterFor(decodeURIComponent((await params).token));
  if (!p) return BASE_META;
  return { ...BASE_META, title: `${p.title} — Quiver replay`, openGraph: { title: p.title, ...(p.poster ? { images: [{ url: p.poster }] } : {}) }, twitter: { card: p.poster ? "summary_large_image" : "summary" } };
}
export function generateStaticParams() { return [{ token: "rpl_" + "M".repeat(31) + "1" }]; }
export default async function SharedReplay({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <><SiteHeader /><main id="main"><PublicReplayView token={decodeURIComponent(token)} /></main><SiteFooter /></>;
}
