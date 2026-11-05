import { compile, type CompileDeps } from "@/services/backend/src/compile";
import { planCompile } from "@/services/backend/src/compile/planner";
import { MOCK_INSTRUMENTS, Registry } from "@/services/backend/src/venues/registry";

export function streamPreviewCompile(request: Request, input: Parameters<typeof compile>[0], ai?: CompileDeps["openrouter"]) {
  const iterator = planCompile(input, { registry: new Registry(MOCK_INSTRUMENTS), stockTokensAllowed: true, retainWorkflow: true, openrouter: ai });
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
  }), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
