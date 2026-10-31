import { z } from "zod";
import { PlanAsset } from "@/lib/contracts";
import { quoteAsset } from "@/services/backend/src/workflows/quotes";
import { previewJson, readPreviewBody, sameOrigin } from "@/lib/preview/server";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return previewJson({ message: "Use the Quiver website." }, 403);
  try {
    const assets = z.array(PlanAsset).min(1).max(16).parse(await readPreviewBody(request, 32000));
    const items = []; for (let i = 0; i < assets.length; i += 4) items.push(...await Promise.all(assets.slice(i, i + 4).map(async (a) => ({ assetId: a.id, ...await quoteAsset(a, undefined, process.env.TIINGO_API_KEY) }))));
    return previewJson({ at: Date.now(), items });
  } catch { return previewJson({ message: "Select valid market identities before requesting quotes." }, 422); }
}
