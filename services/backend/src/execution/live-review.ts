import { expressionRefs, type Workflow } from "../../contracts/src/workflow";
import type { Strategy } from "../../contracts/src/strategy";
import { conditionText } from "../engine/workflow-view";
import type { PaperSession } from "../workflows/session";

export function networkFor(
  venue: string | undefined,
): "hyperliquid-mainnet" | "solana-mainnet" | "robinhood-mainnet" | null {
  switch (venue) {
    case "solana":
      return "solana-mainnet";
    case "robinhood":
      return "robinhood-mainnet";
    case "hyperliquid":
      return "hyperliquid-mainnet";
    default:
      return null;
  }
}

// A fresh run starts with no fills. An entry waiting on a paused entry can never unlock.
export function paperLivePlan(session: PaperSession, version: number) {
  if (
    session.mode !== "quotes" ||
    session.provenance === "imported" ||
    !session.strategy.workflow
  )
    throw Error("Choose a paper session with editable, live-quote rules.");
  if (version !== (session.editRevision ?? 0) + 1)
    throw Error(
      "The paper rules changed. Open the current session and review its latest edit.",
    );
  const strategy = structuredClone(session.strategy);
  const workflow = strategy.workflow!;
  const inactive = new Set(session.pausedRules);
  for (let pass = 0; pass < workflow.stages.length && inactive.size; pass++) {
    const before = inactive.size;
    for (const stage of workflow.stages)
      if (stage.after.some((d) => inactive.has(d.stageId)))
        inactive.add(stage.id);
    if (before === inactive.size) break;
  }
  const omitted = workflow.stages
    .filter((s) => inactive.has(s.id))
    .map((s) => s.id);
  if (omitted.length) {
    workflow.stages = workflow.stages.filter((s) => !inactive.has(s.id));
    if (!workflow.stages.length)
      throw Error(
        "All entry rules are paused or depend on a paused rule. Enable an entry in the paper session first.",
      );
    const usedSignals = new Set(
      workflow.stages.flatMap((s) => [...expressionRefs(s.when)]),
    );
    workflow.signals = workflow.signals.filter((s) => usedSignals.has(s.id));
    const assets = new Set([
      ...workflow.stages.map((s) => s.assetId),
      ...workflow.signals.map((s) => s.assetId),
    ]);
    workflow.assets = workflow.assets.filter((a) => assets.has(a.id));
  }
  return { strategy, omitted };
}

export function describeLiveStrategy(
  id: string,
  version: number,
  strategy: Strategy,
  sizes = new Map<string, number>(),
) {
  const workflow = strategy.workflow;
  if (!workflow) throw Error("This strategy has no executable workflow.");
  return {
    strategyId: id,
    version,
    name: strategy.name,
    budgetUsd: workflow.budgetUsd,
    risk: { ...strategy.risk, ...workflow.risk },
    stages: workflow.stages.map((stage) => {
      const asset = workflow.assets.find((a) => a.id === stage.assetId);
      const market = asset?.resolution?.candidates.find(
        (c) => c.id === asset.resolution?.selectedId,
      );
      return {
        id: stage.id,
        side: stage.side,
        amount: stage.amount,
        leverage: stage.leverage,
        symbol: market?.symbol ?? asset?.query ?? stage.assetId,
        network: networkFor(market?.venue),
        address: market?.address ?? null,
        assetId: market?.id ?? null,
        tokenDecimals:
          market?.venue === "hyperliquid"
            ? 18
            : market?.address
              ? (sizes.get(market.address) ?? null)
              : null,
        when: stage.when ? conditionText(workflow, stage.when) : "On start",
        conditional: !!stage.when,
        after: stage.after,
        repeat: stage.repeat,
        exits: stage.exits,
      };
    }),
  };
}
export type LiveReview = ReturnType<typeof describeLiveStrategy> & {
  reviewHash?: string;
};
export type ReviewStage = LiveReview["stages"][number];
export function ruleTiming(stage: ReviewStage, stages: ReviewStage[]) {
  const waits = stage.after.map((dep) => {
    const prior = stages.find((s) => s.id === dep.stageId);
    return (
      (prior?.symbol ?? dep.stageId) + " " + dep.event.replaceAll("_", " ")
    );
  });
  return [
    waits.length ? "After " + waits.join(" and ") : "",
    stage.conditional || !waits.length ? stage.when : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
export function orderSize(amount: Workflow["stages"][number]["amount"]) {
  if (amount.value === null) return "Size required";
  const value = amount.value.toLocaleString("en-US", {
    maximumSignificantDigits: 12,
  });
  if (amount.unit === "usd") return "$" + value;
  if (amount.unit === "native") return value + " units";
  return value + "% of " + amount.unit.slice(4);
}
