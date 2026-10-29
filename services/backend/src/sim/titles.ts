// M4.6/M4.7 human-readable approval titles (shared by the API view and the approval_requested event).
import type { Registry } from "../venues/registry";
import type { ApprovalRec } from "./executor";
export function actionTitle(x: Pick<ApprovalRec, "instrument" | "action" | "exitOf" | "side">, registry: Registry): string {
  const sym = registry.get(x.instrument)?.symbol ?? x.instrument; const a = x.action;
  if (a.type === "close" || x.exitOf) return `Close ${sym}${x.exitOf ? " (exit rule)" : ""}`;
  const v = a.size.value; const amt = a.size.unit === "usd" ? `$${v} of ` : a.size.unit === "pct_equity" ? `${v}% of equity in ` : `${v} `;
  return `${x.side[0]!.toUpperCase()}${x.side.slice(1)} ${amt}${sym}${a.leverage > 1 ? ` at ${a.leverage}x` : ""}`;
}
