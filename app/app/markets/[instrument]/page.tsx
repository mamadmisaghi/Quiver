import Wrap from "@/components/Wrap";
import { MARKETS } from "@/lib/api/fixtures";
import MarketDetailView from "./MarketDetailView";
export const metadata = { title: "Market — Quiver" };
// Prerender the fixture instruments (same pattern as /app/run/[id]); other ids resolve on the client.
export function generateStaticParams() { return MARKETS.map((m) => ({ instrument: encodeURIComponent(m.id) })); }
export default async function MarketPage({ params }: { params: Promise<{ instrument: string }> }) {
  const { instrument } = await params;
  let id = instrument; // static params may arrive encoded once or twice; decode until stable
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(id); i++) { try { id = decodeURIComponent(id); } catch { break; } }
  return <Wrap><MarketDetailView id={id} /></Wrap>;
}
