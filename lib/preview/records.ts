import { Strategy, StrategyRecord } from "@/lib/contracts";
import { humanize } from "@/services/backend/src/engine/humanize";
import { strategyNodes } from "@/services/backend/src/engine/nodes";
import { validateStrategy, hasErrors } from "@/services/backend/src/engine/validate";
import { MOCK_INSTRUMENTS, Registry } from "@/services/backend/src/venues/registry";

const registry = new Registry(MOCK_INSTRUMENTS);
export function previewRecord(raw: unknown, id: string, ownerId: string, createdAt = new Date().toISOString(), forkedFrom: string | null = null) {
  const strategy = Strategy.parse(raw), { issues } = validateStrategy(strategy, { registry, stockTokensAllowed: true, purpose: "draft" });
  if (hasErrors(issues)) throw new Error("Fix the strategy's validation errors before saving.");
  const h = humanize(strategy, registry);
  return StrategyRecord.parse({ id, ownerId, name: strategy.name, version: 1, status: "draft", strategy,
    humanized: h, nodes: strategyNodes(strategy, registry, h), issues,
    venues: [...new Set(strategy.workflow ? strategy.workflow.assets.flatMap((a) => { const venue = a.venue ?? a.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId)?.venue; return venue ? [venue] : []; }) : strategy.actions.map((a) => registry.get(a.instrument)!.venue))],
    createdAt, updatedAt: createdAt, activeRunId: null, forkedFrom });
}
