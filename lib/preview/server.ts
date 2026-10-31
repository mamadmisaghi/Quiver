import { createPreviewBudget } from "./budget";
import type { CompileDeps } from "@/services/backend/src/compile";

export const previewJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
// These headers are set by Sites dispatch. This module is never used to authenticate Render's API.
export function previewOwner(request: Request): string | null {
  const id = request.headers.get("oai-authenticated-user-id"), email = request.headers.get("oai-authenticated-user-email");
  return id && email && id.length <= 256 ? id : null;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
export async function previewDatabase(): Promise<D1Database> {
  // Keep the anonymous deterministic compiler usable in Node-based checks without Worker bindings.
  return (await import("@/db")).getRawDb();
}
export async function readPreviewBody(request: Request, max: number): Promise<unknown> {
  const reader = request.body?.getReader(); if (!reader) throw new Error("empty");
  let size = 0, body = ""; const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new RangeError("large"); }
    body += decoder.decode(value, { stream: true });
  }
  return JSON.parse(body + decoder.decode());
}
export function previewAiEnabled() {
  return process.env.QUIVER_PREVIEW_AI_ENABLED === "true" && !!process.env.OPENROUTER_API_KEY;
}
const number = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value); return value && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
export async function previewAi(request: Request, vision = false): Promise<CompileDeps["openrouter"]> {
  const owner = previewOwner(request); if (!owner || !previewAiEnabled()) return undefined;
  const db = await previewDatabase();
  return { apiKey: process.env.OPENROUTER_API_KEY!, model: (vision ? process.env.LLM_VISION_MODEL : process.env.LLM_MODEL) || "openai/gpt-4.1-mini",
    budget: createPreviewBudget(db, owner, { capUsd: number(process.env.LLM_DAILY_BUDGET_USD, 5, 0, 5), maxInflight: number(process.env.LLM_MAX_INFLIGHT, 3, 1, 3), maxOutputTokens: number(process.env.LLM_MAX_OUTPUT_TOKENS, 4000, 256, 4000) }) };
}
