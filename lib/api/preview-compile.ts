import { CompileEvent } from "@/lib/contracts";
import { ApiErr, type QuiverApi } from "./types";

async function stream(path: string, body: unknown, onEvent: Parameters<QuiverApi["compile"]>[1], signal?: AbortSignal) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiErr("compile_failed", error?.message ?? "The preview compiler is unavailable. Try again.", response.status);
  }
  if (!response.body) throw new ApiErr("compile_failed", "No draft arrived. Try again.", 502);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "", terminal = false;
  const consume = (line: string) => {
    if (!line.trim() || signal?.aborted) return;
    const event = CompileEvent.parse(JSON.parse(line));
    if (event.type === "result" || event.type === "error") terminal = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n"); pending = lines.pop() ?? ""; lines.forEach(consume);
    }
    pending += decoder.decode(); if (pending.trim()) consume(pending);
    if (!terminal && !signal?.aborted) throw new ApiErr("compile_failed", "The draft was interrupted. Try again.", 502);
  } finally { reader.releaseLock(); }
}
export const previewCompile: QuiverApi["compile"] = (body, onEvent, signal) => stream("/api/preview/compile", body, onEvent, signal);
export const previewCompileImage: QuiverApi["compileImage"] = (body, onEvent, signal) => stream("/api/preview/compile-image", body, onEvent, signal);
