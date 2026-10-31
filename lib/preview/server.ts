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
export const previewPublicAiEnabled = () => previewAiEnabled() && process.env.QUIVER_PREVIEW_PUBLIC_AI === "true";
// Anonymous callers get only compiler access. This key never authorizes records or connected accounts.
export async function anonymousBudgetKey(request: Request) {
  const day = new Date().toISOString().slice(0, 10);
  const input = `${day}:${request.headers.get("cf-connecting-ip") ?? "shared-preview"}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(process.env.OPENROUTER_API_KEY!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return "anon:" + Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
const number = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value); return value && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
export async function previewAi(request: Request, vision = false): Promise<CompileDeps["openrouter"]> {
  if (!previewAiEnabled()) return undefined;
  const authenticated = previewOwner(request);
  if (!authenticated && !previewPublicAiEnabled()) return undefined;
  const owner = authenticated ?? await anonymousBudgetKey(request);
  const db = await previewDatabase();
  return { apiKey: process.env.OPENROUTER_API_KEY!, totalBudgetMs: 90_000, callTimeoutMs: 35_000, model: (vision ? process.env.LLM_VISION_MODEL : process.env.LLM_MODEL) || "openai/gpt-4.1-mini",
    budget: createPreviewBudget(db, owner, { capUsd: number(process.env.LLM_DAILY_BUDGET_USD, 5, 0, 5), maxInflight: number(process.env.LLM_MAX_INFLIGHT, 3, 1, 3), maxOutputTokens: number(process.env.LLM_MAX_OUTPUT_TOKENS, 4000, 256, 6000), maxOwnerCalls: authenticated ? 60 : 30, publicCapUsd: 1 }) };
}
