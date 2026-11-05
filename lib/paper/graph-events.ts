import type { Workflow } from "@/services/backend/contracts/src/workflow";
import type { PaperStepEvent } from "@/services/backend/src/workflows/paper";

export type EdgePulse = { from: string; to: string; id: number; delay?: number };

/** Each dependency follows its upstream event. Independent branches can travel together. */
export function paperGraphPulses(workflow: Workflow, events: PaperStepEvent[], tick: number) {
  const pulses = new Map<string, EdgePulse>(), arrivals = new Map<string, number>();
  function connect(from: string, to: string) {
    const delay = arrivals.get(from) ?? 0;
    arrivals.set(to, Math.max(arrivals.get(to) ?? 0, delay + 320));
    pulses.set(`${from}/${to}`, { from, to, id: tick, delay });
  }
  for (const e of events) {
    const gate = `wf_when_${e.stageId}`, order = `wf_do_${e.stageId}`;
    if (e.kind === "condition") {
      for (const signal of e.signals) connect(`wf_sig_${signal}`, gate);
    } else if (e.kind === "exit") {
      connect(order, `wf_exit_${e.stageId}`);
    } else {
      const stage = workflow.stages.find(s => s.id === e.stageId)!;
      if (e.newDependencies) {
        for (const dep of stage.after) connect(`wf_${dep.event === "filled" ? "do" : "exit"}_${dep.stageId}`, gate);
        if (!stage.when && !stage.after.length && stage.funding.kind === "budget") connect("wf_budget", gate);
      }
      connect(gate, order);
    }
  }
  return [...pulses.values()];
}
