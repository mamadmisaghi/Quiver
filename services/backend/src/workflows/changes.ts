import { z } from "zod";
import { Strategy } from "../../contracts/src/strategy";
import type { PlanExpr } from "../../contracts/src/workflow";
import { paperProblems } from "./paper";
import type { PaperSession } from "./session";
import { assetSymbol, stageLabel } from "./observations";

export const EditField = z.object({
  key: z.string().min(1).max(160),
  group: z.string().max(32),
  rule: z.string().max(240),
  kind: z.enum([
    "size",
    "leverage",
    "stop",
    "profit",
    "trail",
    "hours",
    "interval",
    "times",
    "enabled",
    "threshold",
    "dailyLoss",
    "orders",
    "exposure",
    "position",
  ]),
  label: z.string().max(420),
  unit: z.string().max(32),
  value: z.number().finite().nullable(),
});
export type EditField = z.infer<typeof EditField>;
export const EditOps = z
  .array(z.object({ key: z.string().min(1).max(160), value: z.number().finite() }).strict())
  .min(1)
  .max(24);
export type EditOps = z.infer<typeof EditOps>;

export function formatEdit(value: number | null, unit: string) {
  if (value === null) return "Off";
  if (unit === "switch") return value === 1 ? "Enabled" : "Paused";
  const n = Number(value.toPrecision(12)).toLocaleString("en-US", { maximumSignificantDigits: 12 });
  if (unit === "USD") return "$" + n;
  if (unit === "%" || unit === "×") return n + unit;
  return n + (unit ? " " + unit : "");
}

type Field = EditField & { write: (value: number) => void };
function catalog(strategy: Strategy, paused: Set<string>): Field[] {
  const workflow = strategy.workflow!;
  const fields: Field[] = [];
  function add(
    group: string,
    rule: string,
    suffix: string,
    kind: EditField["kind"],
    label: string,
    unit: string,
    value: number | null,
    write: Field["write"],
  ) {
    fields.push({ key: group + "." + suffix, group, rule, kind, label, unit, value, write });
  }
  for (const stage of workflow.stages) {
    const group = stage.id,
      rule = stageLabel(workflow, group);
    const asset = workflow.assets.find((a) => a.id === stage.assetId)!;
    const selected = asset.resolution?.candidates.find((c) => c.id === asset.resolution?.selectedId);
    const units = {
      usd: "USD",
      native: "units",
      pct_equity: "% of equity",
      pct_position: "% of position",
      pct_profits: "% of profits",
    };
    const field = (
      kind: EditField["kind"],
      label: string,
      unit: string,
      value: number | null,
      write: Field["write"],
    ) => add(group, rule, kind, kind, label, unit, value, write);
    field("size", "Order size", units[stage.amount.unit], stage.amount.value, (v) => {
      stage.amount.value = v;
    });
    if ((selected?.kind ?? asset.kind) === "perp" && stage.side !== "sell")
      field("leverage", "Leverage", "×", stage.leverage, (v) => {
        stage.leverage = v;
      });
    if (stage.side !== "sell") {
      const exits = [
        ["stop", "Stop loss", "stopLossPct", "%"],
        ["profit", "Take profit", "takeProfitPct", "%"],
        ["trail", "Trailing stop", "trailingStopPct", "%"],
        ["hours", "Time exit", "timeExitHours", "hours"],
      ] as const;
      for (const [kind, label, key, unit] of exits)
        field(kind, label, unit, stage.exits[key], (v) => {
          stage.exits[key] = v;
        });
    }
    if (stage.repeat) {
      const repeat = stage.repeat;
      field("interval", "Repeat interval", "min", repeat.intervalMinutes, (v) => {
        repeat.intervalMinutes = v;
      });
      field("times", "Maximum fills", "fills", repeat.maxTimes, (v) => {
        repeat.maxTimes = v;
      });
    }
    field("enabled", "Entry rule", "switch", paused.has(group) ? 0 : 1, (v) => {
      if (v !== 0 && v !== 1) throw Error("Choose enabled or paused for the entry rule.");
      if (v === 0) paused.add(group);
      else paused.delete(group);
    });

    function threshold(expr: PlanExpr, path: string) {
      if ("args" in expr) {
        expr.args.forEach((child, i) => threshold(child, path + "." + i));
        return;
      }
      if ("arg" in expr) {
        threshold(expr.arg, path + ".not");
        return;
      }
      const ref = "ref" in expr.left ? expr.left : expr.right;
      const lit = "lit" in expr.right ? expr.right : expr.left;
      if (!("ref" in ref) || !("lit" in lit) || typeof lit.lit !== "number") return;
      const [id, prop] = ref.ref.split(".");
      const sig = workflow.signals.find((s) => s.id === id);
      if (!sig) return;
      const symbol = sig.assetId ? assetSymbol(workflow, sig.assetId) : "";
      const move = sig.kind === "price_change" || sig.kind === "drawdown";
      const negative = sig.kind === "price_change" && lit.lit < 0;
      const kind = move
        ? negative || sig.kind === "drawdown"
          ? "drop"
          : "rise"
        : (sig.indicator?.name.toUpperCase() ?? sig.kind);
      const percent =
        move ||
        ["funding", "odds"].includes(sig.kind) ||
        prop === "pnl_pct" ||
        sig.indicator?.name === "pct_change";
      const scale = ["odds", "funding"].includes(sig.kind) ? 100 : 1;
      const unit = percent ? "%" : sig.kind === "price" || prop === "value_usd" ? "USD" : "";
      const value = (negative ? -lit.lit : lit.lit) * scale;
      add(group, rule, path, "threshold", (symbol + " " + kind + " threshold").trim(), unit, value, (v) => {
        if (move && v < 0)
          throw Error("Use the magnitude of the price move. Its direction is shown in the preview.");
        if ((sig.kind === "price" && v <= 0) || (sig.kind === "odds" && (v < 0 || v > 100)))
          throw Error("That threshold is outside this market’s range.");
        lit.lit = (negative ? -v : v) / scale;
        // Thresholds live on the gate. A shared signal label must still describe every consumer after an edit.
        sig.description = (
          symbol +
          " " +
          (move
            ? sig.kind === "drawdown"
              ? "drawdown"
              : "price change"
            : (sig.indicator?.name.toUpperCase() ?? sig.kind))
        ).trim();
      });
    }
    if (stage.when) threshold(stage.when, "when");
  }
  const risk = [
    ["dailyLoss", "Daily loss limit", "maxDailyLossPct", "%"],
    ["orders", "Daily order limit", "maxOrdersPerDay", "orders"],
    ["position", "Maximum position", "maxPositionPct", "%"],
    ["exposure", "Total exposure limit", "maxTotalExposurePct", "%"],
  ] as const;
  for (const [kind, label, key, unit] of risk)
    add("$risk", "Session risk", key, kind, label, unit, strategy.risk[key], (v) => {
      strategy.risk[key] = v;
      workflow.risk = { ...workflow.risk, [key]: v };
    });
  return fields;
}

export function editFields(session: PaperSession): EditField[] {
  return catalog(session.strategy, new Set(session.pausedRules)).map(({ write, ...field }) => field);
}
export function preparePaperEdit(session: PaperSession, raw: EditOps) {
  const ops = EditOps.parse(raw);
  if (new Set(ops.map((o) => o.key)).size !== ops.length)
    throw Error("A field has conflicting changes. Specify one value for it.");
  const strategy = structuredClone(session.strategy),
    paused = new Set(session.pausedRules);
  const fields = new Map(catalog(strategy, paused).map((f) => [f.key, f]));
  const changes: { rule: string; label: string; before: string; after: string }[] = [];
  for (const op of ops) {
    const f = fields.get(op.key);
    if (!f) throw Error("This rule is no longer available. Preview the change again.");
    if (op.value === f.value) continue;
    if (f.kind === "leverage" && session.state?.positions[f.group]?.qty)
      throw Error("An open position uses this leverage. Change it once that position is closed.");
    f.write(op.value);
    changes.push({
      rule: f.rule,
      label: f.label,
      before: formatEdit(f.value, f.unit),
      after: formatEdit(op.value, f.unit),
    });
  }
  if (!changes.length) throw Error("Those rules already have the requested values.");
  const parsed = Strategy.safeParse(strategy);
  if (!parsed.success)
    throw Error("That value is outside the allowed range. " + parsed.error.issues[0].message);
  const problem = paperProblems(parsed.data.workflow!, true)[0];
  if (problem) throw Error(problem);
  return {
    strategy: parsed.data,
    pausedRules: [...paused],
    changes,
    summaries: changes.map((c) => c.rule + " · " + c.label + " " + c.before + " → " + c.after),
  };
}
