import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Strategy } from "../../contracts/src/strategy";
import { createPaper } from "../../src/workflows/paper";
import {
  createLedger,
  transition,
  type Amount,
  type JournalEvent,
} from "../../src/execution/ledger";
import {
  MainnetStore,
  restoreLivePrograms,
} from "../../src/execution/live-storage";
import {
  markedProgramValue,
  lossSampler,
  type LiveValuationRefs,
} from "../../src/execution/live-loss";
import type {
  Action,
  LiveProgram,
  Network,
} from "../../src/execution/live-program";

const now = 1793746800000,
  owner = "user_a",
  settle = "USDC",
  mint = "aTokenMint",
  hl = "hyperliquid-mainnet",
  sol = "solana-mainnet",
  rh = "robinhood-mainnet";
const x = (asset: string, n: string | number | bigint): Amount => ({
  asset,
  units: String(n),
});
const micro = (usd: number) => BigInt(Math.round(usd * 1e6)),
  lot = (n: number) => BigInt(n) * 10n ** 18n;
function fixture(
  network: Network = sol,
  id = "live_trial",
  wallet = "wallet_a",
) {
  const perp = network === hl,
    venue = perp ? "hyperliquid" : network === sol ? "solana" : "robinhood",
    symbol = perp ? "BTC" : "COIN",
    token = perp ? null : mint;
  const m = {
    id: perp
      ? "hl:perp:BTC"
      : network === sol
        ? "sol:token:" + mint
        : "rh:asset",
    symbol,
    venue,
    kind: perp ? "perp" : "token",
    address: token,
    source: perp ? "hyperliquid" : "dexscreener",
    name: symbol,
    url: null,
    maxLeverage: perp ? 10 : 1,
    endDate: null,
    outcome: null,
  };
  const strategy = Strategy.parse({
    schemaVersion: 1,
    name: "test",
    thesis: "test",
    signals: [],
    triggers: [],
    actions: [],
    risk: { maxPositionPct: 100 },
    workflow: {
      version: 1,
      name: "test",
      summary: "test",
      budgetUsd: 1000,
      signals: [],
      questions: [],
      assets: [
        {
          id: "asset",
          query: symbol,
          sourceText: symbol,
          venue,
          outcome: null,
          kind: m.kind,
          resolution: {
            status: "matched",
            selectedId: m.id,
            candidates: [m],
            checkedAt: new Date(now).toISOString(),
            message: "Selected",
          },
        },
      ],
      stages: [
        {
          id: "first",
          assetId: "asset",
          side: perp ? "long" : "buy",
          sourceText: "order",
          conditionText: "",
          when: null,
          after: [],
          amount: { unit: "usd", value: 20 },
          leverage: perp ? 2 : 1,
          funding: { kind: "budget", from: [] },
          repeat: null,
          exits: {
            stopLossPct: null,
            takeProfitPct: null,
            trailingStopPct: null,
            timeExitHours: null,
            ladder: [],
            description: "",
          },
        },
      ],
    },
  });
  const allocations = perp
    ? [x(settle, micro(1000))]
    : [
        x(settle, micro(1000)),
        x(network === sol ? "SOL:lamports" : "ETH", micro(1000)),
      ];
  const p: LiveProgram = {
    schema: 1,
    id,
    owner,
    strategyId: "stg_a",
    version: 1,
    revision: 0,
    controlEpoch: 0,
    strategy,
    mode: "confirm_each",
    slippageBps: 50,
    status: "running",
    createdAt: now - 86400000,
    message: "",
    wallets: [
      {
        network,
        wallet,
        settlementAsset: settle,
        decimals: 6,
        allocations,
        maxFeesPerOrder: [x(allocations.at(-1)!.asset, 100)],
      },
    ],
    orders: {},
    stages: { first: { entries: [], exits: [], peakPct: 0 } },
    ledger: createLedger(
      id,
      allocations.map((a) => ({ ...a, venue: network })),
    ),
    observations: createPaper(strategy.workflow!, now - 86400000),
  };
  return p;
}
type MutableAccess = {
  paused: boolean;
  consent?: { limits: { dailyUsd: number } };
  agent?: { state: string; sealed: string };
  baselines?: Record<
    string,
    { day: string; opening: number; latest: number; high: number; at?: number }
  >;
};
function state(cap = 1000) {
  const access: MutableAccess = {
    paused: false,
    consent: { limits: { dailyUsd: cap } },
    agent: { state: "active", sealed: "ciphertext" },
  };
  const data = {
    livePrograms: new Map<string, LiveProgram>(),
    liveAccess: new Map([[owner, access]]),
    liveAllowances: new Map<
      string,
      { state: string; terms: { owner: string; nonce: string } }
    >(),
    privySpotGrants: new Map<
      string,
      { status: string; sealed: string; revision: number }
    >(),
    users: new Map([[owner, {}]]),
    strategies: new Map([
      ["stg_a", { ownerId: owner, versions: [{ version: 1 }] }],
    ]),
  };
  const guard = {
    d: { now: () => now, commit: async () => {} },
    allow: () => !access.paused,
    record: () => access,
  };
  return { data, guard };
}
const journal = (p: LiveProgram, e: JournalEvent) => {
  p.ledger = transition(p.ledger, e).next;
};
function plan(
  p: LiveProgram,
  id: string,
  qty: string,
  reserves: Amount[],
  exit = false,
  notional = "20000000",
) {
  const b = p.wallets[0],
    s = p.strategy.workflow!.stages[0],
    m = p.strategy.workflow!.assets[0].resolution!.candidates[0];
  const a: Action = {
    programId: p.id,
    strategyId: p.strategyId,
    version: p.version,
    owner: p.owner,
    stage: "first",
    sequence: Object.keys(p.orders).length,
    id,
    network: b.network,
    wallet: b.wallet,
    instrument: m,
    leg: exit ? "exit" : "entry",
    side: exit ? "sell" : s.side,
    leverage: s.leverage,
    slippageBps: 50,
    spendAsset: reserves[0].asset,
    spendUnits: reserves[0].units,
    reduceOnly: exit,
    exitReason: exit ? "Manual close" : null,
    notionalUsd6: notional,
  };
  p.orders[id] = {
    action: a,
    terms: {
      expiresAt: now + 2000,
      targetUnits: qty,
      reserves,
      summary: id,
      payload: {},
    },
    digest: "a".repeat(64),
  };
  p.stages.first[exit ? "exits" : "entries"].push(id);
  journal(p, {
    kind: "plan",
    spec: {
      id,
      venue: b.network,
      instrument: m.id,
      side: a.side,
      targetQty: qty,
      termsHash: p.orders[id].digest,
      reserve: reserves,
      after: [],
    },
  });
}
function launch(p: LiveProgram, id: string, rid = id, at = now) {
  journal(p, {
    kind: "approve",
    id,
    approvalRef: p.orders[id].digest,
    expiresAt: now + 2000,
    now: at,
  });
  journal(p, { kind: "submit", id, now: at });
  p.orders[id].recoveryId = rid;
  p.orders[id].dispatchedAt = at;
}
function fill(
  p: LiveProgram,
  id: string,
  qty: string,
  debits: Amount[],
  credits: Amount[],
  at: number,
  average?: number,
) {
  const o = p.orders[id],
    filledRef = "ref" + id;
  journal(p, {
    kind: "execution",
    id,
    fill: {
      fillId: "hl:" + at + ":" + p.stages.first.entries.length,
      orderRef: filledRef,
      qty,
      debits,
      credits,
    },
  });
  journal(p, {
    kind: "final",
    id,
    report: {
      orderRef: filledRef,
      outcome: "filled",
      cumulativeQty: qty,
      cumulativeDebits: debits,
      cumulativeCredits: credits,
    },
  });
  if (average !== undefined) {
    const held = credits.find((a) => a.asset !== "USDC")!;
    o.holding = {
      asset: held.asset,
      quantity: held.units,
      quantityDecimals: 18,
      averageEntryUsd: average,
      openedAt: at,
    };
    o.holdingForFilledUnits = qty;
  }
}
const val = (
  price: number,
  extra: Partial<LiveValuationRefs> = {},
): LiveValuationRefs => ({
  observe: async (a) => ({
    assetId: a.id,
    price,
    observedAt: now,
    synthetic: false,
    source: "controlled venue mark",
  }),
  decimals: async () => 6,
  feeMark: async () => 100,
  ...extra,
});
describe("wallet mainnet store", () => {
  it("waits for a durable write and isolates concurrent comparison, read copies and stale owners", async () => {
    let release!: () => void,
      calls = 0;
    const pending = new Promise<void>((r) => {
      release = r;
    });
    const { data, guard } = state(),
      store = new MainnetStore(
        data,
        () => true,
        async () => {
          calls++;
          await pending;
        },
        guard,
      ),
      p = fixture();
    const a = store.cas(owner, p.id, null, p),
      b = store.cas(owner, p.id, null, p);
    let replied = false;
    void a.then(() => {
      replied = true;
    });
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(replied).toBe(false);
    release();
    expect(await Promise.all([a, b])).toEqual([true, false]);
    const copy = (await store.read(owner, p.id))!;
    copy.status = "stopped";
    expect((await store.read(owner, p.id))!.status).toBe("running");
    expect(await store.read("wrong", p.id)).toBeNull();
  });
  it("does not release a wallet dispatch when permissions change during the durable acknowledgement", async () => {
    const { data, guard } = state();
    let notify!: () => void, release!: () => void;
    const writing = new Promise<void>((r) => (notify = r)),
      ack = new Promise<void>((r) => (release = r));
    let n = 0;
    const store = new MainnetStore(
      data,
      () => true,
      async () => {
        if (++n === 2) {
          notify();
          await ack;
        }
      },
      guard,
    );
    const p = fixture(rh);
    await store.cas(owner, p.id, null, p);
    plan(p, "wallet_tx", "100", [x(settle, 100)]);
    launch(p, "wallet_tx", "rh:4663:wallet_a:1");
    p.revision++;
    const request = store.cas(owner, p.id, 0, p);
    await writing;
    data.liveAccess.get(owner)!.paused = true;
    release();
    expect(await request).toBe(false);
    expect((await store.read(owner, p.id))!.ledger.orders[0].dispatched).toBe(
      true,
    );
  });
  it("fences the process after an ambiguous database commit", async () => {
    const { data, guard } = state();
    let count = 0;
    const store = new MainnetStore(
        data,
        () => true,
        async () => {
          count++;
          throw Error("disconnected after write");
        },
        guard,
      ),
      p = fixture();
    await expect(store.cas(owner, p.id, null, p)).rejects.toThrow(
      "disconnected",
    );
    await expect(store.cas(owner, p.id, null, p)).rejects.toThrow(/storage/);
    await expect(store.read(owner, p.id)).rejects.toThrow(/storage/);
    expect(count).toBe(1);
  });
  it("compares USD notional across wallet lanes and ignores token denominations", async () => {
    const { data, guard } = state(50),
      store = new MainnetStore(
        data,
        () => true,
        async () => {},
        guard,
      );
    const p = fixture();
    await store.cas(owner, p.id, null, p);
    const q = structuredClone(p);
    q.revision = 1;
    plan(
      q,
      "intent",
      String(micro(10)),
      [x(settle, micro(10))],
      false,
      String(micro(60)),
    );
    launch(q, "intent");
    await expect(store.cas(owner, q.id, 0, q)).rejects.toThrow(/24-hour/);
    const ok = structuredClone(q);
    ok.orders.intent.action.notionalUsd6 = String(micro(35));
    expect(await store.cas(owner, ok.id, 0, ok)).toBe(true);
    const p2 = fixture(hl, "live_second", "0xdef");
    expect(await store.cas(owner, p2.id, null, p2)).toBe(true);
    p2.revision++;
    plan(
      p2,
      "new",
      String(lot(1)),
      [x(settle, micro(3))],
      false,
      String(micro(18)),
    );
    launch(p2, "new");
    await expect(store.cas(owner, p2.id, 0, p2)).rejects.toThrow(/24-hour/);
  });
  it("protects wallet nonces from conflicting allowance claims and unresolved stopped runs; retains open receipt lots", async () => {
    const { data, guard } = state(),
      store = new MainnetStore(
        data,
        () => true,
        async () => {},
        guard,
      ),
      p = fixture(rh, "live_stock", "0xabcd");
    expect(await store.cas(owner, p.id, null, p)).toBe(true);
    p.revision++;
    plan(p, "order", "100", [x(settle, 100)]);
    launch(p, "order", "rh:4663:0xAbcd:7");
    data.liveAllowances.set("permit", {
      state: "claimed",
      terms: { owner: "0xABCD", nonce: "7" },
    });
    await expect(store.cas(owner, p.id, 0, p)).rejects.toThrow(/nonce/);
    data.liveAllowances.clear();
    p.status = "stopped";
    expect(await store.cas(owner, p.id, 0, p)).toBe(true);
    const second = fixture(rh, "live_reused", "0xABCD");
    expect(await store.cas(owner, second.id, null, second)).toBe(false);
    p.status = "complete";
    p.revision++;
    fill(p, "order", "100", [x(settle, 100)], [x(mint, 7)], now, 2);
    expect(await store.cas(owner, p.id, 1, p)).toBe(true);
    expect(await store.cas(owner, second.id, null, second)).toBe(false);
  });
  it("rehydrates the authoritative journal through PostgreSQL JSONB and fences unsubmitted orders on a restored backup", async () => {
    const path = await mkdtemp(join(tmpdir(), "q-live-store-"));
    let db = new PGlite(path);
    try {
      await db.exec(
        "create table live_checkpoint (revision bigint primary key,payload jsonb)",
      );
      const { data, guard } = state(),
        store = new MainnetStore(
          data,
          () => true,
          async () => {
            const v = [...data.livePrograms.values()][0];
            await db.query(
              "insert into live_checkpoint values ($1,$2::jsonb)",
              [v.revision, JSON.stringify(v)],
            );
          },
          guard,
        ),
        p = fixture();
      expect(await store.cas(owner, p.id, null, p)).toBe(true);
      p.revision = 1;
      plan(p, "waiting", "100", [x(settle, 100)]);
      plan(p, "sent", "100", [x(settle, 100)]);
      launch(p, "sent", "original");
      expect(await store.cas(owner, p.id, 0, p)).toBe(true);
      await db.close();
      db = new PGlite(path);
      const { rows } = await db.query<{ payload: LiveProgram }>(
        "select payload from live_checkpoint order by revision desc limit 1",
      );
      const fresh = state().data,
        loaded = rows[0].payload;
      loaded.ledger.accounts[0].free = "999999";
      fresh.livePrograms.set(p.id, loaded);
      fresh.liveAllowances.set("review", {
        state: "review",
        terms: { owner: "0xtest", nonce: "12" },
      });
      fresh.privySpotGrants.set("spot", {
        status: "active",
        sealed: "ciphertext",
        revision: 3,
      });
      restoreLivePrograms(fresh, false);
      expect(loaded.ledger.accounts[0].free).toBe(String(micro(1000) - 100n));
      expect(loaded.ledger.orders[1].status).toBe("dispatching");
      restoreLivePrograms(fresh, true);
      expect(loaded.ledger.orders[0].status).toBe("revoked");
      expect(loaded.ledger.orders[1].status).toBe("dispatching");
      expect(loaded.orders.sent.recoveryId).toBe("original");
      expect(loaded.controlEpoch).toBe(1);
      expect(loaded.status).toBe("paused");
      expect(fresh.liveAccess.get(owner)?.agent?.sealed).toBe("");
      expect(fresh.liveAccess.get(owner)?.consent).toBeUndefined();
      expect(fresh.privySpotGrants.get("spot")?.sealed).toBe("");
      expect(fresh.liveAllowances.get("review")?.state).toBe("declined");
      loaded.orders.sent.action.owner = "wrong";
      expect(() => restoreLivePrograms(fresh, false)).toThrow(/binding/);
    } finally {
      await db.close();
      await rm(path, { recursive: true, force: true });
    }
  }, 25000);
});
describe("mainnet marked risk", () => {
  it("values spot holdings, stable cash and exact native fees without counting gas allocation as venture capital", async () => {
    const p = fixture();
    plan(p, "buy", String(micro(20)), [
      x(settle, micro(20)),
      x("SOL:lamports", 1000000),
    ]);
    launch(p, "buy");
    fill(
      p,
      "buy",
      String(micro(20)),
      [x(settle, micro(20)), x("SOL:lamports", 1000000)],
      [x(mint, micro(2))],
      now,
      10,
    );
    const view = await markedProgramValue(
      p.wallets[0],
      p,
      val(9, { extraFeeUnits: async () => "200000" }),
      now,
    );
    expect(view.initial).toBe(1000);
    expect(view.equityUsd6).toBe("997880000");
    await expect(
      markedProgramValue(
        p.wallets[0],
        p,
        val(9, { observe: async () => null }),
        now,
      ),
    ).rejects.toThrow(/fresh/);
  });
  it("values an exact native-only sale including its starting inventory without requiring a stable genesis row", async () => {
    const p = fixture(),
      b = p.wallets[0];
    b.allocations = [x(mint, 1200000), x("SOL:lamports", 10000)];
    p.ledger = createLedger(
      p.id,
      b.allocations.map((a) => ({ ...a, venue: b.network })),
    );
    const view = await markedProgramValue(b, p, val(12.5), now);
    expect(view.equityUsd6).toBe("15000000");
    expect(view.initialUsd6).toBe("15000000");
  });
  it("attributes recurring perpetual lots and only one partial close, actual funding, trading fees, and unrealized P&L", async () => {
    const p = fixture(hl),
      b = p.wallets[0],
      asset = "hl:perp:BTC";
    plan(p, "e1", String(lot(1)), [x(settle, micro(51))]);
    launch(p, "e1", "o1", now - 5000);
    fill(
      p,
      "e1",
      String(lot(1)),
      [x(settle, micro(50.2))],
      [x(asset, lot(1))],
      now - 4800,
      100,
    );
    plan(p, "e2", String(lot(1)), [x(settle, micro(61))]);
    launch(p, "e2", "o2", now - 4000);
    fill(
      p,
      "e2",
      String(lot(1)),
      [x(settle, micro(60.2))],
      [x(asset, lot(1))],
      now - 3900,
      120,
    );
    plan(
      p,
      "x1",
      String(lot(1)),
      [x(asset, lot(1)), x(settle, micro(1))],
      true,
    );
    p.orders.x1.action.entryAverageUsd = 110;
    launch(p, "x1", "o3", now - 2000);
    fill(
      p,
      "x1",
      String(lot(1)),
      [x(asset, lot(1)), x(settle, micro(0.2))],
      [x(settle, micro(70))],
      now - 1950,
    );
    const funding = {
      delta: { coin: "BTC", szi: "1", usdc: "-0.50", type: "funding" },
      time: now - 4600,
      hash: "paid",
    };
    const info: NonNullable<LiveValuationRefs["perpInfo"]> = async (body) =>
      body.type === "clearinghouseState"
        ? {
            assetPositions: [
              {
                position: {
                  coin: "BTC",
                  szi: "1",
                  entryPx: "110",
                  leverage: { type: "isolated", value: 2 },
                },
              },
            ],
          }
        : [funding, funding];
    const v = await markedProgramValue(b, p, val(130, { perpInfo: info }), now);
    expect(v.equityUsd6).toBe("1033900000");
    await expect(
      markedProgramValue(
        b,
        p,
        val(130, {
          perpInfo: async (body) =>
            body.type === "clearinghouseState" ? { assetPositions: [] } : [],
        }),
        now,
      ),
    ).rejects.toThrow(/matches/);
    await expect(
      markedProgramValue(
        b,
        p,
        val(130, {
          perpInfo: async (body) =>
            body.type === "clearinghouseState"
              ? info(body)
              : [{ ...funding, delta: { ...funding.delta, szi: "3" } }],
        }),
        now,
      ),
    ).rejects.toThrow(/external/);
  });
  it("persists observed daily drawdown in USD micros and ignores private account top-ups", async () => {
    const p = fixture(),
      b = p.wallets[0],
      { guard } = state();
    let price = 10,
      commits = 0;
    guard.d.commit = async () => {
      commits++;
    };
    b.allocations = [x(mint, 1000000)];
    p.ledger = createLedger(
      p.id,
      b.allocations.map((a) => ({ ...a, venue: b.network })),
    );
    const loss = lossSampler(guard, {
      ...val(price),
      observe: async (a) => ({
        assetId: a.id,
        price,
        observedAt: now,
        synthetic: false,
        source: "feed",
      }),
    });
    expect(await loss(b, p)).toBe("0");
    price = 15;
    expect(await loss(b, p)).toBe("0");
    price = 14.01;
    expect(await loss(b, p)).toBe("990000");
    expect(commits).toBe(3);
  });
});
