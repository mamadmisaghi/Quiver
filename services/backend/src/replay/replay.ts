// M4.4 run replay: a deterministic frame timeline built ONLY from stored run events (+ the stored equity curve).
// Same inputs + same query => byte-identical frames and digest. Frame i covers [startTs + i*frameMs, startTs + (i+1)*frameMs).
import { createHash } from "node:crypto";
import type { RunEvent } from "../../contracts/src/events";
import type { z } from "zod";

type Ev = z.infer<typeof RunEvent>;
export interface ReplayOpts { frameMs: number; maxFrames: number; from?: number; to?: number }

export function summarize(e: Ev): string {
  switch (e.type) {
    case "fill": return `${e.side} ${e.qty} ${e.instrument} @ ${e.price}`;
    case "intent": return `order ${e.side} ${e.instrument} $${e.notionalUsd}`;
    case "rejected": return `rejected: ${e.code}`;
    case "error": return `error: ${e.code}`;
    case "status": return `status ${e.status}${e.reason ? ` (${e.reason})` : ""}`;
    case "risk_halt": return `risk halt: ${e.rule}`;
    case "trigger_fired": return `trigger ${e.triggerId} fired`;
    case "trigger_met": return `trigger ${e.triggerId} met`;
    case "approval_requested": return `approval requested ${e.side} ${e.instrument} $${e.notionalUsd}`;
    case "approval_resolved": return `approval ${e.decision}`;
    case "warning": return `warning: ${e.code}`;
    default: return e.type;
  }
}
const KEY = new Set(["fill", "rejected", "error", "status", "risk_halt", "trigger_fired", "approval_requested", "approval_resolved", "warning"]);

export function buildReplay(runId: string, events: Ev[], curve: [number, number][], o: ReplayOpts) {
  const iso = (t: number) => new Date(t).toISOString();
  const evs = events.map((e) => ({ e, t: Date.parse(e.ts) }));
  const first = evs[0]?.t ?? curve[0]?.[0] ?? 0, last = Math.max(evs.at(-1)?.t ?? first, curve.at(-1)?.[0] ?? first);
  const start = Math.max(first, o.from ?? first), end = Math.min(last, o.to ?? last);
  const total = end >= start ? Math.floor((end - start) / o.frameMs) + 1 : 0; const n = Math.min(total, o.maxFrames);
  const pos = new Map<string, { qty: string; avgEntry: string }>(); let ei = 0, ci = -1, eq: number | null = null; let seqLo = -1;
  // fold everything before the window so the first frame starts from the true state
  while (ei < evs.length && evs[ei]!.t < start) { apply(evs[ei]!.e); seqLo = evs[ei]!.e.seq; ei++; }
  while (ci + 1 < curve.length && curve[ci + 1]![0] < start) eq = curve[++ci]![1];
  function apply(e: Ev) { if (e.type === "fill") { if (Number(e.position.qty) === 0) pos.delete(e.instrument); else pos.set(e.instrument, { qty: e.position.qty, avgEntry: e.position.avgEntry }); } }
  const frames = [];
  for (let i = 0; i < n; i++) {
    const hi = start + (i + 1) * o.frameMs; const items: { seq: number; ts: string; type: string; summary: string }[] = []; let fills = 0, rej = 0, halts = 0;
    while (ei < evs.length && evs[ei]!.t < hi) { const { e } = evs[ei]!; apply(e); if (KEY.has(e.type)) items.push({ seq: e.seq, ts: e.ts, type: e.type, summary: summarize(e) });
      if (e.type === "fill") fills++; if (e.type === "rejected") rej++; if (e.type === "risk_halt") halts++; seqLo = e.seq; ei++; }
    while (ci + 1 < curve.length && curve[ci + 1]![0] < hi) eq = curve[++ci]![1];
    frames.push({ i, ts: iso(start + i * o.frameMs), lastSeq: seqLo, equityUsd: eq == null ? null : eq.toFixed(2).replace(/\.?0+$/, ""),
      positions: [...pos.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([instrument, p]) => ({ instrument, ...p })), events: items, counts: { fills, rejected: rej, halts } });
  }
  const chapters = evs.filter(({ e, t }) => t >= start && t <= end && (e.type === "status" || e.type === "risk_halt" || e.type === "fill")).map(({ e, t }) => ({ frame: Math.floor((t - start) / o.frameMs), seq: e.seq, type: e.type, summary: summarize(e) }))
    .filter((c, j, a) => c.type !== "fill" || a.findIndex((x) => x.type === "fill") === j); // first fill only
  const body = { runId, frameMs: o.frameMs, startTs: iso(start), endTs: iso(end), totalFrames: total, truncated: total > n, frames, chapters };
  return { ...body, digest: "sha256:" + createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}
