import { describe, it, expect, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { Workflow } from "../../contracts/src/workflow";
import { Strategy, Risk } from "../../contracts/src/strategy";
import { recurringDraft } from "../../src/compile/recurring";
import { ExecutionService } from "../../src/execution/service";
import type { HyperliquidTestnet, L1Action } from "../../src/execution/hyperliquid-testnet";
import { SecretVault } from "../../src/secrets/vault";
import { MemStore, type User } from "../../src/store";
import { durableSnapshot, restoreDurable } from "../../src/storage/postgres";
import { testnetIssues } from "../../src/execution/testnet-workflow";

function twoMarkets() {
  const w = Workflow.parse(
    recurringDraft("if NEET price below 0.003 buy $100 of NEET every one minute until out of budget"),
  );
  w.signals = [];
  w.questions = [];
  w.budgetUsd = 1000;
  w.assets = ["BTC", "ETH"].map((symbol, i) => {
    const candidate = {
      id: "hl:perp:" + symbol,
      symbol,
      name: symbol + " perpetual",
      venue: "hyperliquid" as const,
      kind: "perp" as const,
      source: "hyperliquid" as const,
      address: null,
      url: null,
      maxLeverage: 10,
      endDate: null,
      outcome: null,
    };
    return {
      ...w.assets[0],
      id: "a" + i,
      query: symbol,
      venue: "hyperliquid",
      kind: "perp",
      resolution: {
        status: "matched",
        selectedId: candidate.id,
        checkedAt: new Date(0).toISOString(),
        message: "Matched",
        candidates: [candidate],
      },
    };
  });
  w.stages = w.assets.map((a, i) => ({
    ...w.stages[0],
    id: "s" + i,
    assetId: a.id,
    side: "long",
    amount: { unit: "usd", value: 25 },
    leverage: 1,
    repeat: null,
    when: null,
    after: i ? [{ stageId: "s0", event: "filled" }] : [],
  }));
  return Strategy.parse({
    schemaVersion: 1,
    name: "Two confirmed entries",
    thesis: "Use exchange receipts",
    signals: [],
    triggers: [],
    actions: [],
    risk: Risk.parse({}),
    workflow: w,
  });
}
describe("receipt-driven testnet execution", () => {
  it("keeps a dependent order blocked through a lost response, partial fill and journal restore", async () => {
    let store = new MemStore(),
      at = 1793700000000,
      sends = 0,
      filled = false,
      checkpoint = "";
    const master = privateKeyToAccount(generatePrivateKey()).address;
    const u = { id: "user-test", linkedWallets: [{ address: master, linkedAt: at }] } as User;
    store.users.set(u.id, u);
    let preparedSize = "";
    const venue = {
      account: async () => ({ equity: "1000", withdrawable: "1000", occupied: false }),
      approve: async () => {},
      activeGrant: async () => true,
      midpoint: async () => ({ price: 100, observedAt: at }),
      market: async (symbol: string) => ({
        symbol,
        asset: symbol === "BTC" ? 0 : 1,
        szDecimals: 4,
        maxLeverage: 50,
        onlyIsolated: false,
      }),
      bestPrice: async () => "100",
      submit: vi.fn(async ({ action }: { action: L1Action }) => {
        if (action.type === "order") {
          sends++;
          expect(
            JSON.parse(checkpoint).executionAccounts[0][1].orders.at(-1).ledger.orders[0].dispatched,
          ).toBe(true);
          preparedSize = action.orders[0].s;
          throw Error("lost response");
        }
        return { kind: "acknowledged" };
      }),
      reconcile: async () => {
        const qty = Number(preparedSize);
        const half = +(qty / 2).toFixed(8);
        const receipt = (n: number, sz: string) => ({
          time: at - 1000,
          tid: n,
          px: "100",
          sz,
          fee: "0",
          feeToken: "USDC",
        });
        return {
          status: filled ? "filled" : "partial",
          complete: filled,
          oid: 12,
          filledSize: String(filled ? qty : half),
          receipts: filled
            ? [receipt(1, String(half)), receipt(2, String(+(qty - half).toFixed(8)))]
            : [receipt(1, String(half))],
        };
      },
    } as unknown as HyperliquidTestnet;
    const vault = new SecretVault(randomBytes(32).toString("hex")),
      make = () =>
        new ExecutionService({
          store,
          venue,
          vault,
          now: () => at,
          enabled: () => true,
          durable: () => true,
          commit: async () => {
            checkpoint = JSON.stringify(durableSnapshot(store));
          },
        });
    let service = make();
    service.grant(u, master);
    await service.activate(u, ("0x" + "00".repeat(65)) as `0x${string}`);
    const st = twoMarkets();
    expect(testnetIssues(st)).toEqual([]);
    await service.startProgram(u, "stg_two", 1, st, "confirm_each");
    let program = service.record(u.id).programs![0];
    at += 1000;
    await service.driveProgram(u, program);
    let orders = service.record(u.id).orders;
    expect(orders).toHaveLength(1);
    expect(sends).toBe(0);
    await service.confirm(u, orders[0].terms.id, orders[0].terms.digest);
    expect(orders[0].ledger.orders[0].status).toBe("partial");
    expect(sends).toBe(1);
    const stored = durableSnapshot(store);
    store = new MemStore();
    restoreDurable(store, JSON.parse(JSON.stringify(stored)));
    service = make();
    program = service.record(u.id).programs![0];
    orders = service.record(u.id).orders;
    await service.driveProgram(u, program);
    expect(orders).toHaveLength(1);
    expect(sends).toBe(1);
    filled = true;
    await service.reconcile(u, orders[0].terms.id);
    expect(orders[0].ledger.orders[0].status).toBe("filled");
    at += 1000;
    await service.driveProgram(u, program);
    expect(orders).toHaveLength(2);
    expect(orders[1].terms.symbol).toBe("ETH");
    expect(sends).toBe(1);
    service.pause(u);
    await expect(service.confirm(u, orders[1].terms.id, orders[1].terms.digest)).rejects.toThrow();
    expect(sends).toBe(1);
  });
});
