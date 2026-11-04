import LiveReviewPage from "@/components/live/LiveReviewPage";
export const metadata = { title: "Review & go live — Quiver" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params,
    { v } = await searchParams;
  return (
    <LiveReviewPage
      key={id + ":" + v}
      id={id}
      version={v === undefined ? null : Number(v)}
    />
  );
}
