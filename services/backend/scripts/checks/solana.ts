import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { decodeWire, encode58, read58, ownershipMessage, verifyLink } from "../../src/execution/solana-wire";
import {
  pinOrder,
  bindSignature,
  orderUrl,
  prepareExecution,
  settle,
  WRAPPED_SOL,
  type SwapIntent,
  type JupiterOrder,
  type Balances,
} from "../../src/execution/solana-jupiter";

// RFC 8032 §7.1, test vector 1. Publicly documented test material signs fixtures with an unusable
// all-zero blockhash and invented program IDs. No key is generated, no network request can be made.
const testKey = createPrivateKey({
  format: "der",
  type: "pkcs8",
  key: Buffer.from(
    "302e020100300506032b657004220420" + "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    "hex",
  ),
});
const pub = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");
const taker = encode58(pub),
  input = encode58(Buffer.alloc(32, 22)),
  output = encode58(Buffer.alloc(32, 23)),
  nonce = "fixture-nonce-000000000001";
const T = 1_800_000_000_000;
const c = {
  address: taker,
  origin: "https://quiver.test",
  ownerId: "usr_test",
  nonce,
  issuedAt: T,
  expiresAt: T + 60_000,
};
const proof = encode58(sign(null, Buffer.from(ownershipMessage(c)), testKey));
assert(verifyLink(c, c, proof, T));
assert(!verifyLink(c, { ...c, ownerId: "other" }, proof, T));
assert(!verifyLink(c, { ...c, origin: "https://other.test" }, proof, T));
assert(!verifyLink(c, { ...c, nonce: nonce + "x" }, proof, T));
assert(!verifyLink(c, c, proof, T + 60000));
assert(!verifyLink({ ...c, expiresAt: T + 1000 }, c, proof, T));
assert.throws(() => ownershipMessage({ ...c, origin: "https://quiver.test/anything" }));
const consumed = new Set<string>();
function consume() {
  if (consumed.has(c.nonce)) return false;
  if (!verifyLink(c, c, proof, T)) return false;
  consumed.add(c.nonce);
  return true;
}
assert(consume());
assert(!consume());
assert.equal(read58(encode58(Buffer.alloc(32)), 32).length, 32);
assert.throws(() => read58("1" + taker, 32));

const b = (...x: number[]) => Buffer.from(x);
function wireMessage(v: 0 | "legacy", signers = 1, extraLookup = false) {
  const keys = [
    pub,
    ...(signers === 2 ? [Buffer.alloc(32, 7)] : []),
    Buffer.alloc(32, 2),
    Buffer.alloc(32, 3),
    Buffer.alloc(32, 4),
  ];
  return Buffer.concat([
    v === 0 ? b(128) : b(),
    b(signers, 0, 1, keys.length),
    ...keys,
    Buffer.alloc(32),
    b(1, keys.length - 1, 3, 0, 1, extraLookup ? keys.length : 2, 2, 0x99, 0x88),
    v === 0 ? (extraLookup ? Buffer.concat([b(1), Buffer.alloc(32, 29), b(1, 5, 0)]) : b(0)) : b(),
  ]);
}
function pack(m: Buffer, signed = false, count = 1) {
  return Buffer.concat([
    b(count),
    signed ? sign(null, m, testKey) : Buffer.alloc(64),
    ...Array.from({ length: count - 1 }, () => Buffer.alloc(64)),
    m,
  ]).toString("base64");
}
for (const v of [0, "legacy"] as const) {
  const tx = decodeWire(pack(wireMessage(v)));
  assert.equal(tx.version, v);
  assert.deepEqual(tx.signerKeys, [taker]);
}
assert.equal(decodeWire(pack(wireMessage(0, 2), false, 2)).signerKeys.length, 2);
assert.equal(decodeWire(pack(wireMessage(0, 1, true))).totalKeys, 5);
assert.throws(() =>
  decodeWire(
    Buffer.from([0x81, 0, ...Buffer.from(pack(wireMessage(0)), "base64").subarray(1)]).toString("base64"),
  ),
);
assert.throws(() => decodeWire(Buffer.from([1, ...Buffer.alloc(64), 129, 0]).toString("base64")));
assert.throws(() =>
  decodeWire(Buffer.concat([Buffer.from(pack(wireMessage(0)), "base64"), b(0)]).toString("base64")),
);
assert.throws(() => decodeWire("AAAA%%"));
const msg = wireMessage(0),
  unsigned = pack(msg),
  signed = pack(msg, true);
const intent: SwapIntent = {
  ownerId: c.ownerId,
  intentId: "fixture/1",
  taker,
  inputMint: input,
  outputMint: output,
  inputAmount: "100",
  minOutput: "84",
  maxSlippageBps: 100,
  maxImpactBps: 60,
  maxSwapFeeBps: 20,
  maxNetworkAndRentLamports: "3000000",
  expiresAt: T + 45_000,
};
const q: JupiterOrder = {
  requestId: "fixture-request",
  transaction: unsigned,
  transactionVersion: 0,
  inputMint: input,
  outputMint: output,
  inAmount: "100",
  outAmount: "86",
  otherAmountThreshold: "85",
  swapMode: "ExactIn",
  slippageBps: 100,
  feeBps: 5,
  priceImpact: -0.1,
  signatureFeePayer: taker,
  gasless: false,
  signatureFeeLamports: 5000,
  prioritizationFeeLamports: 0,
  rentFeeLamports: 0,
  taker,
  lastValidBlockHeight: "10005",
  router: "metis",
};
const pinned = pinOrder(intent, q, T, "10000"),
  signature = bindSignature(pinned, signed).txid;
assert.equal(new URL(orderUrl(intent)).searchParams.get("amount"), "100");
assert.equal(pinned.expiresAt, T + 30_000);
for (const patch of [
  { inAmount: "101" },
  { otherAmountThreshold: "83" },
  { inputMint: output },
  { taker: input },
  { slippageBps: 120 },
  { lastValidBlockHeight: "9999" },
  { requestId: "" },
  { transaction: "" },
  { priceImpact: -1 },
  { gasless: true },
  { signatureFeePayer: output },
  { router: "jupiterz" },
])
  assert.throws(() => pinOrder(intent, { ...q, ...patch }, T, "10000"));
assert.throws(() => bindSignature(pinned, unsigned));
const mutated = Buffer.from(msg);
mutated[mutated.length - 2] = 0x55;
assert.throws(() => bindSignature(pinned, pack(mutated, true)), /differs/);
const forged = Buffer.from(signed, "base64");
forged[5] ^= 1;
assert.throws(() => bindSignature(pinned, forged.toString("base64")), /signature/);

const tb = (accountIndex: number, mint: string, amount: string) => ({
  accountIndex,
  mint,
  owner: taker,
  uiTokenAmount: { amount },
});
const rent = 2039280,
  fee = 5000;
const meta: Balances = {
  err: null,
  fee,
  preBalances: [1_000_000_000, rent, rent, 1],
  postBalances: [999_995_000, rent, rent, 1],
  preTokenBalances: [tb(1, input, "1000"), tb(2, output, "100")],
  postTokenBalances: [tb(1, input, "900"), tb(2, output, "185")],
};
const sim = { context: { slot: 123 }, value: meta };
const prep = prepareExecution(pinned, signed, sim, T + 1000, "10003", 120);
assert.equal(prep.txid, signature);
assert.equal(prep.request.requestId, "fixture-request");
assert.equal(prep.expected.output, "85");
assert.throws(() => prepareExecution(pinned, signed, sim, T + 30_000, "10003"));
assert.throws(() => prepareExecution(pinned, signed, sim, T + 1000, "10006"));
assert.throws(() =>
  prepareExecution(
    pinned,
    signed,
    { ...sim, value: { ...meta, err: "simulation failure" } },
    T + 1000,
    "10003",
  ),
);
assert.throws(() =>
  prepareExecution(
    pinned,
    signed,
    { ...sim, value: { ...meta, replacementBlockhash: "changed" } },
    T + 1000,
    "10003",
  ),
);
assert.throws(() => prepareExecution(pinned, signed, sim, T, "10000", 124));
const insufficient = { ...meta, postTokenBalances: [tb(1, input, "900"), tb(2, output, "184")] };
assert.throws(() => prepareExecution(pinned, signed, { ...sim, value: insufficient }, T, "10000"));
const status = { slot: 124, confirmationStatus: "finalized", err: null } as const;
const receipt = { slot: 124, transaction: [signed, "base64"] as [string, "base64"], meta };
assert.deepEqual(settle(pinned, signature, null, null), { status: "awaiting_finality" });
assert.deepEqual(settle(pinned, signature, { ...status, confirmationStatus: "confirmed" }, receipt), {
  status: "awaiting_finality",
});
assert.deepEqual(settle(pinned, signature, { ...status, err: { InstructionError: [0, "Custom"] } }, null), {
  status: "failed",
});
assert.deepEqual(settle(pinned, signature, status, { ...receipt, meta: insufficient }), { status: "review" });
assert.deepEqual(
  settle(pinned, signature, status, { ...receipt, transaction: [pack(mutated, true), "base64"] }),
  { status: "review" },
);
assert.deepEqual(settle(pinned, signature, status, { ...receipt, slot: 123 }), { status: "review" });
assert.deepEqual(settle(pinned, signature, status, receipt), {
  status: "filled",
  txid: signature,
  slot: 124,
  fill: {
    input: "100",
    output: "85",
    networkFeeLamports: "5000",
    rentDeltaLamports: "0",
    otherNativeCostLamports: "0",
  },
});
const pSol = pinOrder({ ...intent, inputMint: WRAPPED_SOL }, { ...q, inputMint: WRAPPED_SOL }, T, "10000");
const native: Balances = {
  ...meta,
  preBalances: [1_000_000_000, rent, 0, 1],
  postBalances: [1_000_000_000 - fee - rent - 100, rent, rent, 1],
  preTokenBalances: [],
  postTokenBalances: [tb(2, output, "85")],
};
assert.equal(prepareExecution(pSol, signed, { ...sim, value: native }, T, "10000").expected.input, "100");
assert.equal(
  prepareExecution(pSol, signed, { ...sim, value: native }, T, "10000").expected.rentDeltaLamports,
  String(rent),
);
assert.throws(() =>
  prepareExecution(
    pSol,
    signed,
    { ...sim, value: { ...native, postBalances: [Number.MAX_SAFE_INTEGER + 2, rent, rent, 1] } },
    T,
    "10000",
  ),
);
process.stdout.write(
  "PASS offline owner proof, canonical wire, bound signatures, quote and block expiry, exact simulated debits, finalized receipt and SOL rent accounting\n",
);
