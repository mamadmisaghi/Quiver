import ReplayView from "@/components/ReplayView";
import { RUNS } from "@/lib/api/fixtures";
export const metadata = { title: "Run replay — Quiver" };
export function generateStaticParams() { return [...RUNS.map((r) => ({ id: r.id })), { id: "demo" }]; }
export default async function Replay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReplayView runId={id} />;
}
