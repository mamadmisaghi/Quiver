import assert from "node:assert/strict";
import { hashTypedData, parseSignature, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  HyperliquidVenue,
  HyperliquidTestnet,
  l1TypedData,
  approvalData,
  approvalDigest,
  revocationReplacement,
  perpOrder,
  reduceOnlyClose,
  type Grant,
  type Perp,
} from "../../src/execution/hyperliquid-testnet";

// Public SDK golden-vector scalars. Injected transports never make a network request.
const signer = privateKeyToAccount(
  ("0x" + "0123456789".repeat(7).slice(0, 64)) as Hex,
);
const owner = privateKeyToAccount(("0x" + "1".padStart(64, "0")) as Hex);
const eth: Perp = {
  symbol: "ETH",
  asset: 1,
  szDecimals: 4,
  maxLeverage: 50,
  onlyIsolated: false,
};
const cloid = "0x00000000000000000000000000000001",
  at = 1777777700000;
const order = perpOrder(eth, true, "100", "100", false, cloid, "Gtc");
const mainData = l1TypedData(order, 0, undefined, "mainnet"),
  vec = parseSignature(await signer.signTypedData(mainData));
assert.equal(mainData.message.source, "a");
assert.equal(mainData.domain.chainId, 1337);
assert.equal(
  BigInt(vec.r),
  0x41ae18e8239a56cacbc5dad94d45d0b747e5da11ad564077fcac71277a946e3n,
);
assert.equal(
  vec.s,
  "0x3c61f667e747404fe7eea8f90ab0e76cc12ce60270438b2058324681a00116da",
);
assert.equal(vec.v, 27n);
assert.notEqual(
  hashTypedData(mainData),
  hashTypedData(l1TypedData(order, 0, undefined, "testnet")),
);
console.log(
  "PASS official Python-SDK mainnet wire-order signature golden vector; environment-separated phantom digests",
);

let writes = 0;
let active = true;
let revoking = false;
const seen: string[] = [];
let receiptRole: "missing" | "unknown" = "missing";
const grant: Grant = {
  agent: signer.address,
  name: "QuiverLiveR9",
  nonce: at - 5000,
  validUntil: at + 86400000,
};
const replacement = revocationReplacement(grant, owner.address, at, "mainnet");
const main = new HyperliquidVenue(
  "mainnet",
  async (url, init) => {
    const b = JSON.parse(String(init.body));
    seen.push(url);
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "POST");
    assert.equal(
      url,
      "https://api.hyperliquid.xyz/" + (b.action ? "exchange" : "info"),
    );
    if (b.action) {
      writes++;
      if (b.action.type === "approveAgent") {
        const spec = revoking ? replacement : grant;
        assert.deepEqual(b.action, approvalData(spec, "mainnet").action);
        if (revoking) active = false;
        return Response.json({ status: "ok", response: { type: "default" } });
      }
      assert.equal(b.action.orders[0].r, true);
      return Response.json({
        status: "ok",
        response: {
          type: "order",
          data: { statuses: [{ resting: { oid: 901 } }] },
        },
      });
    }
    if (b.type === "userRole")
      return Response.json(
        active
          ? { role: "agent", data: { user: owner.address } }
          : { role: receiptRole },
      );
    if (b.type === "extraAgents")
      return Response.json(
        active
          ? [
              {
                name: grant.name,
                address: grant.agent,
                validUntil: grant.validUntil,
              },
            ]
          : [
              {
                name: grant.name,
                address: replacement.agent,
                validUntil: replacement.validUntil,
              },
            ],
      );
    if (b.type === "clearinghouseState")
      return Response.json({
        withdrawable: "129.4",
        marginSummary: { accountValue: "150" },
        assetPositions: [{ position: { coin: "ETH", szi: "-0.084" } }],
      });
    if (b.type === "openOrders") return Response.json([]);
    if (b.type === "meta")
      return Response.json({
        collateralToken: 12,
        universe: [{ name: "ABC", szDecimals: 2, maxLeverage: 5 }],
      });
    throw Error("unexpected request");
  },
  () => at,
);
const testnet = new HyperliquidTestnet(
  async () => {
    throw Error("unexpected testnet exchange call");
  },
  () => at,
);
const payload = main.walletApprovalPayload(grant);
assert.equal(payload.message.hyperliquidChain, "Mainnet");
assert.equal(payload.message.nonce, String(grant.nonce));
assert.equal(payload.domain.chainId, 42161);
assert.equal(approvalData(grant, "mainnet").action.signatureChainId, "0xa4b1");
const mainSig = await owner.sign({ hash: approvalDigest(grant, "mainnet") });
const testSig = await owner.sign({ hash: approvalDigest(grant, "testnet") });
await assert.rejects(main.approve(grant, testSig, owner.address), /signature/);
await assert.rejects(
  testnet.approve(grant, mainSig, owner.address),
  /signature/,
);
assert.equal(writes, 0);
await main.approve(grant, mainSig, owner.address);
assert.equal(writes, 1);
assert.equal(await main.activeGrant(grant, owner.address), true);
await assert.rejects(main.market("ABC"), /collateral/);
const account = await main.account(owner.address, "ETH");
assert.equal(account.signedPositionSize, "-0.084");
const close = reduceOnlyClose(
  eth,
  "short",
  account.signedPositionSize!,
  "0.10",
  "2000",
  50,
  cloid,
);
assert.equal(close.side, "B");
assert.equal(close.quantity, "0.084");
assert.equal(close.action.type, "order");
assert.throws(() =>
  reduceOnlyClose(eth, "long", "-0.084", "0.10", "2000", 50, cloid),
);
assert.throws(() =>
  reduceOnlyClose(eth, "short", "0", "0.10", "2000", 50, cloid),
);
assert.equal(
  reduceOnlyClose(eth, "long", "0.2", "0.035", "2000", 50, cloid).quantity,
  "0.035",
);
const signedMain = await main.sign(close.action, at, at + 12000, (d) =>
  signer.signTypedData(d),
);
const signedTest = await testnet.sign(close.action, at, at + 12000, (d) =>
  signer.signTypedData(d),
);
await assert.rejects(main.submit(signedTest, signer.address), /network/);
await assert.rejects(
  main.submit({ ...signedTest, network: undefined }, signer.address),
  /network/,
);
await assert.rejects(
  main.submit({ ...signedTest, network: "mainnet" }, signer.address),
  /signature/,
);
await assert.rejects(testnet.submit(signedMain, signer.address), /network/);
assert.equal(writes, 1);
assert.equal((await main.submit(signedMain, signer.address)).kind, "accepted");
const revocation = main.walletRevocationPayload(grant, owner.address, at);
assert.equal(revocation.message.agentAddress, replacement.agent);
assert.equal(
  revocation.message.agentName,
  grant.name + " valid_until " + (at + 60000),
);
assert.notEqual(replacement.agent, grant.agent);
assert.notEqual(
  replacement.agent,
  revocationReplacement(grant, owner.address, at, "testnet").agent,
);
await assert.rejects(
  main.revoke(grant, owner.address, at, mainSig),
  /signature/,
);
assert.equal(writes, 2);
const revokeSig = await owner.sign({
  hash: approvalDigest(replacement, "mainnet"),
});
revoking = true;
assert.deepEqual(await main.revoke(grant, owner.address, at, revokeSig), {
  status: "revoked",
});
assert.equal(writes, 3);
assert.deepEqual(await main.revoke(grant, owner.address, at, revokeSig), {
  status: "revoked",
});
assert.equal(writes, 3);
receiptRole = "unknown";
await assert.rejects(main.revocationConfirmed(grant, owner.address));
assert(seen.every((s) => s.startsWith("https://api.hyperliquid.xyz/")));
console.log(
  "PASS wallet grants, cross-network signature rejection, exact signed exposure, bounded reduce-only IOC, master revocation, strict remote reconciliation, USDC collateral validation",
);
