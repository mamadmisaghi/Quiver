import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkStockAllowance,
  checkStockHandoff,
} from "../lib/live-order-review";
import type { Allowance, HandOff, LiveOrder } from "../lib/live-client";
import type { RobinhoodTx } from "../lib/wallet/live-evm";

const router = "0xcaf681a66d020601342297493863e78c959e5cb2",
  stock = "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
  usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  weth = "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  wallet = "0x" + "33".repeat(20);
const digest = "c".repeat(64),
  expiresAt = Date.now() + 220000;
const samples = {
  buy: "0x5ae401dc00000000000000000000000000000000000000000000000000000000423a35c70000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000104b858183f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000001851960000000000000000000000000000000000000000000000000000000000001e240000000000000000000000000000000000000000000000000000000000000002b5fc5360d0400a0fd4f2af552add042d716f1d168000bb8af3d76f1834a1d425780943c99ea8a608f8a93f900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  sell: "0x5ae401dc00000000000000000000000000000000000000000000000000000000423a35c70000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000124b858183f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000001851960000000000000000000000000000000000000000000000000000000000001e2400000000000000000000000000000000000000000000000000000000000000042af3d76f1834a1d425780943c99ea8a608f8a93f90001f40bd7d308f8e1639fab988df18a8011f41eacad73000bb85fc5360d0400a0fd4f2af552add042d716f1d16800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  approve:
    "0x095ea7b3000000000000000000000000caf681a66d020601342297493863e78c959e5cb20000000000000000000000000000000000000000000000000000000001851960",
  zero: "0x095ea7b3000000000000000000000000caf681a66d020601342297493863e78c959e5cb20000000000000000000000000000000000000000000000000000000000000000",
};
const word = (n: bigint) => n.toString(16).padStart(64, "0");
const tx = (data: string, to: string) =>
  ({
    chainId: "0x1237",
    from: wallet,
    to,
    value: "0x0",
    data,
    gas: "0x100",
    gasPrice: "0x2",
    nonce: "0x3",
  }) as RobinhoodTx;
function example(side: "buy" | "sell") {
  const order = {
    id: "order",
    network: "robinhood-mainnet",
    wallet,
    leg: "entry",
    side,
    market: { id: "rk", symbol: "AAPL", address: stock },
    spendUnits: "25500000",
    expiresAt,
    digest,
    quote: {
      inputToken: side === "buy" ? usdg : stock,
      outputToken: side === "buy" ? stock : usdg,
      inputUnits: "25500000",
      minimumOutputUnits: "123456",
      maxFeeWei: "512",
      expiresAt,
    },
  } as LiveOrder;
  const hand: HandOff = {
    orderId: order.id,
    network: "robinhood-mainnet",
    wallet,
    expiresAt,
    digest,
    recoveryId: "rh:4663:" + wallet + ":3",
    packet: tx(
      samples[side].replace(
        word(1111111111n),
        word(BigInt(Math.floor(expiresAt / 1000))),
      ),
      router,
    ),
  };
  return { order, hand };
}
test("official codec single-hop stock buy, two-hop sale and exact approve/zero approve", () => {
  for (const side of ["buy", "sell"] as const) {
    const { order, hand } = example(side);
    assert.equal(checkStockHandoff(order, "live", "live", hand), order.quote);
  }
  for (const [kind, amount, data] of [
    ["approve", "25500000", samples.approve],
    ["approve_zero", "0", samples.zero],
  ] as const) {
    checkStockAllowance(
      { wallet, asset: usdg, amount, fee: "512", kind } as Allowance,
      tx(data, usdg),
    );
  }
});
test("rejects altered spender, excess or malformed allowance, wrong token, fee, chain, calldata", () => {
  const a = {
    wallet,
    asset: usdg,
    amount: "25500000",
    fee: "512",
    kind: "approve",
  } as Allowance;
  for (const t of [
    tx(samples.approve.replace(router.slice(2), stock.slice(2)), usdg),
    tx(samples.zero, usdg),
    tx(samples.approve, stock),
    tx(samples.approve + "00", usdg),
    { ...tx(samples.approve, usdg), gas: "0x101" as const },
    { ...tx(samples.approve, usdg), chainId: "0x1" as const },
  ]) {
    assert.throws(() => checkStockAllowance(a, t));
  }
});
test("rejects changes to account, destination, calldata, exact amount, recipient, floor, deadline and pool", () => {
  const { order, hand } = example("sell"),
    base = hand.packet.data;
  const tamper = (from: string, to: string) => {
    assert(base.includes(from));
    return { ...hand, packet: tx(base.replace(from, to), router) };
  };
  for (const h of [
    { ...hand, digest: "d".repeat(64) },
    { ...hand, wallet: stock },
    { ...hand, recoveryId: "rh:4663:" + wallet + ":4" },
    { ...hand, packet: { ...hand.packet, nonce: "0x4" as const } },
    { ...hand, packet: { ...hand.packet, from: stock } },
    { ...hand, packet: { ...hand.packet, to: stock } },
    tamper("b858183f", "095ea7b3"),
    tamper(wallet.slice(2), router.slice(2)),
    tamper(word(123456n), word(1n)),
    tamper(word(25500000n), word(25500001n)),
    tamper(word(BigInt(Math.floor(expiresAt / 1000))), word(4294967295n)),
    tamper(weth.slice(2), stock.slice(2)),
    tamper("0001f4", "ffffff"),
    { ...hand, packet: tx(base + "00", router) },
  ]) {
    assert.throws(() => checkStockHandoff(order, "live", "live", h));
  }
  assert.throws(() =>
    checkStockHandoff({ ...order, quote: null }, "live", "live", hand),
  );
});
