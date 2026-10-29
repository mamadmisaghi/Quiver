// M4.2.1: fixes for Robin's gate on 9c8f10e (webhook transport, halted/paused approvals, slow receivers, SSRF hardening, misc).
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AlertService, makeHttpsTransport, webhookProvider, type Transport } from "../../src/alerts/service";
import { checkUrlShape, isBlockedIp, resolvePublic } from "../../src/alerts/ssrf";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { gate } from "../../src/sim/risk";
import { MAX_RESOLVED_APPROVALS } from "../../src/sim/executor";

// ---------- real local TLS server (self-signed, generated per run in a tmpdir; never committed) ----------
const dir = mkdtempSync(join(tmpdir(), "m421-tls-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=hooks.test", "-addext", "subjectAltName=DNS:hooks.test"], { stdio: "ignore" });
const key = readFileSync(join(dir, "k.pem")), cert = readFileSync(join(dir, "c.pem"));
type Mode = "ok" | "trickle" | "huge" | "hang";
let mode: Mode = "ok"; const got: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
const srv = createServer({ key, cert }, (req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    got.push({ headers: req.headers, body: b });
    if (mode === "ok") { res.writeHead(204); res.end(); }
    else if (mode === "huge") { res.writeHead(200); res.end(Buffer.alloc(200 * 1024, 120)); }
    else if (mode === "trickle") { res.writeHead(200); const t = setInterval(() => res.write("x"), 50); res.on("close", () => clearInterval(t)); }
    // hang: never respond
  });
});
let port = 0;
beforeAll(() => new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => { port = (srv.address() as any).port; r(); })));
afterAll(() => { srv.closeAllConnections(); srv.close(); });
const LOCAL = async () => [{ address: "127.0.0.1", family: 4 }];

describe("M4.2.1 P1-1 real TLS transport (Node >=20 lookup all:true)", () => {
  it("delivers over real TLS with a hostname URL (pinned lookup returns an array when asked)", async () => {
    mode = "ok"; got.length = 0;
    const st = await makeHttpsTransport({ ca: cert })(new URL(`https://hooks.test:${port}/h`), { address: "127.0.0.1", family: 4 }, { "x-a": "1" }, '{"v":1}');
    expect(st).toBe(204); expect(got[0].body).toBe('{"v":1}');
  });
  it("Robin pin-plain repro: as-shipped failed with 'Invalid IP address: undefined'; now succeeds", async () => {
    mode = "ok";
    const r = await makeHttpsTransport({ ca: cert })(new URL(`https://hooks.test:${port}/`), { address: "127.0.0.1", family: 4 }, {}, "{}").then(String, (e) => "ERR " + e.message);
    expect(r).toBe("204");
  });
  it("end-to-end provider with test-only allowance: signed, stable delivery id across retries", async () => {
    mode = "ok"; got.length = 0;
    const p = webhookProvider(LOCAL, makeHttpsTransport({ ca: cert }), { addresses: ["127.0.0.1"], ports: [String(port)] });
    const ctx = { url: `https://hooks.test:${port}/h`, secret: "whsec_test", body: '{"v":1}', deliveryId: "ald_x", ts: 1800000000 };
    expect(await p.send(ctx)).toEqual({ ok: true, status: 204 });
    expect(got[0].headers["x-quiver-signature"]).toBe("v1=" + createHmac("sha256", "whsec_test").update(`1800000000.{"v":1}`).digest("hex"));
    expect(got[0].headers["x-quiver-delivery"]).toBe("ald_x");
  });
  it("without the allowance the same local target is refused (SSRF intact)", async () => {
    const r = await webhookProvider(LOCAL, makeHttpsTransport({ ca: cert })).send({ url: `https://hooks.test/h`, secret: "s", body: "{}", deliveryId: "d", ts: 1 });
    expect(r).toMatchObject({ ok: false, retry: false });
  });
  it("allowance is ignored when NODE_ENV=production", async () => {
    const prev = process.env.NODE_ENV; process.env.NODE_ENV = "production";
    try { const r = await webhookProvider(LOCAL, makeHttpsTransport({ ca: cert }), { addresses: ["127.0.0.1"], ports: [String(port)] }).send({ url: `https://hooks.test:${port}/h`, secret: "s", body: "{}", deliveryId: "d", ts: 1 }); expect(r.ok).toBe(false); }
    finally { process.env.NODE_ENV = prev; }
  });
});

describe("M4.2.1 P2 slow receivers", () => {
  it("total deadline: a trickling receiver is cut at the deadline (not an idle timeout)", async () => {
    mode = "trickle"; const t0 = Date.now();
    await expect(makeHttpsTransport({ ca: cert, deadlineMs: 400 })(new URL(`https://hooks.test:${port}/`), { address: "127.0.0.1", family: 4 }, {}, "{}")).rejects.toThrow(/deadline/);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  it("a hanging receiver is cut at the deadline", async () => {
    mode = "hang";
    await expect(makeHttpsTransport({ ca: cert, deadlineMs: 300 })(new URL(`https://hooks.test:${port}/`), { address: "127.0.0.1", family: 4 }, {}, "{}")).rejects.toThrow(/deadline/);
  });
  it("response bigger than the cap aborts", async () => {
    mode = "huge";
    await expect(makeHttpsTransport({ ca: cert, maxBytes: 64 * 1024 })(new URL(`https://hooks.test:${port}/`), { address: "127.0.0.1", family: 4 }, {}, "{}")).rejects.toThrow(/too large/);
  });
  it("one slow destination does not delay another user's alert; same destination is serialised", async () => {
    const order: string[] = []; let inSlow = 0, maxInSlow = 0;
    const transport: Transport = async (u) => { if (u.hostname === "slow.example") { inSlow++; maxInSlow = Math.max(maxInSlow, inSlow); await new Promise((r) => setTimeout(r, 150)); inSlow--; } order.push(u.hostname); return 200; };
    const a = new AlertService({ provider: "webhook", now: () => Date.parse("2026-10-27T15:00:00Z"), resolve: async () => [{ address: "93.184.215.14", family: 4 }], transport });
    a.users.set("u1", { webhookUrl: "https://slow.example/h", secret: "s1" }); a.users.set("u2", { webhookUrl: "https://fast.example/h", secret: "s2" });
    const mkD = (uid: string, id: string) => a.deliveries.set(id, { id, ownerId: uid, ruleId: null, runId: null, kind: "test", event: null, message: "m", provider: "webhook", status: "queued", attempts: 0, lastError: null, lastStatusCode: null, nextAttemptAt: 0, createdAt: 0, deliveredAt: null });
    mkD("u1", "ald_s1"); mkD("u1", "ald_s2"); mkD("u2", "ald_f1");
    expect(await a.process()).toBe(3);
    expect(order[0]).toBe("fast.example"); expect(maxInSlow).toBe(1);
    expect([...a.deliveries.values()].every((d) => d.status === "delivered")).toBe(true);
  });
  it("a concurrent process() call does not pick an in-flight delivery twice", async () => {
    let calls = 0; const transport: Transport = async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return 200; };
    const a = new AlertService({ provider: "webhook", now: () => 0, resolve: async () => [{ address: "93.184.215.14", family: 4 }], transport });
    a.users.set("u1", { webhookUrl: "https://a.example/h", secret: "s" });
    a.deliveries.set("ald_1", { id: "ald_1", ownerId: "u1", ruleId: null, runId: null, kind: "test", event: null, message: "m", provider: "webhook", status: "queued", attempts: 0, lastError: null, lastStatusCode: null, nextAttemptAt: 0, createdAt: 0, deliveredAt: null });
    await Promise.all([a.process(), a.process()]); expect(calls).toBe(1);
  });
});

describe("M4.2.1 P3 SSRF allowlist", () => {
  it.each(["::7f00:1", "::127.0.0.1", "::ffff:0:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "0000:0000:0000:0000:0000:ffff:127.0.0.1", "2002:7f00:1::1", "2002:a9fe:a9fe::1", "2001::1", "2001:0:4136:e378::1", "fec0::1", "100::1", "64:ff9b::7f00:1", "2001:db8::1", "3fff::1", "198.51.100.7", "203.0.113.9", "192.0.2.1", "240.0.0.1", "255.255.255.255", "not-an-ip", "1::2::3"])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["1.1.1.1", "93.184.215.14", "2606:4700::1111", "2a00:1450:4001::1", "2001:4860:4860::8888"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
  it("URL forms [::127.0.0.1] and trailing-dot names are refused before DNS", () => {
    for (const u of ["https://[::127.0.0.1]/", "https://LOCALHOST./", "https://foo.localhost./", "https://x.internal../"]) expect(() => checkUrlShape(u)).toThrow();
  });
  it("trailing dot is normalised before resolving", async () => {
    let asked = ""; await resolvePublic(new URL("https://hooks.example./h"), async (h) => { asked = h; return [{ address: "1.1.1.1", family: 4 }]; });
    expect(asked).toBe("hooks.example");
  });
});

describe("M4.2.1 risk gate refuses new exposure on halted/paused runs", () => {
  const base = { killSwitch: false, stockTokensAllowed: true, isEquity: false, tradingHoursOk: true, ordersToday: 0, maxOrdersPerDay: 10, positionUsdAfter: 1, equity: 100, maxPositionPct: 50, exposureAfter: 1, maxTotalExposurePct: 100, cashNeeded: 1, freeCash: 100 };
  it("halted → run_halted, paused → run_paused, reducing still allowed", () => {
    expect(gate({ ...base, reducing: false, runState: "halted" })?.code).toBe("run_halted");
    expect(gate({ ...base, reducing: false, runState: "paused" })?.code).toBe("run_paused");
    expect(gate({ ...base, reducing: true, runState: "halted" })).toBeNull();
    expect(gate({ ...base, reducing: false, runState: "active" })).toBeNull();
  });
});

// ---------- ported Robin PoCs (qa/poc/robin-g9c8-m42-races.test.ts) ----------
async function setup(extra: Record<string, unknown> = { approvalMode: "confirm_each" }, w = "m421-user-approvals-1", persistPath?: string, clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"))) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0, persistPath });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown, t = tok) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: r.status === 204 ? null : await r.json() as any }; };
  const login = async (who = w) => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${who}` })).j.accessToken; return tok; };
  await login();
  const pubs = (await call("GET", "/public/strategies")).j; const marco = pubs.items.find((x: any) => x.author.handle === "@demo_marco");
  const fork = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const run = (await call("POST", "/runs", { strategyId: fork.id, mode: "paper", ...extra })).j;
  const ex = () => q.runs.live.get(run.id)!.ex;
  const pending = () => [...ex().approvals.values()].filter((x) => x.status === "pending");
  const tickUntilPending = async (max = 40) => { for (let i = 0; i < max; i++) { clock.advance(60_000); await q.runs.tick(run.id); if (pending().length) break; } await login(); return pending()[0]!; };
  const fillsFor = (orderId: string) => q.store.runs.get(run.id)!.events.filter((e: any) => e.type === "fill" && e.orderId === orderId).length;
  const blockChain = (ms: number) => { const l = q.runs.live.get(run.id)!; l.chain = l.chain.then(() => new Promise((r) => setTimeout(r, ms))); };
  return { q, clock, call, login, run, ex, pending, tickUntilPending, fillsFor, blockChain };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("M4.2.1 P1-2 approvals vs halt/pause (ported PoCs)", () => {
  it("approve passes the route check, run halts before decide runs → 409, no fill, approval still pending", async () => {
    const s = await setup(); const a = await s.tickUntilPending(); s.blockChain(30);
    const p = s.call("POST", `/approvals/${a.id}`, { decision: "approve" }); await sleep(5);
    s.q.runs.haltExternal(s.run.id, "geo_block", "probe halt");
    const r = await p;
    expect({ status: r.status, code: r.j.error?.code, fills: s.fillsFor(a.orderId), apv: a.status }).toEqual({ status: 409, code: "conflict", fills: 0, apv: "pending" });
  });
  it("approve queued, user pauses before decide runs → 409, no fill; resume then approve → fills", async () => {
    const s = await setup({ approvalMode: "confirm_each", approvalTtlSec: 3600 }); const a = await s.tickUntilPending(); s.blockChain(30);
    const p = s.call("POST", `/approvals/${a.id}`, { decision: "approve" }); await sleep(5);
    await s.call("POST", `/runs/${s.run.id}/control`, { action: "pause" }); const r = await p;
    expect({ status: r.status, fills: s.fillsFor(a.orderId), runStatus: s.q.store.runs.get(s.run.id)!.status }).toEqual({ status: 409, fills: 0, runStatus: "paused" });
    await s.call("POST", `/runs/${s.run.id}/control`, { action: "resume" });
    const ok = await s.call("POST", `/approvals/${a.id}`, { decision: "approve" }); expect(ok.status).toBe(200); expect(s.fillsFor(a.orderId)).toBe(1);
  });
  it("reject is still allowed on a halted run", async () => {
    const s = await setup(); const a = await s.tickUntilPending(); s.q.runs.haltExternal(s.run.id, "geo_block", "x");
    expect((await s.call("POST", `/approvals/${a.id}`, { decision: "reject" })).status).toBe(200); expect(a.status).toBe("rejected");
  });
  it("executor-level: decide on a halted executor is refused by the risk gate (belt and braces)", async () => {
    const s = await setup(); const a = await s.tickUntilPending(); s.ex().halted = true;
    await s.ex().decide(a.id, "approve", s.clock.now()); expect(s.fillsFor(a.orderId)).toBe(0);
    const rej = s.q.store.runs.get(s.run.id)!.events.find((e: any) => e.type === "rejected" && e.orderId === a.orderId) as any; expect(rej?.code).toBe("run_halted");
  });
  it(`resolved approvals are capped at ${MAX_RESOLVED_APPROVALS} per run (oldest dropped, pending kept)`, async () => {
    const s = await setup(); const a = await s.tickUntilPending(); const m = s.ex().approvals;
    for (let i = 0; i < 260; i++) m.set(`apv_fake${i}`, { ...a, id: `apv_fake${i}`, status: "rejected", resolvedAt: i } as any);
    await s.call("POST", `/approvals/${a.id}`, { decision: "reject" });
    const done = [...m.values()].filter((x) => x.status !== "pending"); expect(done.length).toBe(MAX_RESOLVED_APPROVALS);
    expect(m.has("apv_fake0")).toBe(false); expect(m.has(a.id)).toBe(true);
  });
  it("dev restart keeps a paused run paused (no ticks, no orders)", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "m421-")), "state.json"); const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
    const s = await setup({}, "m421-restart-user-paused", path, clock);
    await s.call("POST", `/runs/${s.run.id}/control`, { action: "pause" }); await s.q.persist!.flush(); s.q.runs.shutdown();
    const q2 = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0, persistPath: path });
    const r2 = q2.store.runs.get(s.run.id)!; expect(r2.status).toBe("paused");
    const n = r2.events.length; for (let i = 0; i < 3; i++) { clock.advance(60_000); await q2.runs.tick(s.run.id); }
    expect(r2.events.slice(n).filter((e: any) => e.type === "order" || e.type === "fill").length).toBe(0); q2.runs.shutdown();
  });
});

describe("M4.2.1 P3 signing 503 message", () => {
  it("does not name the server env var", async () => {
    const src = readFileSync("src/sessionkeys/service.ts", "utf8"); const msg = src.match(/"signing_unavailable", "([^"]+)"/)![1];
    expect(msg).not.toMatch(/ALCHEMY|API_KEY|env/i);
  });
});
