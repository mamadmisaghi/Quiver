import type { Strategy } from "../../contracts/src/strategy";
import type { Workflow } from "../../contracts/src/workflow";
import { paperProblems, createPaper, stepPaper, type PaperState, type PaperQuote } from "../workflows/paper";
import { HostError } from "../workflows/host";

export type TestnetProgram = {
  id: string;
  strategyId: string;
  version: number;
  strategy: Strategy;
  master: string;
  agent: string;
  mode: "confirm_each" | "auto";
  status: "running" | "stopped" | "completed";
  checkpoint: PaperState;
  stageOrders: Record<string, string>;
  pendingReason: string;
  day: string;
  openingEquity: number;
  createdAt: number;
};
export function executableSymbol(a: Workflow["assets"][number]) {
  const selected = a.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId);
  return selected?.venue === "hyperliquid" &&
    selected.kind === "perp" &&
    selected.source === "hyperliquid" &&
    selected.id === "hl:perp:" + selected.symbol
    ? selected.symbol
    : null;
}
export function testnetIssues(st: Strategy) {
  const w = st.workflow;
  if (!w) return ["Save a reviewed workflow first."];
  const issues = [...paperProblems(w, true)];
  if (w.assets.some((a) => !executableSymbol(a)))
    issues.push("This testnet runner requires exact Hyperliquid perpetuals for every observation and order.");
  if (
    w.stages.some(
      (s) =>
        !(s.side === "long" || s.side === "short") ||
        s.amount.unit !== "usd" ||
        !Number.isInteger(s.amount.value) ||
        s.amount.value! < 12 ||
        s.amount.value! > 200 ||
        s.leverage > 30 ||
        !Number.isInteger(s.leverage),
    )
  )
    issues.push(
      "Use long or short entries with 12–200 test USD of isolated margin and integer leverage up to 30×.",
    );
  if (
    w.stages.some(
      (s) =>
        s.repeat ||
        s.funding.kind !== "budget" ||
        s.after.some((d) => d.event !== "filled") ||
        s.exits.stopLossPct ||
        s.exits.takeProfitPct ||
        s.exits.trailingStopPct ||
        s.exits.timeExitHours ||
        s.exits.ladder.length,
    )
  )
    issues.push(
      "The testnet runner supports one-off entries and full-fill dependencies. Recurring orders, exits and profit recycling need a matching execution adapter.",
    );
  if (
    w.signals.some(
      (s) =>
        !["price", "price_change", "drawdown", "indicator", "timer"].includes(s.kind) ||
        s.drawdown?.reference === "last_fill",
    ) ||
    st.risk.tradingHours
  )
    issues.push("The workflow requires account state or a trading schedule that this runner cannot verify.");
  if (new Set(w.stages.map((s) => s.assetId)).size !== w.stages.length)
    issues.push("Choose one entry per testnet market to keep position ownership unambiguous.");
  const budget = w.budgetUsd ?? 0,
    margin = w.stages.reduce((sum, s) => sum + (s.amount.value ?? 0), 0);
  const risk = { ...st.risk, ...w.risk },
    gross = w.stages.reduce((sum, s) => sum + (s.amount.value ?? 0) * s.leverage, 0);
  if (
    !budget ||
    margin > budget ||
    gross > (budget * risk.maxTotalExposurePct) / 100 ||
    w.stages.some((s) => (s.amount.value ?? 0) * s.leverage > (budget * risk.maxPositionPct) / 100)
  )
    issues.push("Planned exposure or margin exceeds the strategy’s budget limits.");
  if (w.stages.length > risk.maxOrdersPerDay)
    issues.push("The planned entries exceed the strategy's daily order limit.");
  return [...new Set(issues)];
}
export function createProgram(
  id: string,
  strategyId: string,
  version: number,
  st: Strategy,
  master: string,
  agent: string,
  mode: TestnetProgram["mode"],
  at: number,
  equity: number,
): TestnetProgram {
  const issues = testnetIssues(st);
  if (issues.length) throw new HostError(422, issues[0]);
  return {
    id,
    strategyId,
    version,
    strategy: structuredClone(st),
    master,
    agent,
    mode,
    status: "running",
    checkpoint: createPaper(st.workflow!, at),
    stageOrders: {},
    pendingReason: "Waiting for a fresh testnet book.",
    day: new Date(at).toISOString().slice(0, 10),
    openingEquity: equity,
    createdAt: at,
  };
}
/** Only reuse the signal/risk evaluator. Its order hook always declines simulated fills. The caller gates dependencies on venue receipts. */
export function observeProgram(p: TestnetProgram, quotes: PaperQuote[], at: number) {
  const w = p.strategy.workflow!,
    observationOnly = { ...w, stages: w.stages.map((s) => ({ ...s, after: [] })) };
  const eligible = new Set<string>(),
    missing = new Set(w.assets.filter((a) => !quotes.some((q) => q.assetId === a.id)).map((a) => a.id));
  p.checkpoint = stepPaper(
    observationOnly,
    p.checkpoint,
    quotes,
    at,
    p.strategy.risk,
    [],
    [],
    (i) => {
      eligible.add(i.stageId);
      return false;
    },
    missing,
  );
  return eligible;
}
