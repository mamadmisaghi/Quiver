import { friendlyIssues } from "../lib/issues";
import { Strategy, type Expr, type ValidationIssue } from "../../contracts/src/strategy";
import type { Registry } from "../venues/registry";
import { parseCron } from "./cron";
import { SIGNAL_FIELDS } from "./snapshot";
import { workflowProblems } from "../../contracts/src/workflow";

export interface ValidateCtx { registry: Registry; stockTokensAllowed: boolean; mode?: "mock" | "testnet" | "mainnet"; purpose?: "draft" | "execute" }

export function validateStrategy(raw: unknown, ctx: ValidateCtx): { strategy: Strategy | null; issues: ValidationIssue[] } {
  const r = Strategy.safeParse(raw);
  if (!r.success) return { strategy: null, issues: friendlyIssues(r.error.issues, 50).map((i) => ({ path: i.path, code: i.code as ValidationIssue["code"], severity: "error" as const, message: i.message })) };
  const s = r.data; const issues: ValidationIssue[] = [];
  const err = (path: string, code: ValidationIssue["code"], message: string, severity: "error" | "warning" = "error") => issues.push({ path, code, severity, message });
  const hours = s.risk.tradingHours;
  if (hours) {
    try { new Intl.DateTimeFormat("en", { timeZone: hours.tz }); } catch { err("/risk/tradingHours/tz", "invalid_value", "Use a valid time zone, such as America/New_York or UTC."); }
    if (![hours.from, hours.to].every((v) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) || hours.from === hours.to) err("/risk/tradingHours", "invalid_value", "Choose valid, different start and end times.");
  }
  if (s.workflow) {
    workflowProblems(s.workflow).forEach((message) => err("/workflow", "schema", message));
    if (s.signals.length || s.triggers.length || s.actions.length) err("/workflow", "schema", "A workflow draft cannot also contain a different executable strategy.");
    err("/workflow", "schema", "Workflow draft: review the remaining details, then test it in the workflow lab. Continuous execution is pending activation.", ctx.purpose === "draft" ? "warning" : "error");
    return { strategy: s, issues };
  }
  if (!s.signals.length || !s.triggers.length) err("/triggers", "strategy_needs_rule", "A strategy needs at least one signal and rule.");
  if (!s.actions.length) err("/actions", "strategy_needs_action", "A strategy needs at least one action.");
  const dup = (arr: { id: string }[], p: string) => { const seen = new Set<string>(); arr.forEach((x, i) => { if (seen.has(x.id)) err(`/${p}/${i}/id`, "schema", `Duplicate id "${x.id}"`); seen.add(x.id); }); };
  dup(s.signals, "signals"); dup(s.triggers, "triggers"); dup(s.actions, "actions");
  const sigs = new Map(s.signals.map((x) => [x.id, x]));
  const inst = (id: string, path: string) => { const m = ctx.registry.get(id); if (!m) err(path, "unsupported_instrument", `Instrument ${id} is not in the supported market list.`); return m; };

  s.signals.forEach((sig, i) => {
    const p = `/signals/${i}`;
    if ("instrument" in sig.params) {
      const m = inst(sig.params.instrument, `${p}/params/instrument`);
      if (m && sig.kind === "funding" && m.kind !== "perp") err(`${p}/params/instrument`, "unsupported_instrument", "Funding is only available for Hyperliquid perps.");
      if (m && sig.kind === "odds" && m.venue !== "polymarket") err(`${p}/params/instrument`, "unsupported_instrument", "Odds signals need a Polymarket outcome.");
      if (m && (m.assetClass === "equity" || m.assetClass === "etf") && sig.kind === "price" && s.risk.equityWhenFeedStale === "skip" && sig.maxAgeSeconds > 3600)
        err(`${p}/maxAgeSeconds`, "stale_feed_unhandled", "Stock prices pause when markets close; a max age over 1h may act on old prices.", "warning");
    }
    if (sig.kind === "timer") { try { parseCron(sig.params.cron); new Intl.DateTimeFormat("en-US", { timeZone: sig.params.tz }); } catch { err(`${p}/params`, "schema", "Invalid cron or time zone."); } }
  });
  s.triggers.forEach((t, i) => walk(t.when, `/triggers/${i}/when`, (ref, path) => {
    const [sid, f] = ref.split("."); const sig = sigs.get(sid);
    if (!sig) err(path, "unknown_ref", `Unknown signal "${sid}".`);
    else if (!SIGNAL_FIELDS[sig.kind].includes(f)) err(path, "unknown_ref", `Signal "${sid}" has no field "${f}" (use ${SIGNAL_FIELDS[sig.kind].join(", ")}).`);
  }));
  const trig = new Set(s.triggers.map((t) => t.id));
  s.actions.forEach((a, i) => {
    const p = `/actions/${i}`;
    a.on.forEach((t, j) => { if (!trig.has(t)) err(`${p}/on/${j}`, "unknown_trigger", `Unknown trigger "${t}".`); });
    const m = inst(a.instrument, `${p}/instrument`); if (!m) return;
    if (m.venue === "polymarket") err(`${p}/instrument`, "venue_read_only", "Polymarket is read-only; use its odds as a signal instead.");
    if ((m.assetClass === "equity" || m.assetClass === "etf") && !ctx.stockTokensAllowed) err(`${p}/instrument`, "geo_restricted", "Stock Tokens aren't available for your account or region.");
    if (a.leverage > 1 && m.kind !== "perp") err(`${p}/leverage`, "leverage_not_allowed", "Leverage is only available on perps.");
    if ((a.side === "long" || a.side === "short") && m.kind !== "perp") err(`${p}/side`, "schema", `Use buy/sell for ${m.symbol}; long/short is for perps.`);
    if ((a.side === "buy" || a.side === "sell") && m.kind === "perp") err(`${p}/side`, "schema", "Use long/short for perps.");
    if (a.type === "open" && a.side === "sell" && m.kind !== "perp") err(`${p}/side`, "schema", "Spot tokens can't be shorted; use a close action to sell holdings.");
    if (a.order.type === "limit" && !a.order.limitPrice) err(`${p}/order/limitPrice`, "schema", "Limit orders need a limitPrice.");
    if (a.order.type === "limit") err(`${p}/order/type`, "schema", "Limit orders are simulated as marketable-only in v1 (filled only when price is at or better than the limit).", "warning");
    if (a.size.unit === "pct_equity" && Number(a.size.value) > s.risk.maxPositionPct) err(`${p}/size`, "risk_cap", `Size ${a.size.value}% is above the ${s.risk.maxPositionPct}% position cap.`);
    if (a.exits?.takeProfits?.length) {
      const ladder = a.exits.takeProfits;
      if (ladder.some((r, j) => Number(r.atPct) <= 0 || Number(r.sellFraction) <= 0 || Number(r.sellFraction) > 1 || (j > 0 && Number(r.atPct) <= Number(ladder[j - 1].atPct))) || ladder.reduce((n, r) => n + Number(r.sellFraction), 0) > 1.000001) err(`${p}/exits/takeProfits`, "schema", "Use increasing positive targets and fractions totaling at most the original position.");
    }
  });
  return { strategy: s, issues };
}
function walk(e: Expr, p: string, f: (ref: string, path: string) => void) {
  if (e.op === "and" || e.op === "or") e.args.forEach((a, i) => walk(a, `${p}/args/${i}`, f));
  else if (e.op === "not") walk(e.arg, `${p}/arg`, f);
  else if (e.op === "between") (["value", "low", "high"] as const).forEach((k) => { const o = e[k]; if ("ref" in o) f(o.ref, `${p}/${k}`); });
  else { const c = e as Extract<Expr, { left: unknown }>; (["left", "right"] as const).forEach((k) => { const o = c[k]; if ("ref" in o) f(o.ref, `${p}/${k}`); }); }
}
export const hasErrors = (i: ValidationIssue[]) => i.some((x) => x.severity === "error");
