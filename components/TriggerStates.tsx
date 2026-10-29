"use client";
// M4.6 run view: what each trigger is waiting for, from tick.triggers[] (state, heldForSec, cooldownUntil, fires).
// Ellis hooks: [data-motion="trigger-hold"] is the hold bar (width via --p, 0–1); [data-motion="trigger-state"] carries data-state.
import type { RunEvent, StrategyRecord } from "@/lib/api";

export type TrigTick = Extract<RunEvent, { type: "tick" }>["triggers"][number];
const STATE: Record<TrigTick["state"], { label: string; cls: string }> = {
  ready: { label: "Watching", cls: "border-line-2 text-ink-2" },
  holding: { label: "Holding", cls: "border-accent/50 text-accent" },
  cooldown: { label: "Cooling down", cls: "border-line-2 text-muted" },
  done: { label: "Done", cls: "border-line text-muted" },
  blocked: { label: "Blocked", cls: "border-warn/50 text-warn" },
};
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s` : `${Math.max(0, Math.floor(s))}s`);

function detail(t: StrategyRecord["strategy"]["triggers"][number], st: TrigTick | undefined, now: number): string {
  if (!st) return "Waiting for the first check.";
  const max = t.maxFires == null ? "no limit" : `${st.fires} of ${t.maxFires}`;
  switch (st.state) {
    case "ready": return st.conditionTrue === false ? `Condition not met yet · fired ${max}` : st.conditionTrue == null ? `Missing a reading · fired ${max}` : `Fired ${max}`;
    case "holding": return `True for ${dur(st.heldForSec)} of ${dur(t.forMinutes * 60)} needed`;
    case "cooldown": return st.cooldownUntil ? `Can fire again in ${dur((Date.parse(st.cooldownUntil) - now) / 1000)} · fired ${max}` : `Cooling down · fired ${max}`;
    case "done": return t.maxFires == null ? "Finished" : `Fired ${st.fires} of ${t.maxFires} — it won’t fire again this run`;
    case "blocked": return "A risk rule or market hours is holding it back";
  }
}

export default function TriggerStates({ rec, states, now }: { rec: StrategyRecord; states: Record<string, TrigTick>; now: number }) {
  const trs = rec.strategy.triggers;
  return (
    <section aria-label="Triggers" className="mt-5 rounded-[14px] border border-line bg-bg-2" data-testid="trigger-states">
      <h2 className="border-b border-line px-5 py-3.5 text-[14px] font-medium">Triggers <span className="ml-1 text-[12px] font-normal text-muted">what each one is waiting for</span></h2>
      <ul className="divide-y divide-line">
        {trs.map((t, i) => {
          const st = states[t.id]; const s = STATE[st?.state ?? "ready"];
          const p = st?.state === "holding" && t.forMinutes > 0 ? Math.min(1, st.heldForSec / (t.forMinutes * 60)) : null;
          return (
            <li key={t.id} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center" data-testid="trigger-row">
              <div className="min-w-0">
                <div className="text-[13.5px] text-ink">{rec.humanized.when[i] ?? t.id}</div>
                <div className="tnum mt-0.5 text-[12.5px] text-muted" aria-live="polite">{detail(t, st, now)}</div>
                {p != null && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5" aria-hidden><div data-motion="trigger-hold" style={{ ["--p" as string]: p, width: `${p * 100}%` }} className="h-full rounded-full bg-accent" /></div>}
              </div>
              <span data-motion="trigger-state" data-state={st?.state ?? "ready"} className={`justify-self-start rounded-full border px-2.5 py-0.5 text-[12px] sm:justify-self-end ${s.cls}`}>{st ? s.label : "Starting"}</span>
            </li>);
        })}
      </ul>
    </section>
  );
}
