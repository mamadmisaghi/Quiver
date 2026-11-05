import { WorkflowHost } from "../../src/workflows/host";
import { paperLivePlan } from "../../src/execution/live-review";
import {
  randomUUID,
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { Hono } from "hono";
import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "../../src/config";
import { MemStore, type User } from "../../src/store";
import { MainnetHost } from "../../src/execution/live-host";
import { liveRoutes } from "../../src/execution/live-routes";
import { SecretVault } from "../../src/secrets/vault";
import { AllowanceQueue } from "../../src/execution/live-approvals";
import type { LiveAuthority } from "../../src/execution/live-authority";
import type { LiveProgram, Action } from "../../src/execution/live-program";
import type {
  RhPrepared,
  RobinhoodMainnet,
} from "../../src/execution/robinhood-mainnet";
import { createLedger } from "../../src/execution/ledger";
import { Risk, Strategy } from "../../contracts/src/strategy";

const wallet = "0x1111111111111111111111111111111111111111",
  origin = "https://quiver.example";
const now = 1793749200000;
const person = (id: string) =>
  ({
    id,
    label: "privy:did:privy:" + id,
    linkedWallets: [{ address: wallet, linkedAt: now }],
    solanaWallets: [],
    eligibility: {},
  }) as unknown as User;
function authorityHeaders(
  path: string,
  verb: string,
  userId: string,
  key: KeyObject,
) {
  const headers = new Headers({
    "content-type": "application/json",
    authorization: "Bearer " + userId,
    origin,
  });
  const at = String(now),
    nonce = randomUUID(),
    country = "DE",
    auth = createHash("sha256")
      .update(headers.get("authorization")!)
      .digest("base64");
  const bytes = Buffer.from(
    ["quiver-origin-v1", origin, verb, path, at, nonce, country, auth].join(
      "\n",
    ),
  );
  headers.set(
    "x-quiver-origin-proof",
    [at, nonce, country, sign(null, bytes, key).toString("base64")].join("."),
  );
  return headers;
}
function plan() {
  return Strategy.parse({
    schemaVersion: 1,
    name: "BTC staged entry",
    thesis: "test mainnet review",
    signals: [],
    triggers: [],
    actions: [],
    risk: Risk.parse({}),
    workflow: {
      version: 1,
      name: "BTC staged entry",
      summary: "A BTC position",
      budgetUsd: 1000,
      signals: [],
      questions: [],
      assumptions: [],
      assets: [
        {
          id: "btc",
          query: "BTC",
          sourceText: "BTC",
          venue: "hyperliquid",
          kind: "perp",
          outcome: null,
          resolution: {
            status: "matched",
            selectedId: "hl:perp:BTC",
            checkedAt: new Date(now).toISOString(),
            message: "Matched",
            candidates: [
              {
                id: "hl:perp:BTC",
                name: "Bitcoin perpetual",
                symbol: "BTC",
                venue: "hyperliquid",
                kind: "perp",
                source: "hyperliquid",
                address: null,
                url: null,
                maxLeverage: 40,
                endDate: null,
                outcome: null,
              },
            ],
          },
        },
      ],
      stages: [
        {
          id: "entry",
          assetId: "btc",
          side: "long",
          sourceText: "Long BTC",
          conditionText: "On start",
          when: null,
          after: [],
          amount: { unit: "usd", value: 20 },
          leverage: 1,
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
}
describe("mainnet HTTP boundaries", () => {
  it("requires a fresh verified location and a matching reviewed program, and isolates account ownership", async () => {
    const keys = generateKeyPairSync("ed25519"),
      publicDer = keys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      store = new MemStore();
    const cfg = loadConfig({
      TERMS_VERSION: "live-v1",
      SIWE_ORIGIN: origin,
      QUIVER_EDGE_PUBLIC_KEY: publicDer,
    });
    const a = person("personA000000"),
      b = person("personB000000");
    store.users.set(a.id, a);
    store.users.set(b.id, b);
    store.strategies.set("stg_mainnet", {
      id: "stg_mainnet",
      ownerId: a.id,
      archived: false,
      versions: [{ version: 1, strategy: plan() }],
    } as never);
    let fail = false;
    const host = new MainnetHost({
      store,
      config: cfg,
      vault: new SecretVault("21".repeat(32)),
      enabled: () => true,
      healthy: () => !fail,
      commit: async () => {},
      now: () => now,
    });
    const app = new Hono<{ Variables: { user: User; requestId: string } }>();
    app.use("*", async (c, next) => {
      const uid = c.req.header("authorization")?.slice(7),
        u = uid ? store.users.get(uid) : null;
      if (!u) return c.json({ error: "unauthorized" }, 401);
      c.set("user", u);
      c.set("requestId", "check");
      await next();
    });
    app.route(
      "/v1/live",
      liveRoutes(host, () => {}),
    );
    const req = (
      uid: string,
      path: string,
      data?: unknown,
      verified = false,
    ) => {
      const method = data === undefined ? "GET" : "POST",
        url = "/v1/live" + path,
        headers = verified
          ? authorityHeaders(url, method, uid, keys.privateKey)
          : new Headers({
              origin,
              "content-type": "application/json",
              authorization: "Bearer " + uid,
              "cf-ipcountry": "DE",
            });
      return app.request(url, {
        method,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
    };
    const consent = {
      version: "live-v1",
      residence: "DE",
      nonUs: true,
      acceptRealFunds: true,
      limits: {
        maxOrderUsd: 40,
        dailyUsd: 100,
        maxLeverage: 3,
        maxSlippageBps: 50,
      },
    };
    expect((await req(a.id, "/consent", consent)).status).toBe(403);
    expect((await req(a.id, "/consent", consent, true)).status).toBe(200);
    expect(
      (await req(b.id, "/review", { strategyId: "stg_mainnet", version: 1 }))
        .status,
    ).toBe(404);
    const response = await req(a.id, "/review", {
      strategyId: "stg_mainnet",
      version: 1,
    });
    expect(response.status).toBe(200);
    const q = (await response.json()) as {
      reviewHash: string;
      stages: { tokenDecimals: number }[];
    };
    expect(q.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(q.stages[0].tokenDecimals).toBe(18);
    const start = {
      strategyId: "stg_mainnet",
      version: 1,
      key: "unique-mainnet-launch",
      network: "mainnet",
      mode: "confirm_each",
      acceptRealOrders: true,
      slippageBps: 50,
      reviewHash: q.reviewHash,
      wallets: [
        {
          network: "hyperliquid-mainnet",
          wallet,
          usd: "50",
          feePerOrder: "500000",
          gasBudget: "0",
        },
      ],
    };
    const send = vi
      .spyOn(host.coord, "start")
      .mockResolvedValue({ id: "live_ok" } as never);
    vi.spyOn(host, "announceTick").mockImplementation(() => {});
    expect(
      (
        await req(
          a.id,
          "/start",
          { ...start, reviewHash: "0".repeat(64) },
          true,
        )
      ).status,
    ).toBe(409);
    expect((await req(a.id, "/start", start, true)).status).toBe(201);
    expect(send).toHaveBeenCalledOnce();

    // The saved draft still says $20. The session edited that order to $25.
    const paper = new WorkflowHost({
      records: store.workflowSessions,
      now: () => now,
      healthy: () => true,
      commit: async () => {},
      intervalMs: 20000,
      maxActive: 5,
    });
    const paperId = paper.start(
      a.id,
      "paper-review-source",
      "stg_mainnet",
      1,
      plan(),
      "auto",
      120,
    ).session.id;
    paper.edit(a.id, paperId, 0, [{ key: "entry.size", value: 25 }]);
    const source = { strategyId: paperId, version: 2 };
    expect((await req(b.id, "/review", source)).status).toBe(404);
    expect((await req(a.id, "/review", { ...source, version: 1 })).status).toBe(
      409,
    );
    const checked = (await (await req(a.id, "/review", source)).json()) as {
      reviewHash: string;
      stages: { amount: { value: number } }[];
    };
    expect(checked.stages[0].amount.value).toBe(25);
    const launch = {
      ...start,
      ...source,
      key: "paper-fresh-launch",
      reviewHash: checked.reviewHash,
    };
    expect((await req(a.id, "/start", launch, true)).status).toBe(201);
    expect(
      send.mock.calls.at(-1)?.[0].strategy.workflow?.stages[0].amount.value,
    ).toBe(25);
    paper.edit(a.id, paperId, 1, [{ key: "entry.size", value: 35 }]);
    expect((await req(a.id, "/start", launch, true)).status).toBe(409);
    expect(send).toHaveBeenCalledTimes(2);
    const sample = structuredClone(paper.owned(a.id, paperId).session);
    const w = sample.strategy.workflow!,
      entry = w.stages[0];
    w.stages.push(
      {
        ...entry,
        id: "dependent",
        after: [{ stageId: entry.id, event: "filled" }],
      },
      { ...entry, id: "independent" },
    );
    sample.pausedRules = [entry.id];
    const effective = paperLivePlan(sample, 3);
    expect(effective.strategy.workflow?.stages.map((s) => s.id)).toEqual([
      "independent",
    ]);
    expect(effective.omitted).toEqual(["entry", "dependent"]);
    expect(sample.strategy.workflow!.stages).toHaveLength(3);
    sample.provenance = "imported";
    expect(() => paperLivePlan(sample, 3)).toThrow(/editable/);
    fail = true;
    expect((await req(a.id, "/start", start, true)).status).toBe(503);
    await host.stop();
  });
});
describe("stock allowance outbox", () => {
  const owner = person("alice000000"),
    stranger = person("bob000000"),
    token = "0x" + "2".repeat(40);
  const mk = () => {
    const store = new MemStore();
    store.users.set(owner.id, owner);
    const p = {
      id: "run_stock",
      owner: owner.id,
      status: "running",
      controlEpoch: 0,
      orders: {},
      ledger: createLedger("run_stock", [
        { venue: "robinhood-mainnet", asset: "ETH", units: "10000" },
      ]),
    } as unknown as LiveProgram;
    store.livePrograms.set(p.id, p);
    const t = {
      kind: "approve",
      owner: wallet,
      symbol: "AAPL",
      inputToken: token,
      inputUnits: "25000000",
      nonce: "9",
      expiresAt: now + 30000,
      maxFeeWei: "1200",
      termsHash: "0x" + "a".repeat(64),
      tx: { nonce: "0x9" },
    } as unknown as RhPrepared;
    const action = {
      id: "intent_one",
      network: "robinhood-mainnet",
      wallet,
      programId: p.id,
      owner: owner.id,
      stage: "a",
      spendUnits: "25000000",
      leg: "entry",
      reduceOnly: false,
    } as Action;
    const mock = {
        validate: vi.fn(async () => {}),
        reconcile: vi.fn(async () => ({ status: "pending" })),
      },
      access = {
        allow: () => true,
        require: () => {},
        eligible: () => true,
        writable: () => {},
        linked: () => true,
      } as unknown as LiveAuthority;
    return { store, p, t, action, mock, access };
  };
  it("releases the exact wallet transaction once after a durable claim and never counts its approval as a swap", async () => {
    const { store, p, t, action, mock, access } = mk();
    let committed = false,
      entered: () => void = () => {},
      release: () => void = () => {};
    const begin = new Promise<void>((a) => {
        entered = a;
      }),
      wait = new Promise<void>((a) => {
        release = a;
      });
    const q = new AllowanceQueue(
      store,
      mock as unknown as RobinhoodMainnet,
      access,
      async () => {
        if (
          [...store.liveAllowances.values()].some((x) => x.state === "claimed")
        ) {
          entered();
          await wait;
          committed = true;
        }
      },
      () => now,
    );
    await q.queue(action, t);
    const row = q.list(owner.id)[0];
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty("tx");
    expect(q.list(stranger.id)).toEqual([]);
    const claim = q.claim(owner, row.id, row.digest);
    await begin;
    expect(committed).toBe(false);
    await expect(q.claim(owner, row.id, row.digest)).rejects.toThrow();
    release();
    const packet = await claim;
    expect(packet.tx).toEqual(t.tx);
    expect(committed).toBe(true);
    await expect(q.claim(stranger, row.id, row.digest)).rejects.toThrow();
    expect(q.fees(p.id).held).toBe(1200n);
    await q.refresh(owner, row.id);
    expect(q.list(owner.id)[0].state).toBe("claimed");
    mock.reconcile.mockResolvedValueOnce({
      status: "approval_confirmed",
      feeWei: "100",
      blockTime: now,
      txHash: "0x" + "3".repeat(64),
    } as never);
    await q.refresh(owner, row.id);
    expect(q.list(owner.id)[0].state).toBe("confirmed");
    expect(q.fees(p.id)).toEqual({ held: 0n, paid: 100n });
    expect(p.ledger.orders).toEqual([]);
  });
  it("invalidates the pending wallet release when stop wins the receipt-write race", async () => {
    const { store, p, t, action, mock, access } = mk();
    const q = new AllowanceQueue(
      store,
      mock as unknown as RobinhoodMainnet,
      access,
      async () => {
        if (
          [...store.liveAllowances.values()].some((x) => x.state === "claimed")
        ) {
          p.status = "stopped";
          p.controlEpoch = 1;
        }
      },
      () => now,
    );
    await q.queue(action, t);
    const row = q.list(owner.id)[0];
    await expect(q.claim(owner, row.id, row.digest)).rejects.toThrow(/stopped/);
    expect(q.list(owner.id)[0].state).toBe("claimed");
    expect(q.list(owner.id)[0]).not.toHaveProperty("tx");
  });
});
