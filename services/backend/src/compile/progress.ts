import type { CompileEvent } from "../../contracts/src/events";

type Progress = Extract<CompileEvent, { type: "progress" }>;
const stepFor = {
  interpret: "reading", audit: "checking_risk", markets: "resolving_markets",
  feeds: "choosing_feeds", rules: "writing_rules", risk: "checking_risk",
} as const;

export function compileProgress(operation: keyof typeof stepFor, status: "working" | "done", label: string, attempt = 1): Progress {
  return { type: "progress", step: stepFor[operation], operation, status, label, attempt };
}

export function correctionLabel(issues: readonly string[]) {
  const text = issues.join(" ");
  if (/dependenc|sequenc|ordering|predecessor|stage order/i.test(text)) return "Rechecking the order sequence";
  if (/leverage|margin|size|amount/i.test(text)) return "Rechecking order sizes and leverage";
  if (/asset|ticker|symbol|market/i.test(text)) return "Rechecking the requested markets";
  if (/direction|condition|threshold|percent/i.test(text)) return "Rechecking the price conditions";
  return "Revising the draft against your instructions";
}
