import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { cacheLife } from "next/cache";
import * as C from "@/lib/contracts";
import type { PublicBoard } from "@/lib/api";
import { serverFetch } from "@/lib/server-api";
import fixture from "@/lib/api/fixtures/m4/public.leaderboard.json";
import LeaderboardView from "./LeaderboardView";

/** W3: server-rendered first view (7d) so the table + notice show without JS. Cached ~60 s; null → client fetch. */
async function initialBoard(): Promise<PublicBoard | null> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 60, expire: 600 });
  if (process.env.NEXT_PUBLIC_API_MODE !== "live") return C.PublicLeaderboardRes.parse(fixture); // MOCK
  try {
    const r = await serverFetch(`/public/leaderboard?period=7d&limit=50`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? C.PublicLeaderboardRes.parse(await r.json()) : null;
  } catch { return null; }
}

export const metadata: Metadata = {
  title: "Leaderboard · Quiver",
  description: "Public paper and backtest results from strategies written in plain English on Quiver. Ranked by return, with drawdown and win rate beside it.",
  openGraph: { title: "Quiver leaderboard", description: "Ranked paper and backtest results, with drawdown and win rate beside every return." },
};
export default async function Page() {
  const initial = await initialBoard();
  return (<><SiteHeader /><main className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20"><LeaderboardView initial={initial} /></main><SiteFooter /></>);
}
