import { expressionRefs, type Workflow, type PlanExpr } from "../../contracts/src/workflow";
import type { StrategyNode } from "./nodes";

const money = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
const venue = (v: string | null) => ({ robinhood: "Robinhood Chain", solana: "Solana", hyperliquid: "Hyperliquid", polymarket: "Polymarket" }[v ?? ""] ?? "venue to choose");
export function conditionText(w: Workflow, e: PlanExpr | null): string {
  if (!e) return "When started";
  if ("args" in e) return "(" + e.args.map((v) => conditionText(w, v)).join(e.op === "and" ? " AND " : " OR ") + ")";
  if ("arg" in e) return `NOT (${conditionText(w, e.arg)})`;
  const value = (o: { ref: string } | { lit: number | string | boolean }) => {
    if ("lit" in o) return String(o.lit);
    const [id, field] = o.ref.split("."); const signal = w.signals.find((s) => s.id === id);
    if (!signal) return o.ref;
    return (signal.description || signal.kind) + (field === "value" ? "" : ` · ${field.replaceAll("_", " ")}`);
  };
  return `${value(e.left)} ${{ lt: "<", lte: "≤", gt: ">", gte: "≥", eq: "=", neq: "≠", crosses_above: "crosses above", crosses_below: "crosses below" }[e.op]} ${value(e.right)}`;
}
export function workflowView(w: Workflow) {
  const nodes: StrategyNode[] = [], edges: { from: string; to: string }[] = [];
  const asset = (id: string) => w.assets.find((a) => a.id === id)!;
  const name = (id: string) => { const a = asset(id); const c = a?.resolution?.candidates.find((x) => x.id === a.resolution?.selectedId); return c?.name ?? a?.query ?? id; };
  const assetVenue = (id: string) => { const a = asset(id); return a?.venue ?? a?.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId)?.venue; };
  const watch: string[] = [], when: string[] = [], actions: string[] = [], exits: string[] = [];
  nodes.push({ id: "wf_budget", kind: "watch", title: "Strategy budget", detail: w.budgetUsd ? `${money(w.budgetUsd)} allocated to this strategy. Orders and fees share this cap. No spending beyond the available allocation.` : "A dedicated budget has not been set. No account-wide spending is implied." });
  for (const sg of w.signals) {
    const label = sg.description || `${sg.assetId ? name(sg.assetId) : ""} ${sg.kind}`;
    watch.push(label);
    nodes.push({ id: `wf_sig_${sg.id}`, kind: "watch", title: label, detail: `${label}${sg.indicator ? `\n${sg.indicator.name.toUpperCase()} · ${sg.indicator.period} periods · ${sg.indicator.timeframe}` : ""}${sg.drawdown ? `\nDrop reference: ${sg.drawdown.reference.replaceAll("_", " ")}${sg.drawdown.reference === "lookback" && sg.drawdown.lookbackMinutes ? ` over ${sg.drawdown.lookbackMinutes} minutes` : ""}; one fill per new decline, never repeat on an unchanged quote.` : ""}${sg.schedule ? `\n${sg.schedule.cron} · ${sg.schedule.tz}` : ""}`, ...(sg.assetId && assetVenue(sg.assetId) ? { venue: assetVenue(sg.assetId) } : {}) });
  }
  for (const s of w.stages) {
    const gate = `wf_when_${s.id}`, action = `wf_do_${s.id}`, finish = `wf_exit_${s.id}`;
    const dependencies = s.after.map((d) => `${d.stageId}: ${{ filled: "order filled", closed: "position closed", realized_profit: "position closed with available realized profit", resolved_profit: "market settled with available realized profit" }[d.event]}`);
    const timing = s.repeat ? `${s.repeat.intervalMinutes ? `Repeat every ${s.repeat.intervalMinutes} min` : "Repeat on each new condition event"}; ${s.repeat.maxTimes ? `up to ${s.repeat.maxTimes} times` : "until the allocated budget cannot cover the next order and fees"}. ${s.repeat.conditionMode === "each_time" ? "Recheck the condition before every order." : s.repeat.conditionMode === "once_then_repeat" ? "Initial condition starts the repeating purchases." : "Choose whether to recheck the condition every time."}` : "Run once.";
    const cond = [s.when ? conditionText(w, s.when) : s.conditionText || "When started", ...dependencies, timing].filter(Boolean).join("\n");
    when.push(cond);
    nodes.push({ id: gate, kind: "when", title: s.after.length ? "After previous stage" : "When", detail: cond });
    for (const id of expressionRefs(s.when)) edges.push({ from: `wf_sig_${id}`, to: gate });
    if (!s.after.length || s.funding.kind === "budget") edges.push({ from: "wf_budget", to: gate });
    for (const d of s.after) edges.push({ from: d.event === "filled" ? `wf_do_${d.stageId}` : `wf_exit_${d.stageId}`, to: gate });
    const amount = s.amount.value === null ? "amount to set" : s.amount.unit === "usd" ? money(s.amount.value) : `${s.amount.value}${s.amount.unit === "native" ? " units" : `% of ${s.amount.unit.replace("pct_", "")}`}`;
    const title = `${s.side === "long" || s.side === "short" ? `Open ${s.leverage}× ${s.side}` : s.side === "sell" ? "Sell" : "Buy"} ${amount} of ${name(s.assetId)}`;
    const detail = `${title}\n${venue(assetVenue(s.assetId) ?? null)}\nFunding: ${s.funding.kind === "profits" ? `only realized profit from ${s.funding.from.join(", ")}; preserve principal; wait if insufficient` : "allocated strategy budget"}.\n${s.leverage > 1 ? `${s.leverage}× leverage; the dollar amount is margin.\n` : ""}${timing}`;
    actions.push(detail); nodes.push({ id: action, kind: "do", title, detail, ...(assetVenue(s.assetId) ? { venue: assetVenue(s.assetId) } : {}) }); edges.push({ from: gate, to: action });
    const x = s.exits, lines: string[] = [];
    if (x.stopLossPct) lines.push(`Stop loss: ${x.stopLossPct}%`);
    if (x.takeProfitPct) lines.push(`Take profit: +${x.takeProfitPct}%`);
    if (x.trailingStopPct) lines.push(`Trailing stop: ${x.trailingStopPct}%`);
    if (x.timeExitHours) lines.push(`Exit after ${x.timeExitHours}h`);
    for (const rung of x.ladder) lines.push(`At +${rung.atPct}%: sell ${(rung.fraction * 100).toFixed(2)}% of the ORIGINAL position, once.`);
    if (x.description) lines.push(x.description);
    const needed = w.stages.some((next) => next.after.some((d) => d.stageId === s.id && d.event !== "filled"));
    if (lines.length || needed) {
      if (!lines.length) lines.push(asset(s.assetId).kind === "outcome" ? "Wait for market settlement. Only net, available realized profit unlocks the next stage." : "The profit-taking/closing condition still needs to be set. Unrealized P&L does not unlock the next stage.");
      exits.push(`${name(s.assetId)}: ${lines.join(" ")}`);
      nodes.push({ id: finish, kind: "exit", title: x.ladder.length ? "Take-profit ladder" : "Exit / realized profit", detail: lines.join("\n"), ...(assetVenue(s.assetId) ? { venue: assetVenue(s.assetId) } : {}) }); edges.push({ from: action, to: finish });
    }
  }
  return { nodes, edges, humanized: { watch: [w.budgetUsd ? `Strategy budget ${money(w.budgetUsd)}` : "Strategy budget: not set", ...watch], when, do: actions, exit: exits } };
}
