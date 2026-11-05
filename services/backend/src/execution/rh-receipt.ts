import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";

const CHAIN = 46630n;
const abi = parseAbi([
  "function swapExactIn(address tokenIn,uint256 amountIn,uint256 minOut,address to,uint256 deadline) returns (uint256)",
  "function ownerCall(address target,bytes data) returns (bytes)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function owner() view returns (address)",
]);
const SWAP = toEventSelector("Swap(address,address,uint256,uint256,address)");
const TRANSFER = toEventSelector("Transfer(address,address,uint256)");
const ZERO = "0x" + "00".repeat(20);
type Obj = Record<string, unknown>;
function insist(test: unknown, label: string): asserts test {
  if (!test) throw new Error(label);
}
function object(v: unknown): Obj {
  insist(v !== null && typeof v === "object" && !Array.isArray(v), "malformed RPC object");
  return v as Obj;
}
function bytes(v: unknown, max = 4096): Hex {
  insist(
    typeof v === "string" && v.length <= 2 + max * 2 && /^0x(?:[a-f0-9]{2})*$/i.test(v),
    "malformed or oversized bytes",
  );
  return v.toLowerCase() as Hex;
}
function hash(v: unknown): Hex {
  const h = bytes(v, 32);
  insist(h.length === 66, "invalid 32-byte hash");
  return h;
}
function address(v: unknown): Address {
  const a = bytes(v, 20);
  insist(a.length === 42 && a !== ZERO, "invalid or zero address");
  return a;
}
function quantity(v: unknown): bigint {
  insist(typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v), "invalid RPC quantity");
  return BigInt(v);
}
function uint(v: bigint, positive = false): void {
  insist(typeof v === "bigint" && v >= (positive ? 1n : 0n) && v < 1n << 256n, "invalid intent quantity");
}
const tag = (n: bigint) => ("0x" + n.toString(16)) as Hex;
const word = (n: bigint) => n.toString(16).padStart(64, "0");
const indexed = (a: string) => "0x" + a.slice(2).padStart(64, "0");
const pin = (actual: unknown, expected: string) => hash(actual) === hash(expected);

export interface ContractPin {
  address: Address;
  runtimeHash: Hex;
}
/** Persist this server-owned deployment manifest. Runtime hashes must include deployed immutables. */
export interface TestVenue {
  genesisHash: Hex;
  pool: ContractPin;
  token0: ContractPin;
  token1: ContractPin;
}
/** Persist the prepared values and bind the submitted hash and nonce to one authenticated intent. */
export interface TestSwap {
  owner: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minOut: bigint;
  deadline: bigint;
  afterBlock: bigint;
  preparedAtBlockTime: bigint;
  nonce: bigint;
  txHash: Hex;
  route: { kind: "direct" } | { kind: "ownerCall"; account: ContractPin };
}
export type ReadRpc = (
  method:
    | "eth_chainId"
    | "eth_getBlockByNumber"
    | "eth_getTransactionByHash"
    | "eth_getTransactionReceipt"
    | "eth_getCode"
    | "eth_call",
  params: readonly unknown[],
) => Promise<unknown>;
export interface IncludedBlock {
  number: bigint;
  hash: Hex;
}
export type Outcome =
  | { state: "pending" | "reorged" | "unverified"; reason: string; inclusion?: IncludedBlock }
  | { state: "reverted"; inclusion: IncludedBlock; txHash: Hex }
  | {
      state: "settled";
      inclusion: IncludedBlock;
      txHash: Hex;
      logIndex: bigint;
      sender: Address;
      recipient: Address;
      amountIn: bigint;
      amountOut: bigint;
      tokenIn: Address;
      tokenOut: Address;
    };

function validatePins(v: TestVenue, i: TestSwap) {
  hash(v.genesisHash);
  hash(i.txHash);
  const pins = [v.pool, v.token0, v.token1];
  if (i.route.kind === "ownerCall") pins.push(i.route.account);
  const addresses = pins.map((p) => {
    hash(p.runtimeHash);
    return address(p.address);
  });
  insist(new Set(addresses).size === addresses.length, "overlapping pinned contracts");
  const owner = address(i.owner);
  insist(!addresses.includes(owner), "owner cannot be a pinned contract");
  const tokenIn = address(i.tokenIn),
    tokenOut = address(i.tokenOut);
  insist(
    tokenIn !== tokenOut && [tokenIn, tokenOut].every((a) => addresses.slice(1, 3).includes(a)),
    "pair differs from pinned test tokens",
  );
  uint(i.amountIn, true);
  uint(i.minOut, true);
  uint(i.deadline, true);
  uint(i.afterBlock);
  uint(i.preparedAtBlockTime);
  uint(i.nonce);
  insist(i.deadline > i.preparedAtBlockTime, "deadline precedes preparation");
  return {
    pool: addresses[0],
    owner,
    sender: i.route.kind === "ownerCall" ? address(i.route.account.address) : owner,
    tokenIn,
    tokenOut,
    pins,
  };
}

function verifyCalldata(tx: Obj, i: TestSwap, v: ReturnType<typeof validatePins>) {
  insist(
    quantity(tx.chainId) === CHAIN && address(tx.from) === v.owner && quantity(tx.nonce) === i.nonce,
    "transaction chain, wallet or nonce mismatch",
  );
  insist(
    [0n, 1n, 2n].includes(quantity(tx.type)) && tx.authorizationList == null,
    "unsupported transaction authorization type",
  );
  insist(quantity(tx.value) === 0n, "unexpected native transfer");
  let data = bytes(tx.input);
  if (i.route.kind === "ownerCall") {
    insist(address(tx.to) === v.sender, "wrong outer account");
    const outer = decodeFunctionData({ abi, data });
    insist(
      outer.functionName === "ownerCall" && address(outer.args[0]) === v.pool,
      "wrong account method or target",
    );
    insist(
      encodeFunctionData({ abi, functionName: "ownerCall", args: outer.args }).toLowerCase() === data,
      "noncanonical owner call",
    );
    data = bytes(outer.args[1]);
  } else {
    insist(address(tx.to) === v.pool, "wrong pool or approval-only transaction");
  }
  const inner = decodeFunctionData({ abi, data });
  insist(inner.functionName === "swapExactIn", "wrong pool method");
  const [input, amount, min, recipient, deadline] = inner.args;
  insist(
    address(input) === v.tokenIn &&
      address(recipient) === v.sender &&
      amount === i.amountIn &&
      min === i.minOut &&
      deadline === i.deadline,
    "swap differs from signed intent",
  );
  insist(
    encodeFunctionData({ abi, functionName: "swapExactIn", args: inner.args }).toLowerCase() === data,
    "noncanonical swap calldata",
  );
}

async function checkRuntime(rpc: ReadRpc, blockHash: Hex, i: TestSwap, v: ReturnType<typeof validatePins>) {
  const at = { blockHash, requireCanonical: true };
  for (const p of v.pins) {
    const code = bytes(await rpc("eth_getCode", [address(p.address), at]), 24576);
    insist(code !== "0x" && pin(keccak256(code), p.runtimeHash), "pinned runtime mismatch");
  }
  const read = async (to: Address, name: "token0" | "token1" | "owner") => {
    const result = bytes(
      await rpc("eth_call", [{ to, data: encodeFunctionData({ abi, functionName: name }) }, at]),
      32,
    );
    insist(
      result.length === 66 && result.slice(2, 26) === "0".repeat(24),
      "noncanonical contract getter result",
    );
    return address(decodeFunctionResult({ abi, functionName: name, data: result }));
  };
  insist(
    (await read(v.pool, "token0")) === address(v.pins[1].address) &&
      (await read(v.pool, "token1")) === address(v.pins[2].address),
    "on-chain pool tokens differ",
  );
  if (i.route.kind === "ownerCall")
    insist((await read(v.sender, "owner")) === v.owner, "wrong account owner");
}

function verifyEvents(
  receipt: Obj,
  i: TestSwap,
  v: ReturnType<typeof validatePins>,
  block: IncludedBlock,
  txIndex: bigint,
) {
  // The pinned mock tokens emit one Transfer each. The pinned pool emits Swap last.
  // Neither the direct call nor this specific ownerCall emits other application events.
  insist(
    Array.isArray(receipt.logs) && receipt.logs.length === 3,
    "receipt must contain exactly two transfers and one swap",
  );
  const logs = receipt.logs.map((val) => {
    const l = object(val);
    insist(
      l.removed === false &&
        hash(l.transactionHash) === hash(i.txHash) &&
        pin(l.blockHash, block.hash) &&
        quantity(l.transactionIndex) === txIndex &&
        quantity(l.blockNumber) === block.number,
      "log belongs to a different or removed inclusion",
    );
    insist(Array.isArray(l.topics) && l.topics.length <= 4, "invalid topics");
    return {
      address: address(l.address),
      topics: l.topics.map(hash),
      data: bytes(l.data, 64),
      index: quantity(l.logIndex),
    };
  });
  const [input, output, swap] = logs;
  insist(input.index < output.index && output.index < swap.index, "unexpected event ordering");
  const topics = (list: Hex[], expected: string[]) =>
    list.length === expected.length && list.every((value, n) => value === expected[n]);
  insist(
    swap.address === v.pool &&
      topics(swap.topics, [SWAP, indexed(v.sender), indexed(v.tokenIn), indexed(v.sender)]) &&
      swap.data.length === 130,
    "wrong pool Swap event",
  );
  const amountIn = BigInt("0x" + swap.data.slice(2, 66)),
    amountOut = BigInt("0x" + swap.data.slice(66));
  insist(amountIn === i.amountIn && amountOut >= i.minOut, "event amounts outside intent");
  insist(
    input.address === v.tokenIn &&
      topics(input.topics, [TRANSFER, indexed(v.sender), indexed(v.pool)]) &&
      input.data === "0x" + word(amountIn),
    "input transfer mismatch",
  );
  insist(
    output.address === v.tokenOut &&
      topics(output.topics, [TRANSFER, indexed(v.pool), indexed(v.sender)]) &&
      output.data === "0x" + word(amountOut),
    "output transfer mismatch",
  );
  return { logIndex: swap.index, amountIn, amountOut };
}

/** Only a configured server-side transport is admissible. No network writes or wallet dependencies. */
export async function reconcileTestSwap(
  rpc: ReadRpc,
  venue: TestVenue,
  intent: TestSwap,
  prior?: IncludedBlock,
): Promise<Outcome> {
  let inclusion: IncludedBlock | undefined;
  // A transport errors independently of settlement validity, including unsupported finality/archive reads.
  const read: ReadRpc = async (method, params) => {
    try {
      return await rpc(method, params);
    } catch {
      throw new RpcUnavailable(method);
    }
  };
  try {
    const v = validatePins(venue, intent);
    insist(quantity(await read("eth_chainId", [])) === CHAIN, "wrong RPC chain");
    const genesis = object(await read("eth_getBlockByNumber", ["0x0", false]));
    insist(quantity(genesis.number) === 0n && pin(genesis.hash, venue.genesisHash), "wrong RPC genesis");
    if (prior) {
      uint(prior.number);
      hash(prior.hash);
      const old = await read("eth_getBlockByNumber", [tag(prior.number), false]);
      if (old == null)
        return { state: "pending", reason: "previous inclusion not available", inclusion: prior };
      if (quantity(object(old).number) !== prior.number || !pin(object(old).hash, prior.hash))
        return { state: "reorged", reason: "previous block replaced", inclusion: prior };
    }
    const h = hash(intent.txHash);
    const [rawTx, rawReceipt] = await Promise.all([
      read("eth_getTransactionByHash", [h]),
      read("eth_getTransactionReceipt", [h]),
    ]);
    if (rawTx == null || rawReceipt == null)
      return { state: "pending", reason: "transaction or receipt unavailable", inclusion: prior };
    const tx = object(rawTx),
      receipt = object(rawReceipt);
    if (tx.blockHash == null || receipt.blockHash == null)
      return { state: "pending", reason: "transaction not included" };
    const block = { number: quantity(receipt.blockNumber), hash: hash(receipt.blockHash) };
    const txIndex = quantity(receipt.transactionIndex);
    insist(
      pin(tx.hash, h) &&
        pin(receipt.transactionHash, h) &&
        pin(tx.blockHash, block.hash) &&
        quantity(tx.blockNumber) === block.number &&
        quantity(tx.transactionIndex) === txIndex &&
        address(receipt.from) === address(tx.from) &&
        address(receipt.to) === address(tx.to),
      "transaction and receipt inclusion disagree",
    );
    insist(block.number > intent.afterBlock, "transaction predates preparation");
    const canonical = async () => {
      const raw = await read("eth_getBlockByNumber", [tag(block.number), false]);
      if (raw == null) throw new RpcUnavailable("numbered block");
      const b = object(raw);
      if (quantity(b.number) !== block.number || !pin(b.hash, block.hash)) return null;
      insist(
        Array.isArray(b.transactions) &&
          txIndex < BigInt(b.transactions.length) &&
          pin(b.transactions[Number(txIndex)], h),
        "transaction missing from block position",
      );
      return b;
    };
    const included = await canonical();
    if (!included) return { state: "reorged", reason: "receipt block replaced", inclusion: block };
    inclusion = block;
    verifyCalldata(tx, intent, v);
    const blockTime = quantity(included.timestamp);
    insist(blockTime >= intent.preparedAtBlockTime, "block predates preparation");
    const finalRaw = await read("eth_getBlockByNumber", ["finalized", false]);
    if (finalRaw == null) return { state: "pending", reason: "finality unavailable", inclusion: block };
    const finalHead = object(finalRaw);
    const finalizedNumber = quantity(finalHead.number),
      finalizedHash = hash(finalHead.hash);
    if (finalizedNumber < block.number)
      return { state: "pending", reason: "awaiting finalized head", inclusion: block };
    if (finalizedNumber === block.number && finalizedHash !== block.hash)
      return { state: "reorged", reason: "finalized anchor conflicts", inclusion: block };
    if (finalizedNumber > block.number) {
      const anchor = await read("eth_getBlockByNumber", [tag(finalizedNumber), false]);
      if (anchor == null)
        return { state: "pending", reason: "canonical finality anchor unavailable", inclusion: block };
      const a = object(anchor);
      if (quantity(a.number) !== finalizedNumber || !pin(a.hash, finalizedHash))
        return { state: "pending", reason: "RPC finality anchor inconsistent", inclusion: block };
    }
    const status = quantity(receipt.status);
    insist(status === 0n || status === 1n, "unknown execution status");
    await checkRuntime(read, block.hash, intent, v);
    let fill: ReturnType<typeof verifyEvents> | undefined;
    if (status === 1n) {
      insist(blockTime <= intent.deadline, "successful inclusion after swap deadline");
      fill = verifyEvents(receipt, intent, v, block, txIndex);
    } else
      insist(
        Array.isArray(receipt.logs) && receipt.logs.length === 0,
        "revert with contradictory application events",
      );
    if (!(await canonical()))
      return { state: "reorged", reason: "block changed during verification", inclusion: block };
    if (!fill) return { state: "reverted", inclusion: block, txHash: h };
    return {
      state: "settled",
      inclusion: block,
      txHash: h,
      sender: v.sender,
      recipient: v.sender,
      tokenIn: v.tokenIn,
      tokenOut: v.tokenOut,
      ...fill,
    };
  } catch (err) {
    if (err instanceof RpcUnavailable)
      return { state: "pending", reason: "authoritative RPC unavailable: " + err.message, inclusion };
    return {
      state: "unverified",
      reason: err instanceof Error ? err.message : "invalid evidence",
      inclusion,
    };
  }
}
class RpcUnavailable extends Error {}

/** EIP-5792 receipt hashes are polling hints only. Reread whole transactions/receipts independently.
 * An opaque wallet batch ID, an approval, a UserOperation hash or a filtered event cannot settle a swap.
 */
export function walletCallCandidates(status: unknown, expectedBatchId: string): Hex[] {
  const s = object(status);
  insist(quantity(s.chainId) === CHAIN, "wrong wallet batch chain");
  insist(
    typeof expectedBatchId === "string" &&
      expectedBatchId.length > 0 &&
      expectedBatchId.length <= 8194 &&
      s.id === expectedBatchId,
    "wrong wallet batch identifier",
  );
  insist(
    typeof s.status === "number" && Number.isInteger(s.status) && s.status >= 100 && s.status <= 999,
    "invalid wallet batch status",
  );
  // A partially completed non-atomic batch may contain a real fill or just an approval.
  if (s.receipts == null) return [];
  insist(Array.isArray(s.receipts) && s.receipts.length <= 16, "invalid wallet receipt list");
  return [...new Set(s.receipts.map((r) => hash(object(r).transactionHash)))];
}
