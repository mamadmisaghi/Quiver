// M4.9.1: zod issues → friendly, stable, de-duplicated messages. Raw zod text never reaches an API response.
import type { z } from "zod";

type ZI = z.core.$ZodIssue;
export interface FriendlyIssue { path: string; code: string; message: string }
const LABELS: Record<string, string> = {
  triggers: "rules", actions: "actions", signals: "signals", on: "rule list", when: "condition", forMinutes: "hold time", cooldownMinutes: "cooldown", maxFires: "max fires",
  size: "size", value: "value", unit: "unit", leverage: "leverage", exits: "exits", takeProfit: "take profit", stopLoss: "stop loss", trailingStopPct: "trailing stop", timeExitHours: "time exit",
  risk: "risk limits", maxPositionPct: "max position", maxTotalExposurePct: "max total exposure", maxDailyLossPct: "max daily loss", maxOrdersPerDay: "max orders per day",
  instrument: "instrument", side: "side", name: "name", thesis: "description", text: "text", id: "id", schemaVersion: "schema version",
};
const label = (path: PropertyKey[]) => { const k = [...path].reverse().find((p) => typeof p === "string") as string | undefined; return k ? (LABELS[k] ?? k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()) : "request"; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lim = (v: unknown) => typeof v === "bigint" ? v.toString() : String(v);
/** top-level strategy field: ["triggers"] or ["strategy","triggers"] (request bodies that wrap a strategy) */
const top = (path: PropertyKey[]) => path.length === 1 || (path.length === 2 && path[0] === "strategy") ? String(path.at(-1)) : null;

export function friendly(i: ZI): FriendlyIssue {
  const path = "/" + i.path.map(String).join("/"); const f = label(i.path); const t = top(i.path);
  switch (i.code) {
    case "too_small":
      if (i.origin === "array" && t === "triggers") return { path, code: "strategy_needs_rule", message: "A strategy needs at least one active rule" };
      if (i.origin === "array" && t === "actions") return { path, code: "strategy_needs_action", message: "A strategy needs at least one action" };
      if (i.origin === "array") return { path, code: "too_few", message: `Add at least ${lim(i.minimum)} item${Number(i.minimum) === 1 ? "" : "s"} to ${f}` };
      if (i.origin === "string") return { path, code: "too_short", message: `${cap(f)} is too short (at least ${lim(i.minimum)} characters)` };
      return { path, code: "out_of_range", message: `${cap(f)} must be ${i.inclusive === false ? "more than" : "at least"} ${lim(i.minimum)}` };
    case "too_big":
      if (i.origin === "array") return { path, code: "too_many", message: `${cap(f)} allows at most ${lim(i.maximum)} items` };
      if (i.origin === "string") return { path, code: "too_long", message: `${cap(f)} is too long (at most ${lim(i.maximum)} characters)` };
      return { path, code: "out_of_range", message: `${cap(f)} must be at most ${lim(i.maximum)}` };
    case "invalid_type": return (("input" in i) ? i.input === undefined : /received undefined/.test(i.message)) ? { path, code: "missing_field", message: `${cap(f)} is required` } : { path, code: "invalid_value", message: `${cap(f)} has the wrong type` };
    case "invalid_value": case "invalid_union": return { path, code: "invalid_value", message: `${cap(f)} has an unsupported value` };
    case "invalid_format": return { path, code: "invalid_format", message: `${cap(f)} has an invalid format` };
    case "unrecognized_keys": return { path, code: "unknown_field", message: `Unknown field${i.keys.length > 1 ? "s" : ""}: ${i.keys.slice(0, 5).join(", ")}` };
    case "not_multiple_of": return { path, code: "invalid_value", message: `${cap(f)} must be a multiple of ${lim(i.divisor)}` };
    case "custom": return { path, code: "invalid_value", message: `${cap(f)} is invalid` };
    default: return { path, code: "invalid_value", message: `${cap(f)} is invalid` };
  }
}
/** Map + de-duplicate (same code+message once). A missing-rule issue subsumes the missing-action one it causes. */
export function friendlyIssues(issues: readonly ZI[], max = 20): FriendlyIssue[] {
  const out: FriendlyIssue[] = []; const seen = new Set<string>();
  for (const i of issues) { const f = friendly(i); const k = f.code + "|" + f.message; if (seen.has(k)) continue; seen.add(k); out.push(f); }
  const r = out.some((x) => x.code === "strategy_needs_rule") ? out.filter((x) => x.code !== "strategy_needs_action") : out;
  return r.slice(0, max);
}
export function dedupe<T extends { code: string; message: string }>(xs: T[]): T[] { const seen = new Set<string>(); return xs.filter((x) => { const k = x.code + "|" + x.message; if (seen.has(k)) return false; seen.add(k); return true; }); }
