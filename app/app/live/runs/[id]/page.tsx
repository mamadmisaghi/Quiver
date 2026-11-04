import LiveRunPage from "@/components/live/LiveRunPage";
export const metadata = { title: "Live run — Quiver" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LiveRunPage key={id} id={id} />;
}
