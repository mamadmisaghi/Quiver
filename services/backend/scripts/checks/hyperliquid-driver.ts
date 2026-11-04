import assert from "node:assert/strict";
import { parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  HyperliquidVenue,
  l1TypedData,
  l1ActionHash,
  nativeProtection,
  type Perp,
} from "../../src/execution/hyperliquid-testnet";
import {
  makeHyperliquidDriver,
  type HyperliquidAuthority,
} from "../../src/execution/hyperliquid-driver";
import type {
  Action,
  WalletBudget,
  LiveProgram,
  CompiledMarket,
  Prepared,
} from "../../src/execution/live-program";
import type { PlanStage } from "../../contracts/src/workflow";

const owner = privateKeyToAccount(("0x" + "1".padStart(64, "0")) as Hex),
  agent = privateKeyToAccount(("0x" + "2".padStart(64, "0")) as Hex);
const asset: CompiledMarket = {
  id: "hl:perp:ETH",
  symbol: "ETH",
  address: null,
  venue: "hyperliquid",
  kind: "perp",
};
const b: WalletBudget = {
  wallet: owner.address,
  network: "hyperliquid-mainnet",
  settlementAsset: "USDC",
  decimals: 6,
  allocations: [{ asset: "USDC", units: "200000000" }],
  maxFeesPerOrder: [{ asset: "USDC", units: "1500000" }],
};
const a: Action = {
  programId: "real-1",
  strategyId: "s1",
  version: 1,
  owner: "alice",
  stage: "eth",
  sequence: 1,
  id: "e1",
  network: b.network,
  wallet: b.wallet,
  instrument: asset,
  leg: "entry",
  side: "long",
  leverage: 2,
  slippageBps: 50,
  spendAsset: "USDC",
  spendUnits: "50000000",
  reduceOnly: false,
  exitReason: null,
};
let at = 1793700000000,
  masterNonce = at - 20,
  agentNonce = at - 20,
  exchangeAgent = true,
  permit = true,
  active = true,
  taker = "0.00045",
  best = "1000",
  withdrawable = "200",
  ownedSize = "0",
  entryBasis = "1000",
  writeCount = 0,
  duplicate = false,
  stopAfterLeverage = false,
  loseOrderResponse = false;
let termData: any,
  orderStatus: "unknown" | "open" | "filled" | "canceled" = "unknown",
  fills: any[] = [],
  orderSide: "B" | "A" = "B",
  oid = 712,
  confirmedTarget = "",
  reconciliationLimit = "";
const venue = new HyperliquidVenue(
  "mainnet",
  async (url, init) => {
    const q = JSON.parse(String(init.body));
    assert(url.startsWith("https://api.hyperliquid.xyz/"));
    assert.equal(init.redirect, "error");
    if (q.type === "meta")
      return Response.json({
        collateralToken: 0,
        universe: [
          { name: "ETH", szDecimals: 4, maxLeverage: 50, onlyIsolated: false },
        ],
      });
    if (q.type === "userFees") return Response.json({ userCrossRate: taker });
    if (q.type === "l2Book")
      return Response.json({
        coin: "ETH",
        time: at,
        levels: [[{ px: best, sz: "1" }], [{ px: best, sz: "2" }]],
      });
    if (q.type === "clearinghouseState")
      return Response.json({
        withdrawable,
        marginSummary: { accountValue: "200", totalMarginUsed: "50" },
        assetPositions:
          ownedSize === "0"
            ? []
            : [
                {
                  position: {
                    coin: "ETH",
                    szi: ownedSize,
                    entryPx: entryBasis,
                    unrealizedPnl: "2",
                    marginUsed: "52",
                    leverage: { type: "isolated", value: 2 },
                  },
                },
              ],
      });
    if (q.type === "openOrders") return Response.json([]);
    if (q.type === "userRole")
      return Response.json(
        exchangeAgent
          ? { role: "agent", data: { user: owner.address } }
          : { role: "missing" },
      );
    if (q.type === "orderStatus")
      return Response.json(
        orderStatus === "unknown"
          ? { status: "unknownOid" }
          : {
              status: "order",
              order: {
                status: orderStatus,
                order: {
                  oid,
                  coin: "ETH",
                  side: orderSide,
                  cloid: termData.cloid,
                  timestamp: at - 100,
                  origSz: confirmedTarget,
                  limitPx: reconciliationLimit || termData.limit,
                  reduceOnly: termData.leg === "exit",
                  tif: "Ioc",
                  sz:
                    orderStatus === "filled"
                      ? "0"
                      : String(
                          +(
                            Number(confirmedTarget) -
                            fills.reduce((s, f) => s + Number(f.sz), 0)
                          ).toFixed(8),
                        ),
                },
              },
            },
      );
    if (q.type === "userFillsByTime")
      return Response.json(duplicate ? [...fills, ...fills] : fills);
    if (q.action) {
      writeCount++;
      if (q.action.type === "updateLeverage") {
        if (stopAfterLeverage) permit = false;
        return Response.json({ status: "ok", response: { type: "default" } });
      }
      if (q.action.type === "cancelByCloid")
        return Response.json({
          status: "ok",
          response: { type: "cancel", data: { statuses: ["success"] } },
        });
      if (loseOrderResponse)
        throw Error("simulated uncertain /exchange response");
      return Response.json({
        status: "ok",
        response: { type: "order", data: { statuses: [{ resting: { oid } }] } },
      });
    }
    throw Error("Unexpected fetch");
  },
  () => at,
);
const auth: HyperliquidAuthority = {
  active: async () => active,
  allow: () => permit,
  cancelAllowed: () => true,
  isCurrentAgent: (_uid, _wallet, w) => w === agent.address,
  reserveOwnerNonces: async (_u, _w, k) => {
    const first = Math.max(at, masterNonce + 1);
    masterNonce = first + k - 1;
    return first;
  },
  sign: async (_u, _w, order, expiresAt) => {
    const nonce = Math.max(at, agentNonce + 1);
    agentNonce = nonce;
    return {
      agent: agent.address,
      signed: await venue.sign(order, nonce, expiresAt, (d) =>
        agent.signTypedData(d),
      ),
    };
  },
};
const driver = makeHyperliquidDriver(venue, auth, {
  now: () => at,
  lossUsd6: async () => "175000",
});
const p = { id: "real-1", owner: "alice", orders: {} } as LiveProgram;
assert.equal(
  await driver.readiness(b, asset, { side: "long", leverage: 2 } as PlanStage),
  null,
);
assert.match(
  (await driver.readiness({ ...b, decimals: 18 }, asset, {
    side: "long",
    leverage: 2,
  } as PlanStage))!,
  /six-decimal/,
);
assert.equal((await driver.balance(b, p)).lossUsd6, "175000");
const t = await driver.prepare(a);
termData = t.payload;
confirmedTarget = termData.quantity;
assert.equal(t.targetUnits, parseUnits(termData.quantity, 18).toString());
assert.equal(termData.cloid.length, 34);
assert.equal(termData.ownerSignatures.length, 2);
assert.equal(termData.ownerSignatures[0].action.isCross, false);
const malicious = structuredClone(t) as Prepared;
const mp = malicious.payload as any;
mp.quantity = "1";
malicious.targetUnits = parseUnits("1", 18).toString();
await assert.rejects(
  driver.seal(a, malicious, { kind: "wallet", value: { reviewed: true } }),
);
assert.equal(writeCount, 0);
const ownedSigs = [];
for (const op of termData.ownerSignatures) {
  ownedSigs.push(
    await owner.signTypedData(
      l1TypedData(op.action, op.nonce, op.expiresAfter, "mainnet"),
    ),
  );
}
await assert.rejects(
  driver.seal(a, t, {
    kind: "wallet",
    value: { signatures: [ownedSigs[1], ownedSigs[0]] },
  }),
  /different account/,
);
active = false;
const ownerPacket = await driver.seal(a, t, {
  kind: "wallet",
  value: { signatures: ownedSigs },
});
assert.equal(writeCount, 0);
await assert.rejects(
  driver.seal(a, t, { kind: "wallet", value: { reviewed: true } }),
  /verified/,
);
active = true;
exchangeAgent = false;
await assert.rejects(
  driver.seal(a, t, { kind: "delegate" }),
  /active exchange agent/,
);
exchangeAgent = true;
const packet = await driver.seal(a, t, { kind: "delegate" });
assert.equal(packet.recoveryId, termData.cloid);
assert.equal(writeCount, 0);
taker = "0.005";
await assert.rejects(driver.broadcast(a, t, packet), /fee schedule/);
assert.equal(writeCount, 0);
taker = "0.00045";
best = "1015";
await assert.rejects(driver.broadcast(a, t, packet), /authorized quote/);
best = "1000";
stopAfterLeverage = true;
await assert.rejects(driver.broadcast(a, t, packet), /permission/);
assert.equal(writeCount, 1);
stopAfterLeverage = false;
permit = true;
loseOrderResponse = true;
await assert.rejects(driver.broadcast(a, t, ownerPacket), /reconcile/);
assert.equal(writeCount, 3);
loseOrderResponse = false;
const ev0 = await driver.reconcile(a, t, packet.recoveryId);
assert.equal(ev0.final, undefined);
assert.equal(ev0.fills.length, 0);
const fill = (
  size: string,
  px: string,
  tid: number,
  closedPnl = "0.0",
  fee = "0.001",
) => ({
  time: at,
  tid,
  oid,
  coin: "ETH",
  side: orderSide,
  sz: size,
  px,
  closedPnl,
  fee,
  feeToken: "USDC",
  startPosition:
    tid === 13 ? "0.04" : orderSide === "A" ? confirmedTarget : "0",
  dir: orderSide === "B" ? "Open Long" : "Close Long",
});
orderStatus = "open";
fills = [fill("0.04", "1000", 12)];
ownedSize = "0.04";
duplicate = true;
const partial = await driver.reconcile(a, t, termData.cloid);
assert.equal(partial.fills.length, 1);
assert.equal(partial.final, undefined);
assert.equal(partial.holding?.quantity, parseUnits("0.04", 18).toString());
assert.deepEqual(partial.fills[0].debits, [
  { asset: "USDC", units: "20001000" },
]);
ownedSize = confirmedTarget;
const secondSize = String(+(Number(confirmedTarget) - 0.04).toFixed(8));
fills.push(fill(secondSize, "1000", 13));
orderStatus = "filled";
entryBasis = "993.0";
const unproven = await driver.reconcile(a, t, termData.cloid);
assert.equal(unproven.holding, undefined);
assert.equal(unproven.final, undefined);
entryBasis = "1000";
fills[1].startPosition = "0.038";
const foreign = await driver.reconcile(a, t, termData.cloid);
assert.equal(foreign.final, undefined);
fills[1].startPosition = "0.04";
const full = await driver.reconcile(a, t, termData.cloid);
assert.equal(full.final?.outcome, "filled");
assert.equal(full.holding?.quantity, t.targetUnits);
reconciliationLimit = "5000";
await assert.rejects(driver.reconcile(a, t, termData.cloid), /terms differ/);
reconciliationLimit = "";
const initial = termData,
  origQty = confirmedTarget,
  initialFills = fills;
const repeat = {
  ...a,
  id: "e2",
  sequence: 2,
  priorHolding: { quantity: t.targetUnits, averageEntryUsd: 1000 },
};
best = "1010";
const repeated = await driver.prepare(repeat);
termData = repeated.payload;
confirmedTarget = termData.quantity;
assert.equal(termData.ownerSignatures.length, 1);
assert.equal(termData.ownerSignatures[0].op, "order");
entryBasis = "910";
await assert.rejects(
  driver.seal(repeat, repeated, { kind: "delegate" }),
  /receipt-confirmed lot/,
);
entryBasis = "1000";
oid = 714;
fills = [{ ...fill(confirmedTarget, best, 37), startPosition: origQty }];
ownedSize = String(+(Number(origQty) + Number(confirmedTarget)).toFixed(8));
entryBasis = (
  (Number(origQty) * 1000 + Number(confirmedTarget) * 1010) /
  Number(ownedSize)
).toFixed(8);
const increased = await driver.reconcile(repeat, repeated, termData.cloid);
assert.equal(increased.final?.outcome, "filled");
assert.equal(increased.holding?.averageEntryUsd, 1010);
assert.equal(increased.holding?.quantity, repeated.targetUnits);
entryBasis = "1000";
ownedSize = origQty;
termData = initial;
confirmedTarget = origQty;
oid = 712;
fills = initialFills;
const trim = {
  ...a,
  id: "exit-slice",
  leg: "exit" as const,
  side: "short" as const,
  spendAsset: asset.id,
  spendUnits: parseUnits("0.04", 18).toString(),
  reduceOnly: true,
  priorHolding: { quantity: t.targetUnits, averageEntryUsd: 1000 },
  entryAverageUsd: 1000,
};
const slice = await driver.prepare(trim);
assert.equal(slice.targetUnits, parseUnits("0.04", 18).toString());
assert.equal(
  (slice.payload as any).ownerSignatures[0].action.orders[0].r,
  true,
);
const close: Action = {
  ...a,
  id: "x1",
  leg: "exit",
  side: "short",
  spendAsset: asset.id,
  spendUnits: t.targetUnits,
  reduceOnly: true,
  exitReason: "Stop loss",
};
best = "1050";
const exit = await driver.prepare(close);
termData = exit.payload;
confirmedTarget = termData.quantity;
orderSide = "A";
oid = 713;
assert.equal(termData.ownerSignatures.length, 1);
assert.equal(termData.ownerSignatures[0].action.orders[0].r, true);
const exitPacket = await driver.seal(close, exit, {
  kind: "wallet",
  value: { reviewed: true },
});
await driver.broadcast(close, exit, exitPacket);
assert.equal(writeCount, 4);
orderStatus = "canceled";
fills = [fill("0.04", "1050", 22, "2.0", "0.010000")];
ownedSize = String(+(Number(confirmedTarget) - 0.04).toFixed(8));
const partExit = await driver.reconcile(close, exit, termData.cloid);
assert.equal(partExit.final?.outcome, "cancelled");
assert.equal(partExit.final?.cumulativeQty, parseUnits("0.04", 18).toString());
assert.deepEqual(partExit.fills[0].debits, [
  { asset: asset.id, units: parseUnits("0.04", 18).toString() },
  { asset: "USDC", units: "10000" },
]);
assert.deepEqual(partExit.fills[0].credits, [
  { asset: "USDC", units: "22000000" },
]);
assert.equal((partExit as any).perpetual.realizedClosedPnl, "2");
assert.equal((partExit as any).perpetual.executedNotional, "42");
assert.equal(await driver.cancel!(close, exit, termData.cloid), "requested");
active = false;
assert.equal(await driver.cancel!(close, exit, termData.cloid), "unavailable");

const m: Perp = {
  symbol: "ETH",
  asset: 1,
  szDecimals: 4,
  maxLeverage: 50,
  onlyIsolated: false,
};
const protection = nativeProtection(
  m,
  "long",
  "0.28",
  "0.24",
  "987.651",
  30,
  "sl",
  "0x" + "e".repeat(32),
);
assert.equal(protection.type, "order");
if (protection.type === "order") {
  const o = protection.orders[0];
  assert.equal(o.r, true);
  assert.equal(o.b, false);
  assert.equal(o.s, "0.24");
  assert.deepEqual(o.t, {
    trigger: { isMarket: false, triggerPx: "987.66", tpsl: "sl" },
  });
}
const shortTP = nativeProtection(
  m,
  "short",
  "-0.24",
  "0.24",
  "987.659",
  30,
  "tp",
  "0x" + "a".repeat(32),
);
if (shortTP.type === "order") {
  assert.equal(shortTP.orders[0].b, true);
  assert.deepEqual(shortTP.orders[0].t, {
    trigger: { isMarket: false, triggerPx: "987.65", tpsl: "tp" },
  });
}
assert.notEqual(l1ActionHash(protection, at), l1ActionHash(shortTP, at));
console.log(
  "PASS native mainnet DEX readiness and proven balances, owner signature pinning, delegate ownership, zero broadcasts in seal, fee/price/grant changes, lost replies, partial/full entry and close evidence, capped native reduce-only TP/SL and cancellation",
);

// A trigger acknowledgement is never a fill. The submitted trigger must survive backend JSONB key ordering.
let triggerSent = 0;
const tVenue = new HyperliquidVenue(
  "mainnet",
  async (url, init) => {
    assert.equal(url, "https://api.hyperliquid.xyz/exchange");
    const q = JSON.parse(String(init.body));
    triggerSent++;
    assert.equal(q.action.orders[0].r, true);
    assert.deepEqual(Object.keys(q.action.orders[0].t.trigger), [
      "isMarket",
      "triggerPx",
      "tpsl",
    ]);
    return Response.json({
      status: "ok",
      response: { type: "order", data: { statuses: ["waitingForTrigger"] } },
    });
  },
  () => at,
);
if (protection.type === "order" && "trigger" in protection.orders[0].t) {
  const mainOrder = protection.orders[0],
    tr = mainOrder.t as {
      trigger: { tpsl: "tp" | "sl"; triggerPx: string; isMarket: false };
    };
  const reordered = {
    ...protection,
    orders: [
      {
        ...mainOrder,
        t: {
          trigger: {
            tpsl: tr.trigger.tpsl,
            triggerPx: tr.trigger.triggerPx,
            isMarket: false as const,
          },
        },
      },
    ],
  };
  assert.equal(l1ActionHash(reordered, at), l1ActionHash(protection, at));
  const sealed = await tVenue.sign(reordered, at, at + 9000, (data) =>
    agent.signTypedData(data),
  );
  assert.equal(triggerSent, 0);
  assert.equal(
    (await tVenue.submit(sealed, agent.address)).kind,
    "awaiting_trigger",
  );
  assert.equal(triggerSent, 1);
}
console.log(
  "PASS native protective trigger canonicalization and awaiting-trigger acknowledgement separated from fills",
);
