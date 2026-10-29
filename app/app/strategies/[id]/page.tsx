import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import PublicStrategyView from "@/components/strategy/PublicStrategyView";
import pubs from "@/lib/api/fixtures/ext/ext.public-strategies.json";
import pub3 from "@/lib/api/fixtures/ext/ext.public-strategy.json";
import pub1 from "@/lib/api/fixtures/ext/ext.public-strategy.1.json";
import pub2 from "@/lib/api/fixtures/ext/ext.public-strategy.2.json";
import { PublicStrategyDetail } from "@/lib/contracts";
import { serverFetch } from "@/lib/server-api";
type Detail = ReturnType<typeof PublicStrategyDetail.parse>;
const LIVE = process.env.NEXT_PUBLIC_API_MODE === "live";
// M5.28: guest-readable. The API sends noindex, so the page does too; share links still get a real title.
const BASE_META: Metadata = { title: "Public strategy — Quiver", robots: { index: false, follow: false } };

/** Server render for share links: live → GET /public/strategies/:id via serverFetch (internal token, guest view, cached
 *  like the API's max-age 30); mock → the fixture. Any failure → null and the client loads it instead. */
async function load(id: string): Promise<Detail | null> {
  "use cache"; cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  if (!/^stg_[A-Za-z0-9]{6,40}$/.test(id)) return null;
  if (!LIVE) { const s = [pub1, pub2, pub3].find((x) => x.id === id); return s ? PublicStrategyDetail.parse(s) : null; }
  try {
    const r = await serverFetch(`/public/strategies/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const p = PublicStrategyDetail.safeParse(await r.json());
    return p.success ? p.data : null;
  } catch { return null; }
}
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const d = await load(decodeURIComponent((await params).id));
  if (!d) return BASE_META;
  const desc = d.thesis.slice(0, 160);
  return { ...BASE_META, title: `${d.name} by ${d.author.handle} — Quiver`, description: desc, openGraph: { title: d.name, description: desc }, twitter: { card: "summary" } };
}
export function generateStaticParams() { return pubs.items.map((p) => ({ id: p.id })); }
export default async function PublicStrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const seed = await load(id);
  return <PublicStrategyView id={id} initial={seed ?? undefined} />;
}
