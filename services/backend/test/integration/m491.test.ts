// M4.9.1 — friendly de-duplicated errors (no raw zod text), instruct counts toward the compile quota,
// keyed public handles, short card cache, stops that never wait on a stuck price fetch, autopilot kill partial result.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { friendlyIssues } from "../../src/lib/issues";
import { AutopilotKillRes } from "../../contracts/src/autopilot";

const iss0 = (j: any) => (j.error.details as { code: string }[]).map((i) => i.code);
const RAW = /Invalid input|Too small|Too big|expected .* to have|Invalid string|Unrecognized key|received undefined|must match pattern/i;
async function setup(w = "m491-friendly-errors-user-01", env: Record<string, string> = {}, opts: Record<string, unknown> = {}) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock, autoTimers: false, compileDelayMs: 0, ...opts });
  const toks: Record<string, string> = {};
  const login = async (who = w) => (toks[who] = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:${who}` }) })).json() as any).accessToken);
  const call = async (m: string, p: string, b?: unknown, who: string | null = w) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${toks[who] ?? (await login(who))}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => null) as any, h: r.headers }; };
  await login(); const pubs = (await call("GET", "/public/strategies")).j.items;
  const marco = (await call("POST", `/public/strategies/${pubs.find((x: any) => x.author.handle === "@demo_marco").id}/fork`)).j;
  const run = (await call("POST", "/runs", { strategyId: marco.id, mode: "paper" })).j;
  const st = (await call("GET", `/strategies/${marco.id}`)).j;
  return { q, clock, call, login, marco, run, st };
}

describe("M4.9.1 instruct errors", () => {
  it("pausing every rule → one strategy_needs_rule issue, no raw zod text", async () => {
    const s = await setup(); const ids = s.st.strategy.triggers.map((t: any) => t.id).join(" and ");
    const r = await s.call("POST", `/runs/${s.run.id}/instruct`, { text: `pause rule ${ids}` });
    expect(r.status).toBe(422); expect(r.j.error.code).toBe("strategy_invalid"); expect(r.j.error.message).toBe("A strategy needs at least one active rule");
    expect(r.j.error.details).toEqual([expect.objectContaining({ code: "strategy_needs_rule", message: "A strategy needs at least one active rule" })]);
    expect(JSON.stringify(r.j)).not.toMatch(RAW);
    expect((await s.call("GET", `/strategies/${s.marco.id}`)).j.version).toBe(s.st.version); // nothing changed
  });
  it("body validation errors are friendly, coded and de-duplicated", async () => {
    const s = await setup();
    const r = await s.call("POST", "/runs", { mode: "moon" });
    expect(r.status).toBe(422); expect(JSON.stringify(r.j)).not.toMatch(RAW);
    expect(iss0(r.j)).toContain("missing_field");
    const iss = r.j.error.details as { code: string; message: string }[];
    expect(iss.length).toBeGreaterThan(0); expect(new Set(iss.map((i) => i.code + i.message)).size).toBe(iss.length);
    for (const i of iss) expect(["too_few", "too_many", "too_short", "too_long", "out_of_range", "missing_field", "invalid_value", "invalid_format", "unknown_field"]).toContain(i.code);
    const pt = await s.call("PUT", `/strategies/${s.marco.id}`, { expectedVersion: s.st.version, strategy: { ...s.st.strategy, triggers: [] } });
    expect(pt.status).toBe(422); expect(JSON.stringify(pt.j)).not.toMatch(RAW);
    const codes = JSON.stringify(pt.j); expect(codes).toMatch(/strategy_needs_rule/); expect(codes).not.toMatch(/strategy_needs_action/);
  });
  it("friendlyIssues de-duplicates repeated issues", () => {
    const one = { code: "too_small", origin: "string", minimum: 1, inclusive: true, path: ["name"], message: "Too small: expected string to have >=1 characters", input: "" } as any;
    const out = friendlyIssues([one, one, { ...one, path: ["triggers"], origin: "array" }, { ...one, path: ["triggers"], origin: "array" }]);
    expect(out.map((i) => i.code)).toEqual(["too_short", "strategy_needs_rule"]); expect(JSON.stringify(out)).not.toMatch(RAW);
  });
});

describe("M4.9.1 instruct LLM cap (B2)", () => {
  it("instruct calls count toward LLM_USER_DAILY_COMPILES", async () => {
    const s = await setup("m491-quota-user-aaaaaaaa-01", { LLM_USER_DAILY_COMPILES: "2" });
    expect((await s.call("POST", `/runs/${s.run.id}/instruct`, { text: "daily loss limit 4%" })).status).toBe(201);
    expect((await s.call("POST", `/runs/${s.run.id}/instruct`, { text: "daily loss limit 5%" })).status).toBe(201);
    const r = await s.call("POST", `/runs/${s.run.id}/instruct`, { text: "daily loss limit 6%" });
    expect(r.status).toBe(429); expect(r.j.error.code).toBe("compile_quota_exceeded"); expect(Number(r.h.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("M4.9.1 public handle + card cache (B3)", () => {
  it("email-like names become a keyed alias (secret-dependent, not plain sha256); card max-age ≤ 5", async () => {
    const who = "alice.m491.tester@example.com";
    const handle = async (secret: string) => { const s = await setup(who, { QUIVR_JWT_SECRET: secret }); const sh = (await s.call("POST", `/runs/${s.run.id}/card/share`)).j;
      const r = await s.q.app.request(sh.path.replace(/^\/v1/, "/v1")); const j = await r.json() as any; return { h: j.handle as string, cc: r.headers.get("cache-control") ?? "" }; };
    const a = await handle("a".repeat(48)), b = await handle("b".repeat(48));
    expect(a.h).toMatch(/^@trader_[0-9a-f]{8}$/); expect(a.h).not.toBe(b.h); expect(a.h).not.toContain("alice");
    expect(a.h).not.toBe("@trader_" + createHash("sha256").update("@" + who).digest("hex").slice(0, 8));
    expect(Number(/max-age=(\d+)/.exec(a.cc)![1])).toBeLessThanOrEqual(5);
  });
});

describe("M4.9.1 stop never waits on a stuck price fetch", () => {
  it("stop_and_flatten with a hung tick returns within the bound and marks the run stopped", async () => {
    const s = await setup("m491-stuck-stop-user-aaaa-01", {}, { stopTimeoutMs: 30 });
    (s.q.runs as any).live.get(s.run.id).chain = new Promise(() => {}); // a price fetch that never answers
    const t0 = Date.now(); const r = await s.call("POST", `/runs/${s.run.id}/control`, { action: "stop_and_flatten" }); expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.status).toBeLessThan(300); expect((await s.call("GET", `/runs/${s.run.id}`)).j.status).toBe("stopped");
    expect(JSON.stringify((await s.call("GET", `/runs/${s.run.id}/events`)).j)).toMatch(/flatten_timeout/);
  });
});

describe("M4.9.1 autopilot kill", () => {
  it("returns 207 with the failed runs listed when a stop throws", async () => {
    const s = await setup("m491-kill-partial-user-aa-01");
    expect((await s.call("PUT", "/autopilot", { enabled: true, strategyIds: [s.marco.id], startingEquityUsd: "1000", guardrails: { maxDrawdownPct: 20, maxDailyLossUsd: 100, maxRotationsPerDay: 5 } })).status).toBeLessThan(300);
    const uid = [...s.q.autopilot.users.keys()][0]!; s.q.autopilot.users.get(uid)!.owned.push(s.run.id);
    const orig = (s.q.autopilot as any).d.stop; (s.q.autopilot as any).d.stop = async (id: string) => { if (id === s.run.id) throw Object.assign(new Error("x"), { code: "venue_down" }); return orig(id); };
    const r = await s.call("POST", "/autopilot/kill"); expect(r.status).toBe(207);
    const k = AutopilotKillRes.parse(r.j); expect(k.killed).toBe(true); expect(k.kill.failed).toEqual([{ runId: s.run.id, reason: "venue_down" }]);
  });
});
