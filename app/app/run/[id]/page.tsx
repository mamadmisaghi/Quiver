import { redirect } from "next/navigation";
import RunView from "@/components/RunView";
import { RUNS } from "@/lib/api/fixtures";
export const metadata = { title: "Paper run — Quiver" };
// Prerender the fixture ids plus "demo"; in live mode LiveRun resolves the id via api.resolveRun on the client.
export function generateStaticParams() { return [...RUNS.map((r) => ({ id: r.id })), { id: "demo" }]; }
export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if(/^live_[a-f0-9]{28}$/.test(id))redirect("/app/live?run="+id);
  return <RunView runId={id} />;
}
