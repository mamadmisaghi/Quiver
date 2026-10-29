// Synchronous fixture graph for server-rendered demo surfaces (landing). MOCK.
// QA P2 LCP: no runtime zod here, so screens that only need the demo graph don't ship the contracts
// before first paint. The same fixtures are strictly zod-parsed in mock.ts (and by the contract parse check),
// and parsing only reorders keys, so these casts are value-identical.
import type { z } from "zod";
import type * as C from "@/lib/contracts";
import { PARTIAL_NODES, STRATEGY_RAW, HUMANIZED } from "./fixtures";
import { strategyEdges, type GNode } from "./graph";
export const demoStrategy = STRATEGY_RAW as z.infer<typeof C.Strategy>;
export const demoNodes: GNode[] = PARTIAL_NODES.map((n) => ({ ...n }) as GNode);
export const demoEdges = strategyEdges(demoStrategy).map((e) => ({ ...e, hot: true }));
export const demoHumanized = HUMANIZED as z.infer<typeof C.Humanized>;
