// Regenerates contracts/fixtures/ext.*.json from the mock API (deterministic clock + synthetic market + seeded ids).
//   npm run fixtures:gen          rewrite the files
//   npm run fixtures:gen:check    regenerate in memory and exit 1 if any checked-in file differs
import { readFileSync, writeFileSync } from "node:fs";
import { seededBytes, setIdRandom } from "../src/lib/ids";
const CHECK = process.argv.includes("--check");
setIdRandom(seededBytes(0x51517));
import { createApp } from "../src/api/app";
import { loadConfig } from "../src/config";
import { ManualClock } from "../src/lib/clock";
const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
const OPS = "fixture-ops-token-not-a-secret-0000000000"; // fixture only; real OPS_TOKEN is the operator's
const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", OPS_TOKEN: OPS }), clock, autoTimers: false, compileDelayMs: 0,
  alertResolver: async () => [{ address: "93.184.215.14", family: 4 }], alertTransport: async () => 200 }); // M4.0: no DNS/network in fixtures
let tok = ""; const call = async (m: string, p: string, b?: unknown) => (await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) })).json() as any;
const lr = await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:fixture-user-example" }); tok = lr.accessToken;
const pubs = await call("GET", "/public/strategies");
const detail = await call("GET", `/public/strategies/${pubs.items[0].id}`);
const lena = pubs.items.find((x: any) => x.author.handle === "@demo_lena");
const fork = await call("POST", `/public/strategies/${lena.id}/fork`);
const run = await call("POST", "/runs", { strategyId: fork.id, mode: "paper", startingEquityUsd: "10000" });
if (!run.id) throw new Error("run start failed: " + JSON.stringify(run));
for (let i = 0; i < 30; i++) { clock.advance(60_000); await q.runs.tick(run.id); }
tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:fixture-user-example" })).accessToken; // access token TTL is 15 min
const out: Record<string, unknown> = {
  "ext.market.json": (await call("GET", "/markets")).items[0],
  "ext.strategy-record.json": fork,
  "ext.run-equity.json": await call("GET", `/runs/${run.id}/equity?points=10`),
  "ext.public-strategies.json": pubs, "ext.public-strategy.json": detail,
  "ext.traders.json": await call("GET", "/traders?window=30d"),
  "ext.rewards.json": await call("GET", "/rewards"), "ext.revenue.json": await call("GET", "/revenue"), "ext.skills.json": await call("GET", "/skills"),
};
// v1.2 (M3.8) + ops (M3.7): card while running, then ops list, then stop-all.
out["ext.run-card.json"] = await call("GET", `/runs/${run.id}/card`);
out["ext.settings.json"] = await call("GET", "/settings");
const user = tok; tok = OPS; out["ops.runs.json"] = await call("GET", "/ops/runs"); tok = user;
const fork2 = await call("POST", `/public/strategies/${pubs.items.find((x: any) => x.author.handle === "@demo_okafor").id}/fork`);
const run2 = await call("POST", "/runs", { strategyId: fork2.id, mode: "paper" });
out["ext.stop-all.json"] = await call("POST", "/runs/stop-all", {});
tok = OPS; out["ops.stop.json"] = await call("POST", `/ops/runs/${run2.id}/stop`); tok = "";
out["ext.landing.json"] = await call("GET", "/public/landing");
// M4.0 alerts (signingSecret is random and only returned by PUT, so the fixture uses GET).
tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:fixture-user-example" })).accessToken;
await call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example.com/quiver" });
out["alerts.settings.json"] = await call("GET", "/alerts/settings");
out["alerts.rule.json"] = await call("POST", "/alerts/rules", { runId: null, events: ["fill", "risk_halt", "status"] });
await call("POST", "/alerts/test");
out["alerts.deliveries.json"] = await call("GET", "/alerts/deliveries");
{ const d = [...q.alerts.deliveries.values()][0]; out["alerts.webhook-payload.json"] = q.alerts.payload(d); }
// M4.1 partial close: @demo_marco opens SOL perp + token within 20 cycles; close 25% of SOL.
{ const m = await call("POST", `/public/strategies/${pubs.items.find((x: any) => x.author.handle === "@demo_marco").id}/fork`);
  const r3 = await call("POST", "/runs", { strategyId: m.id, mode: "paper", startingEquityUsd: "10000" });
  for (let i = 0; i < 20; i++) { clock.advance(60_000); await q.runs.tick(r3.id); }
  tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:fixture-user-example" })).accessToken;
  out["runs.position-close.json"] = await call("POST", `/runs/${r3.id}/positions/close`, { instrument: "hl:perp:SOL", pct: 25 });
  out["runs.replay.json"] = await call("GET", `/runs/${r3.id}/replay?frameMs=300000`); } // M4.4
// M4.2 approvals: confirm_each run proposes; list pending, approve the first.
{ const m = await call("POST", `/public/strategies/${pubs.items.find((x: any) => x.author.handle === "@demo_marco").id}/fork`);
  const r4 = await call("POST", "/runs", { strategyId: m.id, mode: "paper", approvalMode: "confirm_each", approvalTtlSec: 300 });
  for (let i = 0; i < 30; i++) { clock.advance(60_000); await q.runs.tick(r4.id); if ([...q.runs.approvalsOf(r4.id).values()].some((x) => x.status === "pending")) break; }
  tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:fixture-user-example" })).accessToken;
  out["approvals.pending.json"] = await call("GET", `/approvals?status=pending&runId=${r4.id}`);
  out["approvals.approved.json"] = await call("POST", `/approvals/${out["approvals.pending.json"].items[0].id}`, { decision: "approve" });
  out["runs.get.json"] = await call("GET", `/runs/${r4.id}`); // M4.7 triggerStates
  out["events.connect-snapshot.json"] = q.runs.snapshotFrames(r4.id); // M4.7 frames sent on SSE connect/resume (status, tick, triggers_snapshot)
  out["events.approval-requested.json"] = q.store.runs.get(r4.id)!.events.find((e: any) => e.type === "approval_requested"); // M4.7
  // M4.6: approve on a halted run → 409 with details.runStatus/haltReason
  for (let i = 0; i < 60; i++) { clock.advance(60_000); await q.runs.tick(r4.id); if ([...q.runs.approvalsOf(r4.id).values()].some((x) => x.status === "pending")) break; }
  tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:fixture-user-example" })).accessToken;
  const nxt = [...q.runs.approvalsOf(r4.id).values()].find((x) => x.status === "pending");
  if (nxt) { q.runs.haltExternal(r4.id, "geo_block", "Stock tokens are not available in your region."); const cf = await call("POST", `/approvals/${nxt.id}`, { decision: "approve" }); cf.error.requestId = "req_fixture"; out["approvals.conflict.json"] = cf; } }
// M4.3 portfolio views over the fixture user's paper runs (several above, some stopped).
out["portfolio.runs.json"] = await call("GET", "/portfolio/runs");
out["portfolio.allocation.json"] = await call("GET", "/portfolio/allocation?by=venue");
out["portfolio.history.json"] = await call("GET", "/portfolio/history?points=20");
out["positions.paper.json"] = await call("GET", "/positions?mode=paper"); // M4.6
// M4.5 autopilot: rotate two fixture forks every 15 min, then show state + log.
{ const ids: string[] = []; for (const p of pubs.items.slice(0, 2)) ids.push((await call("POST", `/public/strategies/${p.id}/fork`)).id);
  for (const l of [...q.runs.live.values()]) await q.runs.control(l.run.id, "stop"); // free the per-user active-run cap
  await call("PUT", "/autopilot", { enabled: true, strategyIds: ids, rotateEveryMin: 15 });
  const uid = [...q.store.users.values()].find((u) => u.label === "fixture-user-example")!.id;
  for (let i = 0; i < 16; i++) { clock.advance(60_000); for (const l of [...q.runs.live.values()]) await q.runs.tick(l.run.id); await q.autopilot.step(uid); }
  tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:fixture-user-example" })).accessToken;
  out["autopilot.state.json"] = await call("GET", "/autopilot");
  out["autopilot.log.json"] = await call("GET", "/autopilot/log"); }
// M4.8 public leaderboard (no auth) + share card for the fixture user's first run
{ const t0 = tok; tok = ""; out["public.leaderboard.json"] = await call("GET", "/public/leaderboard?period=30d&limit=10"); tok = t0;
  const sh = await call("POST", `/runs/${run.id}/card/share`); tok = "";
  out["public.card.json"] = await call("GET", `/public/cards/${sh.token}`); tok = t0;
  out["runs.card-share.json"] = { ...sh, token: "crd_" + "x".repeat(32), path: `/v1/public/cards/crd_${"x".repeat(32)}` }; }
{ for (const l of [...q.runs.live.values()]) await q.runs.control(l.run.id, "stop");
  const ir = await call("POST", "/runs", { strategyId: fork.id, mode: "paper", startingEquityUsd: "10000" });
  const p = await call("POST", `/runs/${ir.id}/instruct`, { text: "Change size to $250, stop loss 5% and take profit 12%" });
  const a = await call("POST", `/runs/${ir.id}/instruct/${p.id}/apply`); const M = "ins_" + "0".repeat(20);
  out["runs.instruct.json"] = { ...p, id: M }; out["runs.instruct-apply.json"] = { ...a, proposal: { ...a.proposal, id: M } }; }
q.runs.shutdown();
const diffs: string[] = [];
for (const [f, v] of Object.entries(out)) {
  const path = `contracts/fixtures/${f}`; const text = JSON.stringify(v, null, 2) + "\n";
  if (CHECK) { let cur = ""; try { cur = readFileSync(path, "utf8"); } catch { /* missing */ } if (cur !== text) diffs.push(f); } else writeFileSync(path, text);
}
if (CHECK) {
  if (diffs.length) { console.error(`fixtures out of date (run npm run fixtures:gen): ${diffs.join(", ")}`); process.exit(1); }
  console.log(`fixtures up to date (${Object.keys(out).length} files)`);
} else console.log("wrote", Object.keys(out).length);
