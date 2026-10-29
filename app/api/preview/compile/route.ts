import { CompileReq } from "@/lib/contracts";
import { compile } from "@/services/backend/src/compile";
import { MOCK_INSTRUMENTS, Registry } from "@/services/backend/src/venues/registry";

// This free preview deliberately has no provider credentials or trading authority.
// Reuse the original compiler's deterministic path, validation and graph frames.
export async function POST(request: Request) {
  const fail = (status: number, message: string) => Response.json({ message }, { status });
  const reader = request.body?.getReader();
  if (!reader) return fail(400, "Describe a strategy first.");
  const decoder = new TextDecoder(); let body = "", size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 24_000) { await reader.cancel(); return fail(413, "That request is too long. Use up to 2,000 characters."); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch { return fail(400, "The request could not be read. Try again."); }
  let raw: unknown; try { raw = JSON.parse(body); } catch { return fail(400, "Send a valid strategy request."); }
  const parsed = CompileReq.safeParse(raw);
  if (!parsed.success) return fail(422, "Use a strategy description between 8 and 2,000 characters.");
  if (parsed.data.images?.length) return fail(422, "Chart reading needs the AI service. Describe the rules in text for now.");
  if (parsed.data.baseStrategy || parsed.data.instruction) return fail(422, "AI refinement is not connected yet. Edit the complete description above and press Draft strategy.");

  const iterator = compile(parsed.data, { registry: new Registry(MOCK_INSTRUMENTS), stockTokensAllowed: true });
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        if (request.signal.aborted) { await iterator.return(undefined); controller.close(); return; }
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(JSON.stringify(next.value) + "\n"));
      } catch { controller.enqueue(encoder.encode(JSON.stringify({ type: "error", code: "compile_failed", message: "Could not draft those rules. Try a simpler market, condition and amount." }) + "\n")); controller.close(); }
    },
    async cancel() { await iterator.return(undefined); },
  }), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
