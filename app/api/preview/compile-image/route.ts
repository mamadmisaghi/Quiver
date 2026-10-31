import { CompileImageReq } from "@/lib/contracts";
import { streamPreviewCompile } from "@/lib/preview/compile";
import { previewAi, previewJson, previewOwner, previewPublicAiEnabled, readPreviewBody, sameOrigin } from "@/lib/preview/server";
import { checkImage } from "@/services/backend/src/compile/image";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return previewJson({ message: "Attach charts from Quiver." }, 403);
  if (!previewOwner(request) && !previewPublicAiEnabled()) return previewJson({ message: "Sign in with ChatGPT to read charts with AI." }, 401);
  let raw: unknown;
  try { raw = await readPreviewBody(request, 2_800_000); }
  catch (e) { return previewJson({ message: e instanceof RangeError ? "That chart is too large. Use an image under 2 MB." : "Send a valid chart request." }, e instanceof RangeError ? 413 : 400); }
  const input = CompileImageReq.safeParse(raw);
  if (!input.success) return previewJson({ message: "Use a PNG, JPEG or WebP chart under 2 MB." }, 422);
  const image = checkImage(input.data.imageBase64, input.data.mimeType);
  if (!image.ok) return previewJson({ message: image.message }, image.reason === "too_large" ? 413 : 422);
  let ai;
  try { ai = await previewAi(request, true); }
  catch { return previewJson({ message: "AI accounting is unavailable. Try again shortly." }, 503); }
  if (!ai) return previewJson({ message: "Chart AI is not configured yet. Describe the rules in text for now." }, 503);
  return streamPreviewCompile(request, { thesis: input.data.note || "Read the visible trading setup", note: input.data.note, image: { mime: image.mime, base64: input.data.imageBase64.replace(/^data:[^;,]+;base64,/, "") } }, ai);
}
