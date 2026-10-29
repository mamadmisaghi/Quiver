import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";
import { PostgresPersistence, durableSnapshot, restoreDurable } from "../../src/storage/postgres";
import { MemStore } from "../../src/store";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { makeGracefulStop } from "../../src/shutdown";
import { btcStrategy, env, T0 } from "../helpers";

// PGlite runs PostgreSQL's SQL/JSONB/advisory-lock implementation in-process.
const open = async (path: string, store: MemStore) => {
  const db = new PGlite(path);
  const client = { connect: async () => { await db.waitReady; }, end: () => db.close(), on() { return this; }, query: async (sql: string, params?: unknown[]) => {
    const r = await db.query(sql, params); return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  } };
  const persistence = await PostgresPersistence.open("not-a-network-connection", store, client as never);
  return { db, persistence };
};
const config = () => loadConfig({ DEV_LOGIN_ENABLED: "true", QUIVR_JWT_SECRET: "paper-storage-test-secret-0123456789012345" });
const call = async (q: ReturnType<typeof createApp>, path: string, body?: unknown, token?: string) => {
  const r = await q.app.request("/v1" + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
};
const app = (store: MemStore, durable: PostgresPersistence, clock: ManualClock) => {
  const e = env(); e.mkt.overrides.set("hl:perp:BTC", () => 110000);
  const q = createApp({ config: config(), store, durable, clock, registry: e.registry, market: e.mkt, adapters: e.adapters, autoTimers: false });
  durable.beforeCommit = async () => { for (const [id, cp] of await q.runs.checkpoints()) store.runCheckpoints.set(id, cp); };
  return q;
};

describe("paper beta durable storage", () => {
  it("restores account, positions, fees, trigger state and JWT across a real database close/reopen; does not buy twice", async () => {
    const path = mkdtempSync(join(tmpdir(), "quiver-pg-")); let cleanup: (() => Promise<void>) | undefined;
    try {
      const clock = new ManualClock(T0), store = new MemStore();
      const first = await open(path, store); cleanup = () => first.persistence.close();
      const q = app(store, first.persistence, clock);
      const token = (await call(q, "/auth/exchange", { provider: "privy", idToken: "dev:durable-test-user" })).body.accessToken;
      expect(token).toBeTruthy();
      const strategy = await call(q, "/strategies", { strategy: btcStrategy() }, token); expect(strategy.status).toBe(201);
      const run = await call(q, "/runs", { strategyId: strategy.body.id, mode: "paper" }, token); expect(run.status).toBe(201);
      await q.runs.tick(run.body.id); await first.persistence.commit();
      const before = store.runCheckpoints.get(run.body.id)!;
      expect(before.account.positions).toHaveLength(1); expect(before.fills).toHaveLength(1); expect(before.engine.triggers.t1.fires).toBe(1);
      q.runs.shutdown(); await first.persistence.close(); cleanup = undefined;
      const restored = new MemStore(), second = await open(path, restored); cleanup = () => second.persistence.close();
      clock.advance(15_000); const q2 = app(restored, second.persistence, clock);
      expect(q2.runs.get(run.body.id)!.ex.acct.positions.get("hl:perp:BTC")).toEqual(before.account.positions[0][1]);
      expect((await call(q2, `/strategies/${strategy.body.id}`, undefined, token)).status).toBe(200);
      await q2.runs.tick(run.body.id); await second.persistence.commit();
      const after = restored.runCheckpoints.get(run.body.id)!;
      expect(after.account.cash).toBe(before.account.cash);
      expect(after.account.positions[0][1].qty).toBe(before.account.positions[0][1].qty);
      expect(after.account.positions[0][1].avgEntry).toBe(before.account.positions[0][1].avgEntry);
      expect(after.account.fees).toBe(before.account.fees); expect(after.fills).toHaveLength(1); expect(after.engine.triggers.t1.fires).toBe(1);
      expect(restored.runs.get(run.body.id)!.events.filter((e) => e.type === "fill")).toHaveLength(1);
      q2.runs.shutdown();
    } finally { await cleanup?.(); rmSync(path, { recursive: true, force: true }); }
  }, 30_000);

  it("saves related records atomically, removes deleted rows, and refuses a stale revision", async () => {
    const store = new MemStore(), pg = await open("memory://", store);
    try {
      store.idem.set("user:/strategies:key", { at: T0, status: 201, body: { id: "same-strategy" } });
      store.refresh.set("refresh-digest", { userId: "u", exp: T0 + 1000 });
      await pg.persistence.commit();
      const saved = (await pg.db.query<any>("SELECT payload FROM quiver_state")).rows[0].payload;
      const other = new MemStore(); restoreDurable(other, saved); expect(other.idem.size).toBe(1); expect(other.refresh.size).toBe(1);
      store.idem.clear(); await pg.persistence.commit();
      expect((await pg.db.query<any>("SELECT payload FROM quiver_state")).rows[0].payload.idem).toEqual([]);
      await pg.db.query("UPDATE quiver_state SET revision = revision + 1");
      const previous = (await pg.db.query<any>("SELECT payload FROM quiver_state")).rows[0].payload;
      store.audit.push({ at: T0, userId: null, action: "must-not-overwrite" });
      await expect(pg.persistence.commit()).rejects.toThrow(/revision conflict/); expect(pg.persistence.healthy).toBe(false);
      expect((await pg.db.query<any>("SELECT payload FROM quiver_state")).rows[0].payload).toEqual(previous);
    } finally { await pg.persistence.close(); }
  }, 20_000);

  it("does not return a successful save before commit; storage failure blocks mutations and readiness", async () => {
    let release!: () => void; const waiting = new Promise<void>((r) => { release = r; });
    const durable = { healthy: true, commit: vi.fn(() => waiting), close: async () => {} };
    const q = createApp({ config: config(), durable, autoTimers: false });
    let answered = false; const request = call(q, "/auth/exchange", { provider: "privy", idToken: "dev:wait-for-database" }).then((r) => { answered = true; return r; });
    await vi.waitFor(() => expect(durable.commit).toHaveBeenCalled()); expect(answered).toBe(false);
    release(); expect((await request).status).toBe(200);
    durable.healthy = false;
    expect((await call(q, "/strategies", { strategy: btcStrategy() })).status).toBe(503);
    expect((await call(q, "/ready")).status).toBe(503); q.runs.shutdown();
  });

  it("rejects corrupt snapshot metadata rather than starting with an empty account", () => {
    const data = durableSnapshot(new MemStore()); data.runCheckpoints = [["broken"]];
    expect(() => restoreDurable(new MemStore(), data)).toThrow(/Invalid database state/);
  });
  it("coalesces simultaneous idempotent strategy saves", async () => {
    const q = createApp({ config: config(), autoTimers: false });
    const token = (await call(q, "/auth/exchange", { provider: "privy", idToken: "dev:parallel-save-user" })).body.accessToken;
    const save = async () => { const r = await q.app.request("/v1/strategies", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": "same-save" }, body: JSON.stringify({ strategy: btcStrategy() }) }); return r.json() as Promise<any>; };
    const [a, b] = await Promise.all([save(), save()]); expect(a.id).toBeTruthy(); expect(a.id).toBe(b.id); expect(q.store.strategies.size).toBe(1); q.runs.shutdown();
  });
  it.each(["paused", "stopped", "halted"] as const)("keeps a %s run and its account intact after restore", async (status) => {
    const clock = new ManualClock(T0), store = new MemStore(), fake = { healthy: true, commit: async () => {}, close: async () => {} } as PostgresPersistence;
    const q = app(store, fake, clock);
    const token = (await call(q, "/auth/exchange", { provider: "privy", idToken: `dev:restore-${status}-user` })).body.accessToken;
    const strategy = (await call(q, "/strategies", { strategy: btcStrategy() }, token)).body;
    const run = (await call(q, "/runs", { strategyId: strategy.id, mode: "paper" }, token)).body;
    await q.runs.tick(run.id);
    if (status === "halted") q.runs.haltExternal(run.id, "kill_switch", "Test halt");
    else await q.runs.control(run.id, status === "paused" ? "pause" : "stop");
    for (const [id, cp] of await q.runs.checkpoints()) store.runCheckpoints.set(id, cp);
    const cp = store.runCheckpoints.get(run.id)!; q.runs.shutdown();
    const restored = new MemStore(); restoreDurable(restored, JSON.parse(JSON.stringify(durableSnapshot(store))));
    clock.advance(60_000); const q2 = app(restored, fake, clock);
    expect(restored.runs.get(run.id)!.status).toBe(status);
    expect(q2.runs.get(run.id)!.ex.acct.cash).toBe(cp.account.cash);
    expect([...q2.runs.get(run.id)!.ex.acct.positions]).toEqual(cp.account.positions);
    if (status === "stopped") expect(q2.runs.equityCurve(run.id, 500)).toEqual(cp.equity);
    if (status === "halted") expect(q2.runs.get(run.id)!.ex.halted).toBe(true);
    q2.runs.shutdown();
  });
});

describe("durable shutdown", () => {
  it("waits for async flush before closing; a rejected flush exits with failure", async () => {
    const order: string[] = []; let release!: () => void; const p = new Promise<void>((r) => { release = r; }); const exit = vi.fn();
    const stop = makeGracefulStop({ stopRuns: () => { order.push("runs"); }, flush: () => p.then(() => { order.push("commit"); }), closeServer: (done) => { order.push("close"); done(); }, exit, log: () => {} });
    stop("SIGTERM"); expect(order).toEqual(["runs"]); expect(exit).not.toHaveBeenCalled();
    release(); await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0)); expect(order).toEqual(["runs", "commit", "close"]);
    const failed = vi.fn(); makeGracefulStop({ stopRuns: () => {}, flush: async () => { throw new Error("db lost"); }, closeServer: () => { throw new Error("must not close before saving"); }, exit: failed, log: () => {} })("SIGTERM");
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(1));
  });
});
