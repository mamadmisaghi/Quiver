// M4.7 — trigger-state snapshot on SSE connect/resume + GET /runs/:id triggerStates; approval_requested names.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { Run } from "../../contracts/src/api";
import { RunEvent } from "../../contracts/src/events";
/** Read SSE frames from a streaming response until `until` returns true or timeout. */
async function readSSE(res: Response, until: (frames: { id?: string; event: string; data: any }[]) => boolean, ms = 3000) {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ""; const frames: { id?: string; event: string; data: any }[] = [];
  const deadline = Date.now() + ms; let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  while (Date.now() < deadline && !until(frames)) {
    pending ??= reader.read();
    const r = await Promise.race([pending, new Promise<null>((res) => setTimeout(() => res(null), 100))]);
    if (r === null) continue; pending = null; if (r.done) break; buf += dec.decode(r.value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); const f: any = {}; for (const l of raw.split("\n")) { const [k, ...v] = l.split(":"); const val = v.join(":").replace(/^ /, ""); if (k === "id") f.id = val; if (k === "event") f.event = val; if (k === "data") f.data = JSON.parse(val); } if (f.event) frames.push(f); }
  }
  await reader.cancel(); return frames;
}
async function setup(w = "m47-trigger-snap-user-001") {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  let tok = ""; const login = async () => (tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:${w}` }) })).json() as any).accessToken);
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => null) as any }; };
  await login(); const pubs = (await call("GET", "/public/strategies")).j.items;
  const marco = (await call("POST", `/public/strategies/${pubs.find((x: any) => x.author.handle === "@demo_marco").id}/fork`)).j;
  return { q, clock, call, login, marco };
}

describe("M4.7", () => {
  it("GET /runs/:id has triggerStates for every trigger; [] once stopped", async () => {
    const s = await setup(); const run = (await s.call("POST", "/runs", { strategyId: s.marco.id, mode: "paper" })).j;
    for (let i = 0; i < 5; i++) { s.clock.advance(60_000); await s.q.runs.tick(run.id); } await s.login();
    const r = Run.parse((await s.call("GET", `/runs/${run.id}`)).j);
    expect(r.triggerStates.map((t) => t.triggerId)).toEqual(s.marco.strategy.triggers.map((t: any) => t.id));
    const last = [...s.q.store.runs.get(run.id)!.events].reverse().find((e) => e.type === "tick") as any;
    expect(r.triggerStates.map((t) => [t.state, t.fires])).toEqual(last.triggers.map((t: any) => [t.state, t.fires]));
    await s.call("POST", `/runs/${run.id}/control`, { action: "stop" }); expect((await s.call("GET", `/runs/${run.id}`)).j.triggerStates).toEqual([]);
  });
  it("SSE connect and resume both start with status + triggers_snapshot (no id) before log frames", async () => {
    const s = await setup("m47-trigger-sse-user-0001"); const run = (await s.call("POST", "/runs", { strategyId: s.marco.id, mode: "paper" })).j;
    for (let i = 0; i < 3; i++) { s.clock.advance(60_000); await s.q.runs.tick(run.id); } await s.login();
    for (const hdr of [{}, { "last-event-id": "2" }] as Record<string, string>[]) {
      const ticket = (await s.call("POST", "/stream-tickets", { runId: run.id })).j.ticket;
      const res = await s.q.app.request(`/v1/runs/${run.id}/events/stream?ticket=${ticket}`, { headers: hdr });
      const f = await readSSE(res, (fr) => fr.some((x) => x.event === "triggers_snapshot"));
      const snap = f.find((x) => x.event === "triggers_snapshot")!; expect(snap.id).toBeUndefined();
      const e = RunEvent.parse(snap.data); expect(e.type === "triggers_snapshot" && e.triggers.length).toBe(s.marco.strategy.triggers.length);
      expect(f.findIndex((x) => x.event === "triggers_snapshot")).toBeLessThan(Math.max(f.findIndex((x) => x.id !== undefined), f.length));
    }
  });
  it("approval_requested carries strategyName + actionTitle", async () => {
    const s = await setup("m47-approval-event-user-1"); const run = (await s.call("POST", "/runs", { strategyId: s.marco.id, mode: "paper", approvalMode: "confirm_each" })).j;
    const evs = () => s.q.store.runs.get(run.id)!.events.filter((e) => e.type === "approval_requested") as any[];
    for (let i = 0; i < 60 && !evs().length; i++) { s.clock.advance(60_000); await s.q.runs.tick(run.id); }
    const e = RunEvent.parse(evs()[0]) as any; expect(e.strategyName).toBe(s.marco.name); expect(e.actionTitle).toMatch(/^(Buy|Sell|Long|Short|Close) /);
  });
});
