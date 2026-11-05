import { describe, it, expect } from "vitest";
import { Strategy } from "../../contracts/src/strategy";
import { Workflow } from "../../contracts/src/workflow";
import {
  LiveCoordinator,
  type LiveProgram,
  type Driver,
  type Network,
  type StartLive,
  type Action,
  type Evidence,
  type Prepared,
  type WalletBudget,
} from "../../src/execution/live-program";
import { restoreLedger, serializeLedger } from "../../src/execution/ledger";
const sol = "solana-mainnet",
  hl = "hyperliquid-mainnet",
  rh = "robinhood-mainnet";
const stable = "USDc",
  native = "SOL";
function basket() {
  const assets = ["NEET", "TROLL", "SOL", "BTC", "XMR"].map((symbol, i) => {
    const address = i < 3 ? "Mint" + i + "BoundByDriver" : null,
      venue = i < 3 ? "solana" : "hyperliquid",
      kind = i < 3 ? "token" : "perp",
      id = i < 3 ? "sol:token:" + address : "hl:perp:" + symbol;
    return {
      id: "a" + i,
      query: symbol,
      sourceText: symbol,
      venue,
      kind,
      outcome: null,
      resolution: {
        status: "matched",
        candidates: [
          {
            id,
            address,
            symbol,
            venue,
            kind,
            name: symbol,
            source: i < 3 ? "dexscreener" : "hyperliquid",
            url: null,
            maxLeverage: i < 3 ? 1 : 30,
            endDate: null,
            outcome: null,
          },
        ],
        selectedId: id,
        checkedAt: new Date(0).toISOString(),
        message: "Selected",
      },
    };
  });
  const signals = assets.slice(0, 3).map((a, i) => ({
    id: "s" + i,
    assetId: a.id,
    kind: "price_change",
    change: { reference: "start", lookbackMinutes: null },
    indicator: null,
    schedule: null,
    description: a.query + " move",
  }));
  const expr = {
    op: "and",
    args: signals.map((s, i) => ({
      op: i === 2 ? "gte" : "lte",
      left: { ref: s.id + ".value" },
      right: { lit: [-10, -28, 20][i] },
    })),
  };
  const stages = assets.map((a, i) => ({
    id: "leg" + i,
    assetId: a.id,
    side: i < 3 ? "buy" : i === 3 ? "long" : "short",
    sourceText: a.query,
    conditionText: i < 3 ? "Joint move" : "All three settled",
    when: i < 3 ? expr : null,
    after:
      i < 3
        ? []
        : assets
            .slice(0, 3)
            .map((_, i) => ({ stageId: "leg" + i, event: "filled" })),
    amount: { unit: "usd", value: i < 3 ? 20 : 10 },
    leverage: i < 3 ? 1 : i === 3 ? 7 : 28,
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
  }));
  return Strategy.parse({
    schemaVersion: 1,
    name: "Basket",
    thesis: "Basket",
    signals: [],
    triggers: [],
    actions: [],
    risk: { maxPositionPct: 50 },
    workflow: Workflow.parse({
      version: 1,
      name: "Practical basket",
      summary: "conditions",
      budgetUsd: 1000,
      assets,
      signals,
      stages,
      questions: [],
    }),
  });
}
function wallet(network: Network, cap: string): WalletBudget {
  return {
    wallet: "owner-wallet-" + network,
    network,
    settlementAsset: stable,
    decimals: 6,
    allocations: [
      { asset: stable, units: cap },
      { asset: native, units: "150" },
    ],
    maxFeesPerOrder: [
      { asset: native, units: "2" },
      { asset: stable, units: "100000" },
    ],
  };
}
const owner = "alice";
class Harness {
  at = 1_792_000_000_000;
  prices: Record<string, number> = {
    a0: 100,
    a1: 100,
    a2: 100,
    a3: 100,
    a4: 100,
  };
  rows = new Map<string, LiveProgram>();
  synthetic = false;
  pauseAfterWrite = false;
  sends: string[] = [];
  fails = false;
  inventory: { asset: string; units: string }[] = [];
  precisions: Record<string, number> = {};
  equity: Partial<Record<Network, string>> = {};
  actual = new Map<string, Evidence>();
  loss: string | null = "0";
  stale = false;
  waitSeal?: () => Promise<void>;
  denyCommit = false;
  driver(network: Network): Driver {
    return {
      readiness: async () => null,
      balance: async (b, p) => ({
        network,
        wallet: b.wallet,
        settlementAsset: stable,
        decimals: 6,
        assetDecimals: this.precisions,
        equityUsd6: this.equity[network],
        free: [
          ...this.inventory,
          { asset: stable, units: "500000000" },
          { asset: native, units: "150" },
          ...Object.values(p.orders)
            .filter((o) => o.holding)
            .map((o) => ({
              asset: o.holding!.asset,
              units: o.holding!.quantity,
            })),
        ],
        observedAt: this.at - (this.stale ? 21000 : 0),
        lossUsd6: this.loss,
      }),
      delegated: async () => network === hl,
      prepare: async (a) => ({
        payload: {
          market: a.instrument.id,
          wallet: a.wallet,
          network,
          nonce: a.id,
        },
        expiresAt: this.at + 8000,
        targetUnits:
          a.leg === "exit"
            ? a.spendUnits
            : a.network === hl
              ? "1000"
              : a.spendUnits,
        reserves: [{ asset: a.spendAsset, units: a.spendUnits }],
        summary: a.side + " " + a.instrument.symbol,
      }),
      seal: async (a, t, auth) => {
        if (this.waitSeal) await this.waitSeal();
        if (network !== hl && auth.kind !== "wallet")
          throw Error("Signature required");
        return {
          recoveryId: a.id,
          packet: { market: a.instrument.id, nonce: a.id },
          delivery: network === rh ? "wallet" : "server",
        };
      },
      broadcast: async (a, t, s) => {
        const p = this.rows.get(owner + "-" + a.programId)!;
        expect(p.orders[a.id].recoveryId).toBe(s.recoveryId);
        this.sends.push(a.id);
        if (this.fails) throw Error("lost reply");
      },
      reconcile: async (a, t, r) =>
        this.actual.get(r) ?? {
          network,
          wallet: a.wallet,
          recoveryId: r,
          fills: [],
        },
      cancel: async () => "requested",
    };
  }
  runtime() {
    return new LiveCoordinator({
      drivers: {
        [sol]: this.driver(sol),
        [hl]: this.driver(hl),
        [rh]: this.driver(rh),
      },
      now: () => this.at,
      observe: async (a) =>
        this.prices[a.id]
          ? {
              assetId: a.id,
              price: this.prices[a.id],
              synthetic: this.synthetic,
              observedAt: this.at,
              source: "bound-market",
            }
          : null,
      store: {
        read: async (o, id) => {
          const p = this.rows.get(o + "-" + id);
          return p ? structuredClone(p) : null;
        },
        cas: async (o, id, rev, next) => {
          const old = this.rows.get(o + "-" + id);
          if (this.denyCommit || (old?.revision ?? null) !== rev) return false;
          const saved = structuredClone(next);
          if (
            this.pauseAfterWrite &&
            saved.ledger.orders.some((l) => l.dispatched)
          ) {
            this.pauseAfterWrite = false;
            saved.controlEpoch = (saved.controlEpoch ?? 0) + 1;
            saved.status = "paused";
            saved.revision++;
          }
          this.rows.set(o + "-" + id, saved);
          return true;
        },
      },
    });
  }
  startReq(mode: "confirm_each" | "auto" = "confirm_each"): StartLive {
    return {
      id: "wf",
      owner,
      strategyId: "saved",
      version: 7,
      strategy: basket(),
      mode,
      slippageBps: 40,
      wallets: [wallet(sol, "500000000"), wallet(hl, "500000000")],
    };
  }
  arm() {
    this.at += 1000;
    this.prices = { a0: 88, a1: 70, a2: 125, a3: 100, a4: 100 };
  }
  p() {
    return this.rows.get(owner + "-wf")!;
  }
  async prepared(mode: "confirm_each" | "auto" = "confirm_each") {
    const c = this.runtime();
    await c.start(this.startReq(mode));
    await c.tick(owner, "wf");
    this.arm();
    await c.tick(owner, "wf");
    return c;
  }
  fill(id: string, fraction: 1 | 2, extra?: Partial<Evidence>) {
    const o = this.p().orders[id],
      t = BigInt(o.terms.targetUnits),
      q = t / BigInt(fraction),
      asset =
        o.action.side === "sell"
          ? stable
          : (o.action.instrument.address ?? o.action.instrument.id),
      qty = q.toString(),
      ref = "venue:" + id;
    const make = (which: number, size: bigint) => ({
      fillId: "fill:" + id + ":" + which,
      orderRef: ref,
      qty: size.toString(),
      debits: [
        {
          asset: o.action.spendAsset,
          units: ((size * BigInt(o.action.spendUnits)) / t).toString(),
        },
      ],
      credits: [{ asset, units: size.toString() }],
    });
    const r: Evidence = {
      network: o.action.network,
      wallet: o.action.wallet,
      recoveryId: id,
      ref,
      fills:
        fraction === 2 ? [make(1, q)] : [make(1, t / 2n), make(2, t - t / 2n)],
      ...(o.action.leg === "entry" && o.action.side !== "sell"
        ? {
            holding: {
              asset,
              quantity: qty,
              averageEntryUsd: 100,
              openedAt: this.p().createdAt,
            },
          }
        : {}),
      ...(fraction === 1
        ? {
            final: {
              orderRef: ref,
              outcome: "filled",
              cumulativeQty: qty,
              cumulativeDebits: [
                { asset: o.action.spendAsset, units: o.action.spendUnits },
              ],
              cumulativeCredits: [{ asset, units: qty }],
            },
          }
        : {}),
      ...extra,
    };
    this.actual.set(id, r);
  }
}
const signed = { kind: "wallet" as const, value: "fixture" };
function single(h: Harness) {
  const r = h.startReq(),
    w = r.strategy.workflow!;
  w.assets = w.assets.slice(0, 1);
  w.signals = [];
  w.stages = w.stages.slice(0, 1);
  w.stages[0].when = null;
  r.wallets = [wallet(sol, "500000000")];
  return r;
}
describe("live cross-venue coordinator", () => {
  it("observes a joint gate, holds BTC and XMR through a partial Solana receipt and a restart, then submits the exact leverage", async () => {
    const h = new Harness();
    let c = await h.prepared("auto");
    const seeds = Object.values(h.p().orders);
    expect(seeds.map((o) => o.action.instrument.symbol)).toEqual([
      "NEET",
      "TROLL",
      "SOL",
    ]);
    expect(h.sends).toHaveLength(0);
    h.fails = true;
    for (const o of seeds)
      await c.confirm(owner, "wf", o.action.id, o.digest, signed);
    for (const [i, o] of seeds.entries()) h.fill(o.action.id, i < 2 ? 1 : 2);
    h.at += 1000;
    await c.tick(owner, "wf");
    expect(Object.values(h.p().orders)).toHaveLength(3);
    expect(h.sends).toHaveLength(3);
    const recovered = JSON.parse(JSON.stringify(h.p())) as LiveProgram;
    recovered.ledger = restoreLedger(serializeLedger(recovered.ledger));
    h.rows.set(owner + "-wf", recovered);
    c = h.runtime();
    await c.confirm(owner, "wf", seeds[2].action.id, seeds[2].digest, signed);
    expect(h.sends).toHaveLength(3);
    h.fill(seeds[2].action.id, 1);
    h.at += 1000;
    await c.tick(owner, "wf");
    h.at += 1000;
    await c.tick(owner, "wf");
    const derived = Object.values(h.p().orders).slice(3);
    expect(
      derived.map((o) => [
        o.action.instrument.symbol,
        o.action.side,
        o.action.leverage,
      ]),
    ).toEqual([
      ["BTC", "long", 7],
      ["XMR", "short", 28],
    ]);
    expect(h.sends).toHaveLength(5);
  });
  it("rejects stale funding, a wrong owner or changed digest and only broadcasts after a successful CAS", async () => {
    const h = new Harness(),
      c = await h.prepared(),
      o = Object.values(h.p().orders)[0];
    await expect(
      c.confirm("mallory", "wf", o.action.id, o.digest, signed),
    ).rejects.toThrow("not found");
    await expect(
      c.confirm(owner, "wf", o.action.id, "changed", signed),
    ).rejects.toThrow("terms");
    h.stale = true;
    await expect(
      c.confirm(owner, "wf", o.action.id, o.digest, signed),
    ).rejects.toThrow("Fresh balance");
    h.stale = false;
    h.denyCommit = true;
    await expect(
      c.confirm(owner, "wf", o.action.id, o.digest, signed),
    ).rejects.toThrow("changed");
    h.denyCommit = false;
    expect(h.sends).toHaveLength(0);
    const p = await Promise.allSettled([
      c.confirm(owner, "wf", o.action.id, o.digest, signed),
      c.confirm(owner, "wf", o.action.id, o.digest, signed),
    ]);
    expect(p.some((v) => v.status === "fulfilled")).toBe(true);
    expect(h.sends).toHaveLength(1);
  });
  it("honors a pause that races wallet authorization, revokes stale reviews, and refuses expired terms", async () => {
    const h = new Harness(),
      c = await h.prepared(),
      o = Object.values(h.p().orders)[0];
    let ready!: () => void, unblock!: () => void;
    const entered = new Promise<void>((r) => {
      ready = r;
    });
    const door = new Promise<void>((r) => {
      unblock = r;
    });
    h.waitSeal = async () => {
      ready();
      await door;
    };
    const submitting = c.confirm(owner, "wf", o.action.id, o.digest, signed);
    await entered;
    await c.control(owner, "wf", "pause");
    unblock();
    await expect(submitting).rejects.toThrow("changed");
    expect(h.sends).toHaveLength(0);
    await c.control(owner, "wf", "resume");
    h.at += 1000;
    await c.tick(owner, "wf");
    const fresh = Object.values(h.p().orders).at(-1)!;
    h.at += 9000;
    await expect(
      c.confirm(owner, "wf", fresh.action.id, fresh.digest, signed),
    ).rejects.toThrow("actionable");
  });
  it("refuses stale or synthetic trigger data and mismatched chain evidence", async () => {
    const h = new Harness(),
      c = h.runtime();
    await c.start(h.startReq());
    await c.tick(owner, "wf");
    h.arm();
    delete h.prices.a1;
    await c.tick(owner, "wf");
    expect(Object.keys(h.p().orders)).toHaveLength(0);
    h.at += 1000;
    h.prices.a1 = 69;
    await c.tick(owner, "wf");
    for (const o of Object.values(h.p().orders)) {
      await c.confirm(owner, "wf", o.action.id, o.digest, signed);
      h.fill(o.action.id, 1, { network: hl });
    }
    h.at += 1000;
    await c.tick(owner, "wf");
    expect(h.p().ledger.orders.every((o) => o.status === "dispatching")).toBe(
      true,
    );
  });
  it("keeps EVM signable bytes hidden until the one durable handoff and accepts a cash-less receipt hint without treating it as proof", async () => {
    const h = new Harness(),
      r = h.startReq();
    const w = r.strategy.workflow!;
    w.assets = w.assets.slice(0, 1);
    const a = w.assets[0],
      m = a.resolution!.candidates[0];
    Object.assign(m, {
      id: "rh:token:ACME",
      venue: "robinhood",
      kind: "token",
      source: "preview_catalog",
      symbol: "ACME",
      address: null,
    });
    Object.assign(a, { venue: "robinhood", kind: "token" });
    a.resolution!.selectedId = m.id;
    w.signals = [];
    w.stages = w.stages.slice(0, 1);
    w.stages[0].when = null;
    r.wallets = [wallet(rh, "500000000")];
    const c = h.runtime();
    await c.start(r);
    const review = await c.tick(owner, "wf"),
      o = review.orders[0];
    expect(o.unsigned).toBeNull();
    await expect(
      c.confirm(owner, "wf", o.id, o.digest, signed),
    ).rejects.toThrow("authorization");
    const one = await c.confirm(owner, "wf", o.id, o.digest, {
      kind: "wallet",
      value: { authorizeWalletSubmission: true },
    });
    expect("walletSubmission" in one).toBe(true);
    expect(h.sends.length).toBe(0);
    expect(
      "walletSubmission" in
        (await c.confirm(owner, "wf", o.id, o.digest, {
          kind: "wallet",
          value: { authorizeWalletSubmission: true },
        })),
    ).toBe(false);
    await c.walletReceipt(owner, "wf", o.id, o.digest, "0x" + "12".repeat(32));
    await c.tick(owner, "wf");
    expect(h.p().ledger.orders[0].status).toBe("dispatching");
  });
  it("manually closes exactly the verified holding after completion without releasing new entries or requiring another venue for risk checks", async () => {
    const h = new Harness(),
      c = h.runtime();
    await c.start(single(h));
    const first = (await c.tick(owner, "wf")).orders[0];
    await c.confirm(owner, "wf", first.id, first.digest, signed);
    h.fill(first.id, 1);
    h.at += 100;
    expect((await c.tick(owner, "wf")).status).toBe("complete");
    const held = h.p().orders[first.id].holding!;
    h.loss = null;
    expect((await c.view(owner, "wf")).stages[0].canClose).toBe(true);
    const close = await c.close(owner, "wf", "leg0"),
      sell = close.orders.at(-1)!;
    expect(close.status).toBe("complete");
    expect(sell.leg).toBe("exit");
    expect(sell.spendUnits).toBe(held.quantity);
    expect(h.p().orders[sell.id].action.reduceOnly).toBe(true);
    expect(h.sends).toHaveLength(1);
    expect((await c.close(owner, "wf", "leg0")).orders).toHaveLength(2);
    await c.confirm(owner, "wf", sell.id, sell.digest, signed);
    h.fill(sell.id, 1);
    h.at += 100;
    const ended = await c.tick(owner, "wf");
    expect(ended.status).toBe("complete");
    expect(ended.orders[1].status).toBe("filled");
    await expect(c.close(owner, "wf", "leg0")).rejects.toThrow("No confirmed");
    expect(h.sends).toHaveLength(2);
  });
  it("rechecks the original fresh trigger before signing, including the correct side of a crossing", async () => {
    const h = new Harness(),
      c = await h.prepared(),
      pending = Object.values(h.p().orders)[0];
    h.prices.a1 = 100;
    h.at += 100;
    await expect(
      c.confirm(owner, "wf", pending.action.id, pending.digest, signed),
    ).rejects.toThrow("trigger");
    h.prices.a1 = 60;
    h.synthetic = true;
    await expect(
      c.confirm(owner, "wf", pending.action.id, pending.digest, signed),
    ).rejects.toThrow("observation");
    expect(h.sends).toHaveLength(0);
    const h2 = new Harness(),
      r = single(h2),
      w = r.strategy.workflow!,
      c2 = h2.runtime();
    w.signals = [
      {
        id: "q",
        assetId: "a0",
        kind: "price",
        indicator: null,
        schedule: null,
        description: "Observed price",
      },
    ];
    w.stages[0].when = {
      op: "crosses_above",
      left: { ref: "q.value" },
      right: { lit: 100 },
    };
    await c2.start(r);
    await c2.tick(owner, "wf");
    h2.at += 100;
    h2.prices.a0 = 101;
    const crossed = (await c2.tick(owner, "wf")).orders[0];
    expect(crossed).toBeTruthy();
    h2.at += 100;
    h2.prices.a0 = 100;
    await expect(
      c2.confirm(owner, "wf", crossed.id, crossed.digest, signed),
    ).rejects.toThrow("trigger");
    h2.prices.a0 = 101;
    await c2.confirm(owner, "wf", crossed.id, crossed.digest, signed);
    expect(h2.sends).toHaveLength(1);
  });
  it("honors a pause committed between the dispatch write and transport while keeping the recovery ID", async () => {
    const h = new Harness(),
      c = await h.prepared(),
      o = Object.values(h.p().orders)[0];
    h.pauseAfterWrite = true;
    const view = await c.confirm(owner, "wf", o.action.id, o.digest, signed);
    expect(view.status).toBe("paused");
    expect(h.p().orders[o.action.id].recoveryId).toBe(o.action.id);
    expect(h.sends).toHaveLength(0);
    h.at += 1000;
    await c.tick(owner, "wf");
    expect(h.sends).toHaveLength(0);
    expect(h.p().ledger.orders[0].status).toBe("dispatching");
  });
  it("does not substitute a partial holding for the final holding or accept malformed receipt batches", async () => {
    const h = new Harness(),
      c = h.runtime();
    await c.start(single(h));
    const o = (await c.tick(owner, "wf")).orders[0];
    await c.confirm(owner, "wf", o.id, o.digest, signed);
    h.fill(o.id, 2);
    h.at += 100;
    await c.tick(owner, "wf");
    expect(h.p().ledger.orders[0].status).toBe("partial");
    h.fill(o.id, 1, { holding: undefined });
    h.at += 100;
    await c.tick(owner, "wf");
    expect(h.p().ledger.orders[0].status).toBe("partial");
    h.fill(o.id, 1, {
      holding: {
        asset: "wrong-mint",
        quantity: "1",
        averageEntryUsd: 100,
        openedAt: h.p().createdAt,
      },
    });
    h.at += 100;
    await c.tick(owner, "wf");
    expect(h.p().ledger.orders[0].status).toBe("partial");
    h.fill(o.id, 1);
    h.at += 100;
    await c.tick(owner, "wf");
    expect(h.p().ledger.orders[0].status).toBe("filled");
  });
  it("allows an explicit exit for a cancelled partially filled entry, strictly limited to the proved credited quantity", async () => {
    const h = new Harness(),
      c = h.runtime();
    await c.start(single(h));
    const o = (await c.tick(owner, "wf")).orders[0];
    await c.confirm(owner, "wf", o.id, o.digest, signed);
    h.fill(o.id, 2);
    const e = h.actual.get(o.id)!,
      f = e.fills[0];
    e.final = {
      orderRef: f.orderRef,
      outcome: "cancelled",
      cumulativeQty: f.qty,
      cumulativeDebits: f.debits,
      cumulativeCredits: f.credits,
    };
    h.at += 100;
    expect((await c.tick(owner, "wf")).status).toBe("paused");
    const sell = (await c.close(owner, "wf", "leg0")).orders.at(-1)!;
    expect(sell.spendUnits).toBe(f.qty);
  });

  it("sells only explicitly funded native inventory and records stable USD notional independently of token decimals", async () => {
    const h = new Harness(),
      req = single(h),
      w = req.strategy.workflow!,
      m = w.assets[0].resolution!.candidates[0].address!;
    const st = w.stages[0];
    st.side = "sell";
    st.amount = { unit: "native", value: 1.25 };
    h.inventory = [{ asset: m, units: "500" }];
    h.precisions = { [m]: 2 };
    req.mode = "auto";
    req.wallets[0].allocations = [
      { asset: m, units: "500" },
      { asset: native, units: "1" },
    ];
    const c = h.runtime();
    await c.start(req);
    const ready = await c.tick(owner, "wf"),
      o = ready.orders[0];
    expect(o.spendAsset).toBe(m);
    expect(o.spendUnits).toBe("125");
    expect(o.notionalUsd6).toBe("125000000");
    expect(h.sends).toHaveLength(0);
    await c.confirm(owner, "wf", o.id, o.digest, signed);
    h.fill(o.id, 1);
    h.at += 100;
    const done = await c.tick(owner, "wf");
    expect(done.status).toBe("complete");
    expect(done.allocations.find((v) => v.asset === m)?.free).toBe("375");
    await expect(c.close(owner, "wf", "leg0")).rejects.toThrow("No confirmed");
    const bad = structuredClone(req);
    bad.id = "other";
    bad.strategy.workflow!.stages[0].amount.value = 6;
    await expect(c.start(bad)).rejects.toThrow("allocated inventory");
  });
  it("fixes a percentage order to observed attributable equity and refuses stale exact terms if a subsequent loss reduces the permitted size", async () => {
    const h = new Harness(),
      req = single(h),
      st = req.strategy.workflow!.stages[0];
    st.amount = { unit: "pct_equity", value: 25 };
    const c = h.runtime();
    await expect(c.start(req)).rejects.toThrow(/equity/i);
    h.equity[sol] = "400000000";
    await c.start(req);
    const ready = await c.tick(owner, "wf"),
      o = ready.orders[0];
    expect(o.spendUnits).toBe("100000000");
    expect(o.notionalUsd6).toBe("100000000");
    h.equity[sol] = "360000000";
    await expect(
      c.confirm(owner, "wf", o.id, o.digest, signed),
    ).rejects.toThrow(/Equity changed/);
    expect(h.sends).toHaveLength(0);
  });
});
