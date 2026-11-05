import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect } from "vitest";
import { Workflow } from "../../contracts/src/workflow";
import { Strategy, Risk } from "../../contracts/src/strategy";
import { recurringDraft } from "../../src/compile/recurring";
import { WorkflowHost } from "../../src/workflows/host";
import { MemStore } from "../../src/store";
import { PostgresPersistence, durableSnapshot, restoreDurable } from "../../src/storage/postgres";
import type { MarketObservation } from "../../src/workflows/observations";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { T0 } from "../helpers";

function strategy() {
  const w = Workflow.parse(
    recurringDraft("if NEET price below 0.003 buy $100 of NEET every one minute until out of budget"),
  );
  w.budgetUsd = 1000;
  w.questions = [];
  w.signals = [];
  w.stages[0] = { ...w.stages[0], side: "long", leverage: 2, when: null, repeat: null };
  const market = {
    id: "hl:perp:BTC",
    symbol: "BTC",
    name: "BTC perpetual",
    venue: "hyperliquid" as const,
    kind: "perp" as const,
    source: "hyperliquid" as const,
    address: null,
    url: null,
    maxLeverage: 10,
    endDate: null,
    outcome: null,
  };
  w.assets[0] = {
    ...w.assets[0],
    query: "BTC",
    sourceText: "BTC on Hyperliquid",
    venue: "hyperliquid",
    kind: "perp",
    resolution: {
      status: "matched",
      selectedId: market.id,
      checkedAt: new Date(T0).toISOString(),
      message: "Matched BTC",
      candidates: [market],
    },
  };
  return Strategy.parse({
    schemaVersion: 1,
    name: w.name,
    thesis: "Buy BTC",
    signals: [],
    triggers: [],
    actions: [],
    risk: Risk.parse({}),
    workflow: w,
  });
}
const quote = (id: string, at: number): MarketObservation => ({
  assetId: id,
  quote: { assetId: id, observedAt: at, price: 100, synthetic: false, source: "controlled observation" },
  message: "BTC book",
});
async function open(path: string, store: MemStore) {
  const db = new PGlite(path);
  const client = {
    connect: async () => {
      await db.waitReady;
    },
    end: () => db.close(),
    on() {
      return this;
    },
    query: async (sql: string, params?: unknown[]) => {
      const r = await db.query(sql, params);
      return { ...r, rowCount: r.affectedRows ?? r.rows.length };
    },
  };
  return PostgresPersistence.open("integration", store, client as never);
}
describe("hosted Workspace paper sessions", () => {
  it("restores a durable confirmed entry after closing the UI and reopening PostgreSQL, without repeating it", async () => {
    const path = mkdtempSync(join(tmpdir(), "quiver-host-"));
    let store = new MemStore(),
      db = await open(path, store),
      at = T0;
    const host = () =>
      new WorkflowHost({
        records: store.workflowSessions,
        now: () => at,
        commit: () => db.commit(),
        healthy: () => db.healthy,
        quote: async (a) => quote(a.id, at),
        intervalMs: 1000,
        maxActive: 3,
      });
    try {
      let h = host();
      const s = h.start("owner", "stable-launch", "stg_a", 1, strategy(), "confirm_each").session;
      expect(h.start("owner", "stable-launch", "stg_a", 1, strategy(), "confirm_each").session.id).toBe(s.id);
      expect(() => h.owned("stranger", s.id)).toThrow(/not found/);
      at += 1500;
      await h.cycle();
      const row = h.owned("owner", s.id);
      expect(row.session.state?.events).toHaveLength(0);
      expect(row.approvals).toHaveLength(1);
      h.decide("owner", s.id, 0, row.approvals[0].id, "approved");
      at += 1500;
      await h.cycle();
      const filled = h.owned("owner", s.id).session;
      expect(filled.state!.events).toHaveLength(1);
      expect(filled.state!.principal).toBeLessThan(1000);
      await h.stopDriver();
      await db.close();
      store = new MemStore();
      db = await open(path, store);
      at += 86400000;
      h = host();
      h.startDriver();
      await h.cycle();
      await h.stopDriver();
      const restored = h.owned("owner", s.id).session;
      expect(restored.state!.events).toHaveLength(1);
      expect(restored.state!.principal).toBe(filled.state!.principal);
      expect(restored.activeMs).toBeLessThan(10000);
      expect(restored.activity?.some((a) => a.label === "Server resumed")).toBe(true);
      const isolated = new MemStore();
      restoreDurable(isolated, { ...durableSnapshot(store), restoreHold: true });
      expect(isolated.workflowSessions.get(s.id)?.session.status).toBe("paused");
    } finally {
      await db.close();
      rmSync(path, { force: true, recursive: true });
    }
  }, 30000);
  it("discards a late quote after pause, rejects stale controls and ignores imported checkpoints for execution", async () => {
    let at = T0,
      release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const h = new WorkflowHost({
      records: new Map(),
      now: () => at,
      commit: async () => {},
      healthy: () => true,
      quote: async (a) => {
        await wait;
        return quote(a.id, at);
      },
      intervalMs: 1000,
      maxActive: 2,
    });
    const s = h.start("owner", "request", "stg_a", 1, strategy(), "auto").session;
    at += 1000;
    const wave = h.tick(s.id);
    h.control("owner", s.id, 0, "pause");
    release();
    await wave;
    expect(h.owned("owner", s.id).session.state!.events).toHaveLength(0);
    expect(() => h.control("owner", s.id, 0, "resume")).toThrow(/changed/);
    const a = h.importArchive("owner", { ...s, id: "paper_fromBrowser", activeMs: 30 });
    expect(a.session.provenance).toBe("imported");
    expect(h.importArchive("owner", { ...s, id: "paper_fromBrowser" }).session.id).toBe(a.session.id);
    expect(() => h.control("owner", a.session.id, 0, "resume")).toThrow(/archived/);
    h.control("owner", s.id, 1, "resume");
    at += 1000;
    await h.cycle();
    expect(h.owned("owner", s.id).session.state!.events).toHaveLength(1);
  });
  it("exposes the same session via authenticated API and blocks unsigned venue commands", async () => {
    const clock = new ManualClock(T0),
      q = createApp({
        config: loadConfig({ DEV_LOGIN_ENABLED: "true" }),
        clock,
        workflowQuote: async (a) => quote(a.id, clock.now()),
        autoTimers: false,
      });
    const req = async (path: string, body?: unknown, token?: string) =>
      q.app.request("/v1" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const login = async (label: string) => {
      const r = await req("/auth/exchange", { provider: "privy", idToken: "dev:workflow-test-" + label });
      return ((await r.json()) as { accessToken: string }).accessToken;
    };
    const owner = await login("host-test-owner"),
      stranger = await login("host-test-stranger");
    const saved = await req("/strategies", { strategy: strategy() }, owner);
    expect(saved.status).toBe(201);
    const rec = (await saved.json()) as { id: string; version: number };
    const session = await req(
      "/workflow-sessions",
      { strategyId: rec.id, version: rec.version, mode: "auto", launchKey: "persistent-api-test" },
      owner,
    );
    expect(session.status).toBe(201);
    const id = ((await session.json()) as { session: { id: string } }).session.id;
    expect((await req("/workflow-sessions/" + id, undefined, stranger)).status).toBe(404);
    expect((await req("/execution/hyperliquid/grant", { master: "0x" + "1".repeat(40) }, owner)).status).toBe(
      503,
    );
    expect((await req("/execution", undefined)).status).toBe(401);
  });
});
