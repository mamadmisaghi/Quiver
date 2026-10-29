import { z } from "zod";
import { Strategy, type ValidationIssue } from "../../contracts/src/strategy";
import type { Registry } from "../venues/registry";

export interface LlmResult { json: unknown; inputTokens: number; outputTokens: number; costUsd: number }
const SCHEMA = z.toJSONSchema(Strategy, { io: "input", unrepresentable: "any" }); // zod 4 native (M3.5: zod-to-json-schema dropped)

export function systemPrompt(reg: Registry) {
  const list = reg.all().map((i) => `- ${i.id} | ${i.symbol} | ${i.venue} | ${i.kind}${i.venue === "polymarket" ? " | READ-ONLY (signal only)" : ""}`).join("\n");
  return `You convert a trading idea into a Quiver Strategy JSON (schemaVersion 1). Output ONLY JSON matching the schema.
Rules: use ONLY these instrument ids (never invent addresses):\n${list}
- Polymarket outcomes are signals only (kind "odds"), never actions.
- Perps use side long/short; tokens use buy/sell. Leverage > 1 only on perps (max 10).
- Every ref is "<signalId>.<field>"; fields: value (price/indicator/funding/odds/market_session/timer), qty|pnl_pct|value_usd (position).
- Odds are 0..1. Funding is per hour as a fraction. Use forMinutes for "holds for".
- Percent fields use percentage points (5 means 5%, never 0.05). Default risk: maxPositionPct 25, maxTotalExposurePct 100, maxDailyLossPct 10, maxOrdersPerDay 20, equityWhenFeedStale "skip".
- forMinutes must be a number; use 0 when no hold time is requested. cooldownMinutes must be a number; use 60 when unspecified. Default maxFires is 1; use null only when the user explicitly asks for unlimited repeats.
- Keep independently requested entries in separate triggers. Use Latin signal/trigger/action ids, while preserving the original language of the thesis.
- Be conservative with risk defaults. Put the user's original text in "thesis".`;
}

/** OpenRouter chat completion with JSON-schema structured output. The key is read from config only, never logged. */
export async function callOpenRouter(opts: { apiKey: string; model: string; maxTokens?: number; system: string; user: string; image?: { mime: string; base64: string }; repair?: { previous: unknown; issues: ValidationIssue[] }; schema?: { name: string; schema: unknown }; signal?: AbortSignal }): Promise<LlmResult> {
  const messages: { role: string; content: unknown }[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.image ? [{ type: "text", text: opts.user }, { type: "image_url", image_url: { url: `data:${opts.image.mime};base64,${opts.image.base64}` } }] : opts.user }];
  if (opts.repair) messages.push({ role: "assistant", content: JSON.stringify(opts.repair.previous) }, { role: "user", content: `Fix these issues and return the full corrected JSON:\n${opts.repair.issues.map((i) => `${i.path}: ${i.message}`).join("\n")}` });
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", signal: opts.signal ?? AbortSignal.timeout(60_000),
    headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", "x-title": "Quiver" },
    body: JSON.stringify({ model: opts.model, messages,
      // GPT-5 models do not accept temperature=0. Bound reasoning instead; its tokens are billed too.
      ...(opts.model.startsWith("openai/gpt-5") ? { reasoning: { effort: "low", exclude: true } } : { temperature: 0 }),
      provider: { require_parameters: true },
      // Zod schemas contain optional operation fields. Provider strict mode requires all fields;
      // local Zod + semantic validation remains authoritative for both schema types.
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}), usage: { include: true }, response_format: { type: "json_schema", json_schema: opts.schema ? { name: opts.schema.name, strict: false, schema: opts.schema.schema } : { name: "Strategy", strict: false, schema: SCHEMA } } }),
  });
  if (!res.ok) throw new Error(`openrouter_http_${res.status}`);
  const body: any = await res.json();
  const text: string = body.choices?.[0]?.message?.content ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  let json: unknown; try { json = JSON.parse(m ? m[0] : text); } catch { json = null; }
  return { json, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0, costUsd: Number(body.usage?.cost ?? 0) };
}
