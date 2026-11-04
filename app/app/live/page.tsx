import { redirect } from "next/navigation";
import { liveReviewPath, liveRunPath } from "@/lib/live-navigation";
import LiveDesk from "./LiveDesk";

export const metadata = { title: "Live trading — Quiver" };
export default async function LiveTradingPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; strategy?: string }>;
}) {
  const { run, strategy } = await searchParams;
  if (typeof run === "string" && /^live_[a-f0-9]{28}$/.test(run))
    redirect(liveRunPath(run));
  if (typeof strategy === "string" && /^stg_[a-z0-9-]+$/i.test(strategy))
    redirect(liveReviewPath(strategy));
  return <LiveDesk />;
}
