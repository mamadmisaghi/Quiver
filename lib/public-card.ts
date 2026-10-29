// M4.8: server-side read of a shared run card (no auth). Used by /c/[token] page, metadata and OG image.
import * as C from "@/lib/contracts";
import type { PublicCard } from "@/lib/api";
import fixture from "@/lib/api/fixtures/m4/public.card.json";

const LIVE = process.env.NEXT_PUBLIC_API_MODE === "live";
import { serverFetch } from "@/lib/server-api";
export const TOKEN_RE = /^crd_[A-Za-z0-9_-]{8,64}$/;

/** null = unknown or revoked (404). Throws on network/5xx so the page can say "try again". */
export async function getPublicCard(token: string): Promise<PublicCard | null> {
  if (!TOKEN_RE.test(token)) return null;
  if (!LIVE) return C.PublicCard.parse(fixture); // MOCK
  const r = await serverFetch(`/public/cards/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`card ${r.status}`);
  return C.PublicCard.parse(await r.json());
}
export const signedPct = (v: string | number) => { const n = Number(v); return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2) + "%"; };
export const durLabel = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`);
