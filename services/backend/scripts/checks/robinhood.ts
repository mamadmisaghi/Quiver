import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";
import {
  reconcileTestSwap,
  walletCallCandidates,
  type ContractPin,
  type ReadRpc,
  type TestSwap,
  type TestVenue,
} from "../../src/execution/rh-receipt";

const A = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Address;
const H = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const word = (n: bigint) => n.toString(16).padStart(64, "0");
const topic = (a: Address) => ("0x" + a.slice(2).padStart(64, "0")) as Hex;
const D = (n: number) => ("0x60" + n.toString(16).padStart(2, "0") + "00") as Hex; // synthetic code, never deployed
const contract = (n: number): ContractPin => ({ address: A(n), runtimeHash: keccak256(D(n)) });
const chain = "0xb626",
  b = 100,
  hash = H(10),
  txHash = H(88);
const methods = parseAbi([
  "function swapExactIn(address,uint256,uint256,address,uint256) returns (uint256)",
  "function ownerCall(address,bytes) returns (bytes)",
  "function approve(address,uint256) returns (bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function owner() view returns (address)",
]);
function swap(input: Address = A(2), amount = 101n, min = 59n, recipient: Address = A(8), deadline = 1100n) {
  return encodeFunctionData({
    abi: methods,
    functionName: "swapExactIn",
    args: [input, amount, min, recipient, deadline],
  });
}
function make(kind: "direct" | "ownerCall" = "direct", sell = false) {
  const venue: TestVenue = { genesisHash: H(1), pool: contract(1), token0: contract(2), token1: contract(3) };
  const owner = A(8),
    recipient = kind === "direct" ? owner : A(4),
    input = sell ? A(3) : A(2),
    output = sell ? A(2) : A(3);
  const intent: TestSwap = {
    owner,
    tokenIn: input,
    tokenOut: output,
    amountIn: 101n,
    minOut: 59n,
    deadline: 1100n,
    afterBlock: 99n,
    preparedAtBlockTime: 1000n,
    txHash,
    nonce: 4n,
    route: kind === "direct" ? { kind } : { kind, account: contract(4) },
  };
  const raw = swap(input, 101n, 59n, recipient);
  const calldata =
    kind === "direct"
      ? raw
      : encodeFunctionData({ abi: methods, functionName: "ownerCall", args: [A(1), raw] });
  const tx = {
    hash: txHash,
    blockHash: hash,
    blockNumber: "0x64",
    transactionIndex: "0x1",
    from: owner,
    to: kind === "direct" ? A(1) : A(4),
    chainId: chain,
    nonce: "0x4",
    type: "0x2",
    authorizationList: null as unknown,
    value: "0x0",
    input: calldata,
  };
  const transfer = toEventSelector("Transfer(address,address,uint256)"),
    event = toEventSelector("Swap(address,address,uint256,uint256,address)");
  const log = (emitter: Address, topics: Hex[], data: string, n: number) => ({
    address: emitter,
    topics,
    data,
    blockHash: hash,
    blockNumber: "0x64",
    transactionHash: txHash,
    transactionIndex: "0x1",
    logIndex: "0x" + n.toString(16),
    removed: false,
  });
  const receipt = {
    transactionHash: txHash,
    blockHash: hash,
    blockNumber: "0x64",
    transactionIndex: "0x1",
    from: owner,
    to: tx.to,
    status: "0x1",
    logs: [
      log(input, [transfer, topic(recipient), topic(A(1))], "0x" + word(101n), 4),
      log(output, [transfer, topic(A(1)), topic(recipient)], "0x" + word(63n), 5),
      log(A(1), [event, topic(recipient), topic(input), topic(recipient)], "0x" + word(101n) + word(63n), 6),
    ],
  };
  const block = { number: "0x64", hash, timestamp: "0x3f2", transactions: [H(87), txHash] };
  const f = {
    venue,
    intent,
    tx,
    receipt,
    block,
    genesis: { hash: H(1), number: "0x0" },
    head: { hash: H(11), number: "0x65" },
    anchor: { hash: H(11), number: "0x65" },
    chainId: chain,
    ownerGetter: owner,
    token0: A(2),
    token1: A(3),
    codes: new Map([1, 2, 3, 4].map((n) => [A(n), D(n)])),
    calls: [] as string[],
    throwOn: "",
    withoutReceipt: false,
    withoutFinality: false,
    nullCanonical: false,
    replaceOnRead: 0,
    canonicalReads: 0,
  };
  const read: ReadRpc = async (method, params) => {
    f.calls.push(method + ":" + String(params[0]));
    if (f.throwOn === method) throw new Error("simulated unavailability");
    if (method === "eth_chainId") return f.chainId;
    if (method === "eth_getTransactionReceipt") {
      assert.equal(params[0], txHash);
      return f.withoutReceipt ? null : f.receipt;
    }
    if (method === "eth_getTransactionByHash") {
      assert.equal(params[0], txHash);
      return f.tx;
    }
    if (method === "eth_getBlockByNumber") {
      assert.equal(params[1], false);
      if (params[0] === "0x0") return f.genesis;
      if (params[0] === "finalized") return f.withoutFinality ? null : f.head;
      if (params[0] === "0x65") return f.anchor;
      assert.equal(params[0], "0x64");
      f.canonicalReads++;
      if (f.nullCanonical) return null;
      return f.canonicalReads === f.replaceOnRead ? { ...f.block, hash: H(19) } : f.block;
    }
    assert.deepEqual(params[1], { blockHash: hash, requireCanonical: true });
    if (method === "eth_getCode") return f.codes.get(params[0] as Address) ?? "0x";
    const call = params[0] as { to: Address; data: Hex };
    const name = decodeFunctionData({ abi: methods, data: call.data }).functionName;
    if (name === "token0" || name === "token1") {
      assert.equal(call.to, A(1));
      return topic(f[name]);
    }
    assert.equal(name, "owner");
    assert.equal(call.to, A(4));
    return topic(f.ownerGetter);
  };
  return { f, read };
}
type Fixtures = ReturnType<typeof make>["f"];
async function main() {
  let count = 0;
  const probe = async (
    label: string,
    wanted: string,
    mutate?: (f: Fixtures) => void,
    kind: "direct" | "ownerCall" = "direct",
    sell = false,
    prior?: { hash: Hex; number: bigint },
  ) => {
    const { f, read } = make(kind, sell);
    mutate?.(f);
    const result = await reconcileTestSwap(read, f.venue, f.intent, prior);
    assert.equal(
      result.state,
      wanted,
      label + " got " + JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    );
    if (result.state === "settled") {
      assert.equal(result.amountOut, 63n);
      assert.equal(result.amountIn, 101n);
      assert.equal(result.logIndex, 6n);
      assert.equal(result.tokenOut, f.intent.tokenOut);
      assert.deepEqual(result.inclusion, { hash, number: BigInt(b) });
    }
    count++;
  };
  await probe("direct buy", "settled");
  await probe("direct sell", "settled", undefined, "direct", true);
  await probe("verified ownerCall", "settled", undefined, "ownerCall");
  await probe("finalized head equal to included block", "settled", (f) => {
    f.head = { hash, number: "0x64" };
  });
  await probe("delayed finalization settles after wallclock deadline", "settled", (f) => {
    f.block.timestamp = "0x44c";
  });
  await probe("matching prior inclusion", "settled", undefined, "direct", false, { number: 100n, hash });
  await probe("approval never fills", "unverified", (f) => {
    f.tx.to = A(2);
    f.receipt.to = A(2);
    f.tx.input = encodeFunctionData({ abi: methods, functionName: "approve", args: [A(1), 101n] });
    f.receipt.logs = [];
  });
  await probe("opaque bundler wrapper", "unverified", (f) => {
    f.tx.to = A(18);
    f.receipt.to = A(18);
  });
  await probe("wrong RPC network", "unverified", (f) => {
    f.chainId = "0x1237";
  });
  await probe("same chain id wrong genesis", "unverified", (f) => {
    f.genesis.hash = H(4);
  });
  await probe("wrong transaction chain", "unverified", (f) => {
    f.tx.chainId = "0x1";
  });
  await probe("wrong EOA", "unverified", (f) => {
    f.tx.from = A(9);
    f.receipt.from = A(9);
  });
  await probe("wrong nonce", "unverified", (f) => {
    f.tx.nonce = "0x5";
  });
  await probe("native transfer", "unverified", (f) => {
    f.tx.value = "0x1";
  });
  await probe("authorization transaction", "unverified", (f) => {
    f.tx.type = "0x4";
    f.tx.authorizationList = [{}];
  });
  await probe("tx from unrecognized approval", "unverified", (f) => {
    f.tx.input = encodeFunctionData({ abi: methods, functionName: "approve", args: [A(1), 101n] });
  });
  await probe("wrong token", "unverified", (f) => {
    f.tx.input = swap(A(3));
  });
  await probe("wrong amount", "unverified", (f) => {
    f.tx.input = swap(A(2), 102n);
  });
  await probe("altered floor", "unverified", (f) => {
    f.tx.input = swap(A(2), 101n, 58n);
  });
  await probe("swapped to other beneficiary", "unverified", (f) => {
    f.tx.input = swap(A(2), 101n, 59n, A(9));
  });
  await probe("different deadline", "unverified", (f) => {
    f.tx.input = swap(A(2), 101n, 59n, A(8), 1200n);
  });
  await probe("trailing bytes", "unverified", (f) => {
    f.tx.input = (f.tx.input + "00") as Hex;
  });
  await probe(
    "ownerCall wrong nested pool",
    "unverified",
    (f) => {
      f.tx.input = encodeFunctionData({
        abi: methods,
        functionName: "ownerCall",
        args: [A(18), swap(A(2), 101n, 59n, A(4))],
      });
    },
    "ownerCall",
  );
  await probe(
    "ownerCall wrong on-chain owner",
    "unverified",
    (f) => {
      f.ownerGetter = A(9);
    },
    "ownerCall",
  );
  await probe("runtime substitution", "unverified", (f) => {
    f.codes.set(A(1), D(8));
  });
  await probe("absent output token code", "unverified", (f) => {
    f.codes.delete(A(3));
  });
  await probe("pool pair substitution", "unverified", (f) => {
    f.token1 = A(9);
  });
  await probe("unsupported assets", "unverified", (f) => {
    f.intent.tokenOut = A(9);
  });
  await probe("zero price floor", "unverified", (f) => {
    f.intent.minOut = 0n;
  });
  await probe("receipt hash mismatch", "unverified", (f) => {
    f.receipt.transactionHash = H(89);
  });
  await probe("receipt tx index mismatch", "unverified", (f) => {
    f.receipt.transactionIndex = "0x0";
  });
  await probe("canonical block missing transaction at index", "unverified", (f) => {
    f.block.transactions.reverse();
  });
  await probe("historical replay", "unverified", (f) => {
    f.intent.afterBlock = 100n;
  });
  await probe("inclusion after deadline", "unverified", (f) => {
    f.block.timestamp = "0x44d";
  });
  await probe("successful receipt lacking events", "unverified", (f) => {
    f.receipt.logs = [];
  });
  await probe("fake emitter", "unverified", (f) => {
    f.receipt.logs[2].address = A(15);
  });
  await probe("event sender mismatch", "unverified", (f) => {
    f.receipt.logs[2].topics[1] = topic(A(9));
  });
  await probe("amount below minimum", "unverified", (f) => {
    f.receipt.logs[2].data = "0x" + word(101n) + word(58n);
  });
  await probe("false output transfer", "unverified", (f) => {
    f.receipt.logs[1].data = "0x" + word(1n);
  });
  await probe("unrelated input transfer", "unverified", (f) => {
    f.receipt.logs[0].topics[1] = topic(A(9));
  });
  await probe("wrong output token", "unverified", (f) => {
    f.receipt.logs[1].address = A(9);
  });
  await probe("other transaction's logs", "unverified", (f) => {
    f.receipt.logs[2].transactionHash = H(91);
  });
  await probe("removed log", "unverified", (f) => {
    f.receipt.logs[2].removed = true;
  });
  await probe("duplicate swap", "unverified", (f) => {
    f.receipt.logs.push(f.receipt.logs[2]);
  });
  await probe("reordered receipt logs", "unverified", (f) => {
    f.receipt.logs.reverse();
  });
  await probe("sequencer receipt only", "pending", (f) => {
    f.head.number = "0x63";
  });
  await probe("no finalized call", "pending", (f) => {
    f.withoutFinality = true;
  });
  await probe("inconsistent finalized anchor", "pending", (f) => {
    f.anchor.hash = H(22);
  });
  await probe("missing receipt", "pending", (f) => {
    f.withoutReceipt = true;
  });
  await probe("missing block", "pending", (f) => {
    f.nullCanonical = true;
  });
  await probe("unavailable archive", "pending", (f) => {
    f.throwOn = "eth_getCode";
  });
  await probe("previously included block changed", "reorged", undefined, "direct", false, {
    number: 100n,
    hash: H(29),
  });
  await probe("receipt block no longer canonical", "reorged", (f) => {
    f.replaceOnRead = 1;
  });
  await probe("changed during verification", "reorged", (f) => {
    f.replaceOnRead = 2;
  });
  await probe("conflicting finalized block at same height", "reorged", (f) => {
    f.head = { hash: H(23), number: "0x64" };
  });
  await probe("canonical finalized revert", "reverted", (f) => {
    f.receipt.status = "0x0";
    f.receipt.logs = [];
    f.block.timestamp = "0x505";
  });
  await probe("revert with contradictory logs", "unverified", (f) => {
    f.receipt.status = "0x0";
  });
  await probe("reverted trade not yet final", "pending", (f) => {
    f.receipt.status = "0x0";
    f.head.number = "0x63";
  });
  await probe("invalid receipt status", "unverified", (f) => {
    f.receipt.status = "0x2";
  });
  const batch = {
    chainId: chain,
    id: "opaque",
    status: 200,
    receipts: [{ transactionHash: H(87) }, { transactionHash: txHash }, { transactionHash: txHash }],
  };
  assert.deepEqual(walletCallCandidates(batch, "opaque"), [H(87), txHash]);
  count++;
  assert.deepEqual(walletCallCandidates({ ...batch, status: 100, receipts: undefined }, "opaque"), []);
  count++;
  assert.deepEqual(walletCallCandidates({ ...batch, status: 600 }, "opaque"), [H(87), txHash]);
  count++;
  assert.throws(() => walletCallCandidates({ ...batch, chainId: "0x1237" }, "opaque"));
  count++;
  assert.throws(() =>
    walletCallCandidates({ ...batch, receipts: [{ transactionHash: "opaque batch ID" }] }, "opaque"),
  );
  count++;
  assert.throws(() => walletCallCandidates(batch, "different"));
  count++;
  console.log(count + " Robinhood testnet receipt fixtures passed; zero network requests or signing.");
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
