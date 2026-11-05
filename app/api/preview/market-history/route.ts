import { readMarketHistory } from "@/lib/preview/market-history";
import { CHART_RANGES } from "@/lib/api/market-mock";
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams,
    id = params.get("id") ?? "";
  const selected = CHART_RANGES.find(
    (p) => p.tf === params.get("tf") && p.range === params.get("range"),
  );
  if (!selected)
    return Response.json(
      { message: "Unsupported history range." },
      { status: 422 },
    );
  try {
    const result = await readMarketHistory(id, selected.tf, selected.range);
    if (!result)
      return Response.json({ message: "Unknown market." }, { status: 404 });
    return Response.json(result, {
      headers: {
        "cache-control": result.bars.length
          ? "public, max-age=60"
          : "public, max-age=10",
      },
    });
  } catch {
    return Response.json(
      { message: "Market history is temporarily unavailable." },
      { status: 503 },
    );
  }
}
