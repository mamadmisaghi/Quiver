import { PlanAsset } from "@/lib/contracts";
import { resolveMarket } from "@/services/backend/src/compile/markets";
import { previewJson, readPreviewBody, sameOrigin } from "@/lib/preview/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return previewJson({ message: "Use the Quiver website." }, 403);
  try {
    const asset = PlanAsset.omit({ resolution: true }).parse(await readPreviewBody(request, 2000));
    return previewJson(await resolveMarket(asset));
  } catch { return previewJson({ message: "Enter an asset name, token mint or event title." }, 422); }
}
