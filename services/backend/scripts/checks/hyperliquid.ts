import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData, parseSignature, type Hex } from "viem";
import {
  HyperliquidTestnet,
  VenueFailure,
  approvalDigest,
  approvalData,
  walletApprovalPayload,
  cancelByCloid,
  iocLimit,
  l1ActionHash,
  l1TypedData,
  perpOrder,
  signTestnet,
  sizeFromNotional,
  updateLeverage,
  type L1Action,
  type Perp,
} from "../../src/execution/hyperliquid-testnet";

// This publicly published SDK fixture repeats the digits 0..9. It is never funded or submitted.
const fixtureSigner = privateKeyToAccount(("0x" + "0123456789".repeat(7).slice(0, 64)) as Hex);
const secondSigner = privateKeyToAccount(("0x" + "1".padStart(64, "0")) as Hex);
const cloid = "0x00000000000000000000000000000001",
  ts = 1_777_777_700_000;
const eth: Perp = { symbol: "ETH", asset: 1, szDecimals: 4, maxLeverage: 50, onlyIsolated: false };
const known: L1Action = {
  type: "order",
  orders: [{ a: 4, b: true, p: "1670.1", s: "0.0147", r: false, t: { limit: { tif: "Ioc" } } }],
  grouping: "na",
};
assert.equal(
  l1ActionHash(known, 1677777606040),
  "0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908",
);
const vector = perpOrder(eth, true, "100", "100", false, cloid, "Gtc");
const signature = parseSignature(await fixtureSigner.signTypedData(l1TypedData(vector, 0)));
assert.equal(signature.r, "0xeba0664bed2676fc4e5a743bf89e5c7501aa6d870bdb9446e122c9466c5cd16d");
assert.equal(signature.s, "0x7f3e74825c9114bc59086f1eebea2928c190fdfbfde144827cb02b85bbe90988");
assert.equal(signature.v, 28n);
console.log("PASS two official Python SDK wire/signature golden vectors");
assert.throws(() =>
  l1ActionHash({ ...vector, builder: { b: fixtureSigner.address, f: 10 } } as unknown as L1Action, ts),
);
assert.notEqual(l1ActionHash(vector, ts), l1ActionHash(vector, ts, ts + 3000));
const differentlyOrdered = {
  grouping: "na",
  orders: [{ t: { limit: { tif: "Gtc" } }, s: "100", r: false, p: "100", c: cloid, b: true, a: 1 }],
  type: "order",
} as L1Action;
assert.equal(l1ActionHash(differentlyOrdered, ts, ts + 3000), l1ActionHash(vector, ts, ts + 3000));
assert.equal(iocLimit("1234.56", true, 50, 2), "1240.7");
assert.equal(iocLimit("1234.56", false, 50, 2), "1228.4");
assert.equal(iocLimit("123456", true, 0, 2), "123456");
assert.throws(() => perpOrder(eth, true, "1234.56", "0.0047", false, cloid));
assert.throws(() => perpOrder(eth, true, "100", "1.00001", false, cloid));
assert.equal(sizeFromNotional("500", "3000", 4), "0.1666");
assert.throws(() => updateLeverage(eth, 51));
assert.throws(() => updateLeverage({ ...eth, onlyIsolated: true }, 2, true));
console.log("PASS precise IOC bounds, size lot, leverage and JSONB order recovery");

let clock = ts,
  acceptedPosts = 0;
type Body = Record<string, unknown>;
let responder: (url: string, body: Body) => unknown = () => {
  throw Error("Unexpected request");
};
const client = new HyperliquidTestnet(
  async (url, init) => {
    assert(
      url === "https://api.hyperliquid-testnet.xyz/info" ||
        url === "https://api.hyperliquid-testnet.xyz/exchange",
    );
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    if (url.endsWith("/exchange")) acceptedPosts++;
    return Response.json(responder(url, JSON.parse(String(init.body))));
  },
  () => clock,
);
const grant = { agent: secondSigner.address, name: "quiver-unit", nonce: ts, validUntil: ts + 86400000 };
const { typedData, action } = approvalData(grant);
const ownerSig = await fixtureSigner.sign({ hash: approvalDigest(grant) });
assert.equal(typedData.domain.name, "HyperliquidSignTransaction");
assert.equal(typedData.message.hyperliquidChain, "Testnet");
assert.equal(action.agentName, "quiver-unit valid_until " + grant.validUntil);
const browserPayload = JSON.parse(JSON.stringify(walletApprovalPayload(grant)));
assert.equal(browserPayload.message.nonce, String(ts));
assert.equal(browserPayload.primaryType, typedData.primaryType);
assert.equal(approvalDigest(grant), "0x0f7c33be9160feea8e74ec6b0b4995cde8f0de3d8c341b8a6e7b968fa98faf19");
await assert.rejects(
  client.approve({ ...grant, name: "quiver-alt" }, ownerSig, fixtureSigner.address),
  /does not match/,
);
await assert.rejects(client.approve(grant, ownerSig, secondSigner.address), /owner challenge/);
responder = (_, body) => {
  assert.deepEqual(body.action, action);
  assert.equal(body.nonce, ts);
  return { status: "ok", response: { type: "default" } };
};
await client.approve(grant, ownerSig, fixtureSigner.address);
assert.equal(acceptedPosts, 1);
responder = (_, b) =>
  b.type === "userRole"
    ? { role: "agent", data: { user: fixtureSigner.address } }
    : [{ address: grant.agent, name: grant.name, validUntil: grant.validUntil }];
assert(await client.activeGrant(grant, fixtureSigner.address));
responder = (_, b) =>
  b.type === "userRole"
    ? { role: "agent", data: { user: fixtureSigner.address } }
    : [{ address: grant.agent, name: grant.name, validUntil: null }];
assert.equal(await client.activeGrant(grant, fixtureSigner.address), false);
responder = (_, b) =>
  b.type === "perpDexs"
    ? [null, { name: "oil" }]
    : { universe: [{ name: "oil:GOLD", szDecimals: 2, maxLeverage: 17 }] };
const hip3 = await client.market("oil:GOLD");
assert.equal(hip3.asset, 110000);
assert.equal(hip3.maxLeverage, 17);
responder = (_, b) => ({
  coin: "ETH",
  time: ts,
  levels: [[{ px: "100", sz: "1" }], [{ px: "101", sz: "2" }]],
});
assert.equal(await client.bestPrice("ETH", true), "101");
clock += 6000;
await assert.rejects(client.bestPrice("ETH", true), /recent/);
clock = ts;

const signed = await signTestnet(vector, ts, ts + 10000, (d) => fixtureSigner.signTypedData(d));
assert.notEqual(hashTypedData(l1TypedData(vector, ts, ts + 10000)), approvalDigest(grant));
responder = (_, b) => {
  assert.deepEqual(b.action, vector);
  return {
    status: "ok",
    response: { type: "order", data: { statuses: [{ filled: { oid: 9, totalSz: "23", avgPx: "99" } }] } },
  };
};
assert.deepEqual(await client.submit(signed, fixtureSigner.address), {
  kind: "matched",
  oid: 9,
  totalSz: "23",
  avgPx: "99",
});
const before = acceptedPosts;
await assert.rejects(client.submit({ ...signed, nonce: ts + 1 }, fixtureSigner.address), /signature/);
await assert.rejects(client.submit(signed, secondSigner.address), /signature/);
clock = ts + 10001;
await assert.rejects(client.submit(signed, fixtureSigner.address), /Expired/);
clock = ts;
assert.equal(acceptedPosts, before);
responder = () => ({
  status: "ok",
  response: { type: "order", data: { statuses: [{ error: "Rejected by venue" }] } },
});
await assert.rejects(
  client.submit(signed, fixtureSigner.address),
  (e) => e instanceof VenueFailure && e.outcome === "venue_error",
);
responder = () => ({ status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } });
const cancel = await signTestnet(cancelByCloid(eth, cloid), ts + 1, ts + 10000, (d) =>
  fixtureSigner.signTypedData(d),
);
assert.equal((await client.submit(cancel, fixtureSigner.address)).kind, "acknowledged");
responder = () => ({ status: "ok", response: { type: "default" } });
const lev = await signTestnet(updateLeverage(eth, 3), ts + 2, ts + 10000, (d) =>
  fixtureSigner.signTypedData(d),
);
assert.equal((await client.submit(lev, fixtureSigner.address)).kind, "acknowledged");
console.log(
  "PASS fixed testnet transport and verified owner, TTL, meta, scoped L1 signers, IOC partial acknowledgement",
);

const order = { coin: "ETH", side: "B", oid: 42, cloid, timestamp: ts, origSz: "0.3", sz: "0.2" };
const one = {
  coin: "ETH",
  side: "B",
  oid: 42,
  time: ts + 50,
  tid: 13,
  sz: "0.1",
  px: "1000",
  fee: "0.00123",
  feeToken: "USDC",
};
const two = { ...one, time: ts + 65, tid: 14, sz: "0.2", px: "1003", fee: "0.00246" };
const reconcile = () => client.reconcile(fixtureSigner.address, cloid, "ETH", "B", "0.3");
const setReceipts = (venueStatus: string, remaining: string, entries: unknown[]) => {
  responder = (url, b) => {
    assert(url.endsWith("/info"));
    assert.equal(b.user, fixtureSigner.address.toLowerCase());
    if (b.type === "orderStatus") {
      assert.equal(b.oid, cloid);
      return { status: "order", order: { order: { ...order, sz: remaining }, status: venueStatus } };
    }
    assert.equal(b.type, "userFillsByTime");
    assert.equal(b.startTime, ts);
    assert.equal(b.aggregateByTime, false);
    return entries;
  };
};
responder = (_, b) => {
  assert.equal(b.type, "orderStatus");
  return { status: "unknownOid" };
};
assert.deepEqual(await reconcile(), { status: "unconfirmed", complete: false });
setReceipts("open", "0.2", [one]);
assert.equal((await reconcile()).status, "partial");
setReceipts("canceled", "0.2", [one]);
let result = await reconcile();
assert.equal(result.status, "partial_canceled");
assert.equal(result.complete, false);
setReceipts("filled", "0", [one]);
result = await reconcile();
assert.equal(result.status, "reconciling");
assert.equal(result.complete, false);
setReceipts("filled", "0", [one, two, { ...one }, { ...one, oid: 100 }]);
result = await reconcile();
assert(result.complete && "filledSize" in result);
assert.equal(result.filledSize, "0.3");
assert.equal(result.averagePrice, "1002");
assert.equal(result.remainingSize, "0");
assert.equal(result.fees.USDC, "0.00369");
setReceipts("filled", "0", [one, { ...one, sz: "0.11" }]);
await assert.rejects(reconcile(), /Conflicting/);
setReceipts("filled", "0", [one, two, { ...one, tid: 15 }]);
await assert.rejects(reconcile(), /exceed/);
console.log(
  "PASS full-only settlement, partial IOC cancellation, ambiguous lookup, precise fees, restart duplicates and conflicting receipts",
);
