import type { Workflow } from "../../contracts/src/workflow";
import { canonicalSymbol } from "./markets";

export function normalizeIdea(text: string) {
  return text.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[،,]/g, " ").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim().replace(/[.!؟]+$/, "");
}
/** Full-clause parsers for percentage declines. Unsupported clauses go to the AI planner. */
export function drawdownDraft(text: string): Workflow | null {
  const t = normalizeIdea(text);
  let source = "", bought = "", pct = 0, amount: number | null = null;
  let m = t.match(/^(?:every time|whenever|each time)\s+([a-z][a-z0-9.-]{0,20})\s+(?:price\s+)?(?:drops?|falls?|dips?|declines?)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?:please\s+)?buy\s+(?:(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|\$))\s+(?:of\s+)?)?([a-z][a-z0-9.-]{0,20})(?:\s+for me)?$/i);
  if (m) { source = m[1]; bought = m[5]; pct = Number(m[2]); amount = m[3] || m[4] ? Number(m[3] ?? m[4]) : null; }
  if (!m) {
    m = t.match(/^buy\s+(?:(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|\$))\s+(?:of\s+)?)?([a-z][a-z0-9.-]{0,20})\s+(?:every time|whenever|each time)\s+(it|[a-z][a-z0-9.-]{0,20})\s+(?:price\s+)?(?:drops?|falls?|dips?|declines?)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)$/i);
    if (m) { source = m[3]; bought = m[4].toLowerCase() === "it" ? m[3] : m[4]; pct = Number(m[5]); amount = m[1] || m[2] ? Number(m[1] ?? m[2]) : null; }
  }
  if (!m) {
    m = t.match(/^(?:هر بار|هروقت|هر وقت)\s+(?:که\s+)?(?:قیمت\s+)?([\p{L}a-z][\p{L}a-z0-9.-]{0,24})\s+(\d+(?:\.\d+)?)\s*(?:درصد|%)\s*(?:افت (?:کرد|کنه|کند)|(?:می\s*)?ریزه|ریخت|بریزه|کاهش (?:یافت|پیدا کرد))\s+(?:(?:برام|برای من)\s+)?(?:(\d+(?:\.\d+)?)\s*دلار\s+)?(?:از\s+)?([\p{L}a-z][\p{L}a-z0-9.-]{0,24})\s+(?:(?:برام|برای من)\s+)?(?:بخر|خرید کن)$/iu);
    if (m) { source = m[1]; bought = m[4]; pct = Number(m[2]); amount = m[3] ? Number(m[3]) : null; }
  }
  if (!m || canonicalSymbol(source) !== canonicalSymbol(bought) || !(pct > 0 && pct < 100) || (amount !== null && !(amount > 0))) return null;
  const symbol = canonicalSymbol(source);
  const asset = { id: "asset", query: symbol, sourceText: source, venue: symbol === "NEET" ? "solana" as const : null, kind: "token" as const, outcome: null };
  return {
    version: 1, name: `${symbol} ${pct}% dip buys`, summary: `Buy ${amount ? `$${amount} of ` : "an amount to set of "}${symbol} on each new ${pct}% decline. Review the drop reference and strategy allocation.`,
    budgetUsd: null, assets: [asset],
    signals: [{ id: "drop", assetId: "asset", kind: "drawdown", drawdown: { reference: "needs_choice", lookbackMinutes: null }, indicator: null, schedule: null, description: `${symbol} price decline (%)` }],
    stages: [{ id: "buy", assetId: "asset", side: "buy", sourceText: text, conditionText: `${symbol} falls ${pct}% from the chosen reference`, when: { op: "gte", left: { ref: "drop.value" }, right: { lit: pct } }, after: [], amount: { unit: "usd", value: amount }, leverage: 1, funding: { kind: "budget", from: [] }, repeat: { intervalMinutes: null, maxTimes: null, conditionMode: "each_time" }, exits: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null, timeExitHours: null, ladder: [], description: "" } }],
    questions: [], assumptions: [],
  };
}
