import {
  previewAiEnabled,
  previewPublicAiEnabled,
  previewDailyAiLimitsEnabled,
  previewJson,
  sameOrigin,
} from "@/lib/preview/server";

export async function GET(_request: Request) {
  return previewJson({
    authenticated: false,
    cloudAvailable: false,
    items: [],
    aiAvailable: previewPublicAiEnabled(),
    aiConfigured: previewAiEnabled(),
    aiDailyLimitsEnabled: previewDailyAiLimitsEnabled(),
  });
}

// Cached clients use 401 to keep a successful local save. No legacy request may touch an account's records.
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return previewJson({ message: "Use the Quiver website." }, 403);
  return previewJson(
    { message: "Preview drafts are saved in this browser." },
    401,
  );
}
export const PATCH = POST;
export const DELETE = POST;
