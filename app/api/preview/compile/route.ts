import { CompileReq } from "@/lib/contracts";
import { streamPreviewCompile } from "@/lib/preview/compile";
import { previewAi, previewJson, readPreviewBody, sameOrigin } from "@/lib/preview/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return previewJson({ message: "Draft from the Quiver website." }, 403);
  let raw: unknown;
  try { raw = await readPreviewBody(request, 24_000); }
  catch (e) { return previewJson({ message: e instanceof RangeError ? "That request is too long. Use up to 2,000 characters." : "Send a valid strategy request." }, e instanceof RangeError ? 413 : 400); }
  const parsed = CompileReq.safeParse(raw);
  if (!parsed.success) return previewJson({ message: "Use a strategy description between 8 and 2,000 characters." }, 422);
  if (parsed.data.images?.length) return previewJson({ message: "Attach the chart using the chart button." }, 422);
  let ai;
  try { ai = await previewAi(request); }
  catch { return previewJson({ message: "AI accounting is unavailable. Please try again shortly." }, 503); }
  return streamPreviewCompile(request, parsed.data, ai);
}
