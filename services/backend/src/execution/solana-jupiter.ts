import { decodeWire, encode58, read58, verifyEd25519, type WireTx } from "./solana-wire";

export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const MAX_U64 = (1n << 64n) - 1n;

function ensure(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
function uint(v: unknown): bigint {
  ensure(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v), "Expected a canonical integer string");
  const n = BigInt(v);
  ensure(n <= MAX_U64, "u64 overflow");
  return n;
}
function rpcAmount(v: number | string): bigint {
  if (typeof v === "number") {
    ensure(Number.isSafeInteger(v) && v >= 0, "Unsafe RPC integer");
    return BigInt(v);
  }
  return uint(v);
}

export type SwapIntent = {
  ownerId: string;
  intentId: string;
  taker: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  minOutput: string;
  maxSlippageBps: number;
  maxImpactBps: number;
  maxSwapFeeBps: number;
  maxNetworkAndRentLamports: string;
  expiresAt: number;
};
export type JupiterOrder = {
  requestId: string;
  transaction: string | null;
  transactionVersion?: number;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  feeBps: number;
  priceImpact: number;
  signatureFeePayer: string | null;
  gasless: boolean;
  signatureFeeLamports: number;
  prioritizationFeeLamports: number;
  rentFeeLamports: number;
  taker: string | null;
  lastValidBlockHeight: string;
  router: string;
  expireAt?: string;
  error?: string;
  errorCode?: number;
};
export type PinnedOrder = {
  intent: SwapIntent;
  requestId: string;
  expiresAt: number;
  lastValidBlockHeight: string;
  requiredOutput: string;
  messageHash: string;
  blockhash: string;
  unsigned: string;
};

/** Server supplies authenticated owner, persisted budget/limits, fixed host and selected mint identities. */
export function orderUrl(intent: SwapIntent): string {
  const q = new URLSearchParams({
    inputMint: intent.inputMint,
    outputMint: intent.outputMint,
    amount: intent.inputAmount,
    taker: intent.taker,
    receiver: intent.taker,
    slippageBps: String(intent.maxSlippageBps),
    maxSupportedTransactionVersion: "0",
    excludeRouters: "jupiterz",
  });
  return "https://api.jup.ag/swap/v2/order?" + q;
}
export function pinOrder(
  intent: SwapIntent,
  q: JupiterOrder,
  now: number,
  currentBlockHeight: string,
): PinnedOrder {
  ensure(
    typeof intent.ownerId === "string" &&
      intent.ownerId.length &&
      typeof intent.intentId === "string" &&
      intent.intentId.length,
    "Intent identity required",
  );
  for (const a of [intent.taker, intent.inputMint, intent.outputMint]) read58(a, 32);
  ensure(
    intent.inputMint !== intent.outputMint && uint(intent.inputAmount) > 0n && uint(intent.minOutput) > 0n,
    "Invalid swap amounts or mints",
  );
  for (const n of [intent.maxSlippageBps, intent.maxImpactBps, intent.maxSwapFeeBps])
    ensure(Number.isSafeInteger(n) && n >= 0 && n < 10_000, "Invalid swap risk limits");
  ensure(
    Number.isSafeInteger(now) && Number.isSafeInteger(intent.expiresAt) && intent.expiresAt > now,
    "Intent expired",
  );
  ensure(
    !q.error &&
      q.errorCode === undefined &&
      typeof q.transaction === "string" &&
      q.transaction.length &&
      /^[A-Za-z0-9._:-]{1,160}$/.test(q.requestId),
    "Missing executable Jupiter order",
  );
  ensure(
    q.inputMint === intent.inputMint &&
      q.outputMint === intent.outputMint &&
      q.inAmount === intent.inputAmount &&
      q.taker === intent.taker &&
      q.swapMode === "ExactIn",
    "Jupiter order does not match authorized intent",
  );
  ensure(
    ["metis", "dflow", "okx"].includes(q.router) &&
      q.signatureFeePayer === intent.taker &&
      q.gasless === false,
    "Sponsored and RFQ signing require separate recovery handling",
  );
  ensure(
    Number.isSafeInteger(q.slippageBps) &&
      q.slippageBps >= 0 &&
      q.slippageBps <= intent.maxSlippageBps &&
      Number.isSafeInteger(q.feeBps) &&
      q.feeBps >= 0 &&
      q.feeBps <= intent.maxSwapFeeBps &&
      Number.isFinite(q.priceImpact) &&
      Math.abs(q.priceImpact) * 100 <= intent.maxImpactBps,
    "Quote exceeds risk limits",
  );
  const quotedNetwork =
    rpcAmount(q.signatureFeeLamports) + rpcAmount(q.prioritizationFeeLamports) + rpcAmount(q.rentFeeLamports);
  ensure(quotedNetwork <= uint(intent.maxNetworkAndRentLamports), "Quote exceeds network and rent limits");
  const quoted = uint(q.outAmount),
    threshold = uint(q.otherAmountThreshold);
  ensure(
    quoted >= threshold &&
      threshold >= uint(intent.minOutput) &&
      threshold >= (quoted * (10000n - BigInt(q.slippageBps))) / 10000n,
    "Quote minimum output is outside intent",
  );
  ensure(uint(currentBlockHeight) <= uint(q.lastValidBlockHeight), "Order blockhash expired");
  const tx = decodeWire(q.transaction);
  ensure(
    (q.transactionVersion === undefined || q.transactionVersion === tx.version) &&
      tx.signerKeys.length === 1 &&
      tx.signerKeys[0] === intent.taker,
    "Unexpected transaction signer or version",
  );
  ensure(
    tx.signatures[0].every((x) => x === 0),
    "Expected unsigned user transaction",
  );
  const venueExpires = q.expireAt == null ? Infinity : Date.parse(q.expireAt);
  ensure(venueExpires > now, "Invalid or expired venue quote");
  return {
    intent: { ...intent },
    requestId: q.requestId,
    expiresAt: Math.min(now + 30_000, intent.expiresAt, venueExpires),
    lastValidBlockHeight: q.lastValidBlockHeight,
    requiredOutput: threshold.toString(),
    messageHash: tx.digest,
    blockhash: tx.blockhash,
    unsigned: q.transaction,
  };
}

/** No funds are submitted here. The authenticated server must load p itself rather than accepting p from the browser. */
export function bindSignature(p: PinnedOrder, signed: string): { tx: WireTx; txid: string } {
  const tx = decodeWire(signed);
  ensure(
    tx.digest === p.messageHash &&
      tx.signerKeys.length === 1 &&
      tx.signerKeys[0] === p.intent.taker &&
      tx.blockhash === p.blockhash,
    "Signed message differs from approved order",
  );
  ensure(verifyEd25519(p.intent.taker, tx.message, tx.signatures[0]), "Missing or invalid taker signature");
  return { tx, txid: encode58(tx.signatures[0]) };
}

type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };
export type Balances = {
  err: unknown;
  fee: number | string;
  preBalances: (number | string)[];
  postBalances: (number | string)[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
};
export type ActualFill = {
  input: string;
  output: string;
  networkFeeLamports: string;
  rentDeltaLamports: string;
  otherNativeCostLamports: string;
};
function sideBalances(rows: TokenBalance[], lamports: (number | string)[], w: WireTx, owner: string) {
  ensure(
    Array.isArray(rows) && Array.isArray(lamports) && lamports.length === w.totalKeys,
    "Account balance evidence unavailable",
  );
  const tokens = new Map<string, bigint>(),
    seen = new Set<number>();
  let native = rpcAmount(lamports[0]),
    rent = 0n;
  for (const row of rows) {
    ensure(
      Number.isInteger(row.accountIndex) &&
        row.accountIndex > 0 &&
        row.accountIndex < w.totalKeys &&
        !seen.has(row.accountIndex) &&
        row.owner,
      "Token ownership evidence unavailable",
    );
    seen.add(row.accountIndex);
    read58(row.owner, 32);
    read58(row.mint, 32);
    if (row.owner !== owner) continue;
    const qty = uint(row.uiTokenAmount.amount),
      locked = rpcAmount(lamports[row.accountIndex]);
    const rentOnly = locked - (row.mint === WRAPPED_SOL ? qty : 0n);
    ensure(rentOnly >= 0n, "Inconsistent wrapped SOL reserve");
    rent += rentOnly;
    native += locked;
    tokens.set(row.mint, (tokens.get(row.mint) ?? 0n) + qty);
  }
  // Economic SOL balance includes the taker's fee account and the lamports of their token accounts.
  // The latter accounts for wrap/unwrap and ATA creation/closure without mislabelling rent as swap quantity.
  tokens.set(WRAPPED_SOL, native);
  return { tokens, rent };
}

export function actualFill(p: PinnedOrder, tx: WireTx, meta: Balances): ActualFill {
  ensure(
    meta?.err === null && tx.digest === p.messageHash && tx.signerKeys[0] === p.intent.taker,
    "Failed transaction or wrong message",
  );
  const before = sideBalances(meta.preTokenBalances, meta.preBalances, tx, p.intent.taker);
  const after = sideBalances(meta.postTokenBalances, meta.postBalances, tx, p.intent.taker);
  const fee = rpcAmount(meta.fee);
  const delta = (mint: string) =>
    (after.tokens.get(mint) ?? 0n) - (before.tokens.get(mint) ?? 0n) + (mint === WRAPPED_SOL ? fee : 0n);
  const input = -delta(p.intent.inputMint),
    output = delta(p.intent.outputMint),
    rent = after.rent - before.rent;
  ensure(
    input === uint(p.intent.inputAmount) && output >= uint(p.requiredOutput),
    "Actual wallet movement differs from approved swap",
  );
  for (const mint of before.tokens.keys())
    if (mint !== p.intent.inputMint && mint !== WRAPPED_SOL)
      ensure(delta(mint) >= 0n, "Another wallet asset was debited");
  const extra =
    p.intent.inputMint !== WRAPPED_SOL && p.intent.outputMint !== WRAPPED_SOL && delta(WRAPPED_SOL) < 0n
      ? -delta(WRAPPED_SOL)
      : 0n;
  ensure(
    fee + extra + (rent > 0n ? rent : 0n) <= uint(p.intent.maxNetworkAndRentLamports),
    "Actual network or rent cost exceeds the cap",
  );
  return {
    input: input.toString(),
    output: output.toString(),
    networkFeeLamports: fee.toString(),
    rentDeltaLamports: rent.toString(),
    otherNativeCostLamports: extra.toString(),
  };
}

export type SimulationReply = {
  context: { slot: number };
  value: Balances & { replacementBlockhash?: unknown };
};
/** Only pass a simulation obtained by the server directly for this exact wire on its trusted cluster RPC. */
export function prepareExecution(
  p: PinnedOrder,
  signed: string,
  sim: SimulationReply,
  now: number,
  height: string,
  minSlot = 0,
) {
  ensure(
    Number.isSafeInteger(now) && now < p.expiresAt && uint(height) <= uint(p.lastValidBlockHeight),
    "Expired approval or blockhash",
  );
  const { tx, txid } = bindSignature(p, signed);
  ensure(
    Number.isSafeInteger(sim.context.slot) && sim.context.slot >= minSlot && !sim.value.replacementBlockhash,
    "Stale simulation or replacement blockhash",
  );
  const expected = actualFill(p, tx, sim.value);
  return {
    txid,
    expected,
    request: {
      requestId: p.requestId,
      signedTransaction: signed,
      lastValidBlockHeight: p.lastValidBlockHeight,
    },
  };
}

type SignatureStatus = {
  slot: number;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  err: unknown;
};
type RpcReceipt = { slot: number; transaction: [string, "base64"]; meta: Balances | null };
export type Settlement =
  | { status: "awaiting_finality" | "failed" | "review" }
  | { status: "filled"; txid: string; slot: number; fill: ActualFill };
/** A transient error/missing receipt is unresolved. Never create a replacement order from this result. */
export function settle(
  p: PinnedOrder,
  persistedTxid: string,
  status: SignatureStatus | null,
  receipt: RpcReceipt | null,
): Settlement {
  read58(persistedTxid, 64);
  if (!status || status.confirmationStatus !== "finalized") return { status: "awaiting_finality" };
  if (!Number.isSafeInteger(status.slot) || status.slot < 0 || status.err === undefined)
    return { status: "review" };
  if (status.err !== null) return { status: "failed" };
  if (!receipt || !receipt.meta) return { status: "awaiting_finality" };
  if (
    receipt.slot !== status.slot ||
    !Array.isArray(receipt.transaction) ||
    receipt.transaction[1] !== "base64"
  )
    return { status: "review" };
  try {
    const { tx, txid } = bindSignature(p, receipt.transaction[0]);
    if (txid !== persistedTxid) return { status: "review" };
    return { status: "filled", txid, slot: receipt.slot, fill: actualFill(p, tx, receipt.meta) };
  } catch {
    return { status: "review" };
  }
}
