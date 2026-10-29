import { afterAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RunEvent } from "../../contracts/src/events";
import { Run, BacktestRes } from "../../contracts/src/api";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { MockMarket } from "../../src/venues/market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { btcStrategy, T0 } from "../helpers";

const clock = new ManualClock(T0);
const registry = new Registry(MOCK_INSTRUMENTS); const market = new MockMarket(registry);
let btc = 99_000; market.overrides.set("hl:perp:BTC", () => btc);
const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, registry, market, autoTimers: false, compileDelayMs: 0 });
afterAll(() => q.runs.shutdown());
const owner = privateKeyToAccount(generatePrivateKey()); // throwaway, in-memory only
let token = "";
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await q.app.request("/v1" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
};
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

describe("HTTP mock flow", () => {
  let strategyId = "", runId = "", skId = "";
  it("status is public", async () => { const r = await call("GET", "/status"); expect(r.status).toBe(200); expect(r.json.mode).toBe("mock"); });
  it("401 envelope without auth", async () => { const r = await call("GET", "/me"); expect(r.status).toBe(401); expect(r.json.error.code).toBe("unauthorized"); expect(r.json.error.requestId).toMatch(/^req_/); });
  it("dev login + eligibility", async () => {
    const r = await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:alice-integration:${owner.address}` });
    expect(r.status).toBe(200); token = r.json.accessToken; expect(r.json.me.wallets[0].address).toBe(owner.address);
    expect(r.headers.get("set-cookie")).toMatch(/quiver_rt=.*HttpOnly/i);
    const e = await call("POST", "/me/eligibility", { nonUsPerson: true, countryOfResidence: "DE", acceptedTermsVersion: "draft-0" });
    expect(e.json.eligibility.stockTokens).toBe("allowed");
  });
  it("US IP: Stock Tokens are live-restricted but demo/paper/quotes still work (M3.1 geo policy)", async () => {
    const t = token; const r = await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:bob-from-the-us-test" }, { "x-mock-country": "US" });
    token = r.json.accessToken; const e = await call("POST", "/me/eligibility", { nonUsPerson: true, countryOfResidence: "US", acceptedTermsVersion: "draft-0" }, { "x-mock-country": "US" });
    expect(e.json.eligibility.stockTokens).toBe("blocked");
    const qt = await call("POST", "/quotes", { instrument: "robinhood:token:0x00000000000000000000000000000000000000a1", side: "buy", notionalUsd: "100" }, { "x-mock-country": "US" });
    expect(qt.status).toBe(200);
    const mk = await call("GET", "/markets/robinhood:token:0x00000000000000000000000000000000000000a1", undefined, { "x-mock-country": "US" });
    if (mk.status === 200) { expect(mk.json.geoRestricted).toBe(true); expect(mk.json.tradable).toBe(true); }
    const cm = await call("POST", "/compile", { thesis: "Buy $200 of NVDA if it drops below $120" }, { "x-mock-country": "US" }); expect(cm.status).toBe(200);
    const res = String(cm.json).trim().split("\n").map((l: string) => JSON.parse(l)).find((e: any) => e.type === "result"); expect(res.compiler).toBe("demo");
    const sv = await call("POST", "/strategies", { strategy: res.strategy }, { "x-mock-country": "US" }); expect(sv.status).toBe(201);
    const run = await call("POST", "/runs", { strategyId: sv.json.id, mode: "paper" }, { "x-mock-country": "US" }); expect(run.status).toBe(201);
    await call("POST", `/runs/${run.json.id}/control`, { action: "stop" }); token = t;
  });
  it("compile streams NDJSON ending in a result", async () => {
    const r = await call("POST", "/compile", { thesis: "Long BTC perp with $1000 at 2x when BTC goes above 100000, stop -5%" });
    const lines = (r.json as string).trim().split("\n").map((l) => JSON.parse(l)); expect(lines.at(-1).type).toBe("result");
  });
  it("validate + create + 409 on stale update + idempotent create", async () => {
    const v = await call("POST", "/strategies/validate", { strategy: btcStrategy() }); expect(v.json.ok).toBe(true);
    const c = await call("POST", "/strategies", { strategy: btcStrategy() }, { "idempotency-key": "k1" }); expect(c.status).toBe(201); strategyId = c.json.id;
    const again = await call("POST", "/strategies", { strategy: btcStrategy() }, { "idempotency-key": "k1" }); expect(again.json.id).toBe(strategyId);
    const u = await call("PUT", `/strategies/${strategyId}`, { strategy: btcStrategy({ name: "v2" }), expectedVersion: 1 }); expect(u.json.version).toBe(2);
    const stale = await call("PUT", `/strategies/${strategyId}`, { strategy: btcStrategy(), expectedVersion: 1 }); expect(stale.status).toBe(409);
    expect((await call("GET", "/strategies")).json.items).toHaveLength(1);
  });
  it("testnet/live runs are not enabled", async () => { const r = await call("POST", "/runs", { strategyId, mode: "live" }); expect(r.status).toBe(403); expect(r.json.error.code).toBe("mode_not_enabled"); });
  it("paper run: events, SSE replay + resume via Last-Event-ID", async () => {
    const r = await call("POST", "/runs", { strategyId, mode: "paper" }); expect(r.status).toBe(201); Run.parse(r.json); runId = r.json.id;
    await q.runs.tick(runId); clock.advance(15_000); btc = 101_000; await q.runs.tick(runId);
    const ev = await call("GET", `/runs/${runId}/events?since=-1`); const items = ev.json.items as any[];
    items.forEach((e) => RunEvent.parse(e)); expect(items.map((e) => e.seq)).toEqual(items.map((_, i) => i));
    expect(items.some((e) => e.type === "fill")).toBe(true);
    const ticket = (await call("POST", "/stream-tickets", { runId })).json.ticket;
    const res = await q.app.request(`/v1/runs/${runId}/events/stream?ticket=${ticket}&since=-1`);
    if (res.status !== 200) console.log("SSE", res.status, await res.clone().text()); expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const frames = await readSSE(res, (f) => f.filter((x) => x.id).length >= items.length);
    expect(frames[0].id).toBeUndefined(); expect(frames[0].event).toBe("status"); // snapshot frame, no id
    expect(frames.filter((f) => f.id).map((f) => Number(f.id))).toEqual(items.map((e) => e.seq));
    // resume from seq 2: only seq > 2, then live events arrive
    const ticket2 = (await call("POST", "/stream-tickets", { runId })).json.ticket; // M3.5: tickets are single-use
    const res2 = await q.app.request(`/v1/runs/${runId}/events/stream?ticket=${ticket2}`, { headers: { "last-event-id": "2" } });
    const p = readSSE(res2, (f) => f.some((x) => x.id && Number(x.id) === items.length));
    setTimeout(() => { clock.advance(15_000); void q.runs.tick(runId); }, 300);
    const f2 = await p; const ids = f2.filter((f) => f.id).map((f) => Number(f.id));
    expect(Math.min(...ids)).toBe(3); expect(ids).toContain(items.length);
  });
  it("M3.1: /runs/:id/events?ticket= is an SSE alias of /events/stream; without ticket it stays the JSON polling route", async () => {
    const ticket = (await call("POST", "/stream-tickets", { runId })).json.ticket;
    const res = await q.app.request(`/v1/runs/${runId}/events?ticket=${ticket}&since=-1`); expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const frames = await readSSE(res, (f) => f.filter((x) => x.id).length >= 2); expect(frames.filter((f) => f.id).length).toBeGreaterThanOrEqual(2);
    const bad = await q.app.request(`/v1/runs/${runId}/events?ticket=bogus`); expect(bad.status).toBe(401);
    const poll = await call("GET", `/runs/${runId}/events?since=-1`); expect(poll.status).toBe(200); expect(Array.isArray(poll.json.items)).toBe(true);
  });
  it("stream ticket is bound to its run", async () => { const res = await q.app.request(`/v1/runs/${runId}/events/stream?ticket=bogus`); expect(res.status).toBe(401); });
  it("pause/resume/stop_and_flatten", async () => {
    expect((await call("POST", `/runs/${runId}/control`, { action: "pause" })).json.status).toBe("paused");
    expect((await call("POST", `/runs/${runId}/control`, { action: "resume" })).json.status).toBe("running");
    const pf = await call("GET", "/portfolio"); expect(pf.json.positions.length).toBe(1);
    const s = await call("POST", `/runs/${runId}/control`, { action: "stop_and_flatten" }); expect(s.json.status).toBe("stopped");
    expect((await call("GET", "/portfolio")).json.positions).toHaveLength(0);
    expect((await call("GET", `/fills?runId=${runId}`)).json.items.length).toBe(2);
  });
  it("backtest completes", async () => {
    const r = await call("POST", "/backtests", { strategy: btcStrategy(), from: new Date(T0 - 7 * 86_400_000).toISOString(), to: new Date(T0).toISOString(), resolution: "1h" }); expect(r.status).toBe(202);
    let b; for (let i = 0; i < 50; i++) { b = await call("GET", `/backtests/${r.json.id}`); if (b.json.status === "done") break; await new Promise((x) => setTimeout(x, 20)); }
    expect(b!.json.status).toBe("done"); BacktestRes.parse(b!.json);
    const big = await call("POST", "/backtests", { strategy: btcStrategy(), from: new Date(T0 - 400 * 86_400_000).toISOString(), to: new Date(T0).toISOString() }); expect(big.status).toBe(422);
  });
  it("session key: prepare -> sign (viem test key) -> active -> run with key -> revoke halts run", async () => {
    const p = await call("POST", "/session-keys/prepare", { chainId: 46630, tokens: ["robinhood:token:0x00000000000000000000000000000000000000a1"], perTxCapUsd: "500", dailyCapUsd: "2000", expiresInDays: 7 });
    expect(p.status).toBe(200); skId = p.json.sessionKeyId; const d = p.json.signatureRequest.data;
    const sig = await owner.signTypedData({ ...d, message: { ...d.message, expiresAt: BigInt(d.message.expiresAt) } });
    const s = await call("POST", "/session-keys/submit", { sessionKeyId: skId, signature: sig, policyHash: p.json.policyHash }); if (s.status !== 200) console.log("SUBMIT", JSON.stringify(s.json)); expect(s.json.status).toBe("active");
    const run = await call("POST", "/runs", { strategyId, mode: "paper", sessionKeyId: skId }); expect(run.status).toBe(201);
    const rv = await call("DELETE", `/session-keys/${skId}`); expect(rv.json.sessionKey.status).toBe("revoked"); expect(rv.json.onchainRevoke.signatureRequest.data.primaryType).toBe("SessionKeyRevoke");
    const ev = await call("GET", `/runs/${run.json.id}/events?since=-1`); expect(ev.json.items.some((e: any) => e.type === "risk_halt" && e.rule === "session_key_revoked")).toBe(true);
    const bad = await call("POST", "/runs", { strategyId, mode: "paper", sessionKeyId: skId }); expect(bad.json.error.code).toMatch(/run_already_active|session_key_revoked/);
  });
  it("markets + quotes; Polymarket read-only", async () => {
    const m = await call("GET", "/markets?venue=hyperliquid"); expect(m.json.items.length).toBe(3);
    const qt = await call("POST", "/quotes", { instrument: "hl:perp:ETH", side: "buy", notionalUsd: "1000" }); expect(qt.status).toBe(200); expect(Number(qt.json.price)).toBeGreaterThan(0);
    const pm = await call("POST", "/quotes", { instrument: "pm:outcome:fed-cut-december:YES", side: "buy", notionalUsd: "10" }); expect(pm.json.error.code).toBe("venue_read_only");
  });
  it("refresh rotates the cookie", async () => {
    const r = await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:carol-refresh-test" });
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const a = await call("POST", "/auth/refresh", undefined, { cookie }); expect(a.status).toBe(200);
    const b = await call("POST", "/auth/refresh", undefined, { cookie }); expect(b.status).toBe(401);
  });
});
