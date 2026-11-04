import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { decodeWire, read58, encode58, verifyEd25519 } from "./solana-wire";
import idl from "./raydium-cp-idl.json" with { type: "json" };

export { idl as CP_IDL };
export const CPMM = idl.address;
export const SPL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SOLANA_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SYSTEM = "11111111111111111111111111111111";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const poolDisc = Buffer.from([247, 237, 227, 245, 215, 195, 222, 70]);
const swapDisc = Buffer.from(idl.instructions[0].discriminator);
type Rpc = <T = unknown>(method: string, params: unknown[]) => Promise<T>;
type Meta = { key: string; write?: boolean; sign?: boolean };
type Ix = { program: string; accounts: Meta[]; data: Buffer };
type RpcAccount = {
  owner: string;
  data: [string, "base64"];
  executable: boolean;
  lamports: number;
};
type RpcContext<T> = { context: { slot: number }; value: T };
const no = (message: string): never => {
  throw Error(message);
};
function ok(value: unknown, message: string): asserts value {
  if (!value) no(message);
}
const pk = (key: string) => read58(key, 32);
const maxU64 = (1n << 64n) - 1n;
export function amount(v: string): bigint {
  ok(
    typeof v === "string" && /^(0|[1-9]\d{0,19})$/.test(v),
    "Invalid token amount.",
  );
  const n = BigInt(v);
  ok(n <= maxU64, "Amount exceeds u64.");
  return n;
}
const u64 = (v: string) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(amount(v));
  return b;
};
const sha = (...bs: Buffer[]) => {
  const hash = createHash("sha256");
  bs.forEach((b) => hash.update(b));
  return hash.digest();
};
const pda = (seeds: Buffer[], program: string) =>
  sha(...seeds, pk(program), Buffer.from("ProgramDerivedAddress"));
export function associated(owner: string, mint: string) {
  for (let bump = 255; bump >= 0; bump--) {
    const address = pda(
      [pk(owner), pk(SPL), pk(mint), Buffer.from([bump])],
      ATA,
    );
    try {
      ed25519.ExtendedPoint.fromHex(address);
    } catch {
      return encode58(address);
    }
  }
  return no("Could not derive token account.");
}
const meta = (key: string, write = false, sign = false): Meta => ({
  key,
  write,
  sign,
});
const len = (n: number) => {
  ok(Number.isInteger(n) && n >= 0 && n < 16384, "Invalid wire length.");
  return n < 128 ? Buffer.from([n]) : Buffer.from([(n & 127) | 128, n >> 7]);
};
function tx(payer: string, blockhash: string, instructions: Ix[]) {
  const flags = new Map<string, Meta>();
  const add = (m: Meta) => {
    pk(m.key);
    const old = flags.get(m.key);
    flags.set(m.key, {
      key: m.key,
      write: !!(old?.write || m.write),
      sign: !!(old?.sign || m.sign),
    });
  };
  add(meta(payer, true, true));
  for (const i of instructions) {
    i.accounts.forEach(add);
    add(meta(i.program));
  }
  const group = (v: Meta) => (v.sign ? (v.write ? 0 : 1) : v.write ? 2 : 3);
  const keys = [...flags.values()].sort((a, b) => group(a) - group(b)),
    index = (k: string) => keys.findIndex((v) => v.key === k);
  ok(
    keys[0].key === payer &&
      keys.filter((v) => v.sign).length === 1 &&
      keys.length <= 32,
    "Expected one fee payer.",
  );
  const inst = instructions.map((i) =>
    Buffer.concat([
      Buffer.from([index(i.program)]),
      len(i.accounts.length),
      Buffer.from(i.accounts.map((m) => index(m.key))),
      len(i.data.length),
      i.data,
    ]),
  );
  const msg = Buffer.concat([
    Buffer.from([1, 0, keys.filter((m) => !m.sign && !m.write).length]),
    len(keys.length),
    ...keys.map((m) => pk(m.key)),
    pk(blockhash),
    len(instructions.length),
    ...inst,
  ]);
  const unsigned = Buffer.concat([
    Buffer.from([1]),
    Buffer.alloc(64),
    msg,
  ]).toString("base64");
  decodeWire(unsigned);
  return unsigned;
}
function tokenState(v: RpcAccount | null) {
  ok(
    v && !v.executable && v.owner === SPL && v.data[1] === "base64",
    "A standard SPL token account is required.",
  );
  const b = Buffer.from(v.data[0], "base64");
  ok(
    b.length === 165 && b[108] === 1,
    "Token account not initialized or frozen.",
  );
  const tag = b.readUInt32LE(72);
  ok(tag === 0 || tag === 1, "Invalid delegate marker.");
  return {
    mint: encode58(b.subarray(0, 32)),
    owner: encode58(b.subarray(32, 64)),
    units: b.readBigUInt64LE(64),
    delegate: tag ? encode58(b.subarray(76, 108)) : null,
    allowance: b.readBigUInt64LE(121),
  };
}
function mintDecimals(v: RpcAccount | null) {
  ok(
    v && !v.executable && v.owner === SPL && v.data[1] === "base64",
    "The unattended lane only accepts the standard SPL program.",
  );
  const b = Buffer.from(v.data[0], "base64");
  ok(b.length === 82 && b[45] === 1, "Mint is uninitialized or extended.");
  return b[44];
}
export type SwapScope = {
  fundingOwner: string;
  executor: string;
  pool: string;
  inputMint: string;
  outputMint: string;
  inputAccount: string;
  outputAccount: string;
  unitsPerOrder: string;
  minimumOutputUnits: string;
  totalInputUnits: string;
  feeCapLamports: string;
  expiresAt: number;
};
export function validateScope(s: SwapScope, now: number) {
  for (const p of [
    s.fundingOwner,
    s.executor,
    s.pool,
    s.inputMint,
    s.outputMint,
    s.inputAccount,
    s.outputAccount,
  ])
    pk(p);
  ok(
    s.fundingOwner !== s.executor &&
      s.inputMint !== s.outputMint &&
      s.inputAccount !== s.outputAccount,
    "Separate execution and funding wallets and distinct mints are required.",
  );
  ok(
    associated(s.fundingOwner, s.inputMint) === s.inputAccount &&
      associated(s.fundingOwner, s.outputMint) === s.outputAccount,
    "Funding and settlement must use the owner's token accounts.",
  );
  ok(
    amount(s.unitsPerOrder) > 0n &&
      amount(s.totalInputUnits) >= amount(s.unitsPerOrder) &&
      amount(s.minimumOutputUnits) > 0n &&
      amount(s.feeCapLamports) > 0n &&
      amount(s.feeCapLamports) <= 100000n,
    "Invalid delegated amounts.",
  );
  ok(
    Number.isSafeInteger(s.expiresAt) &&
      s.expiresAt > now &&
      s.expiresAt - now <= 86400000,
    "Choose an expiry within 24 hours.",
  );
}
type Context = {
  authority: string;
  config: string;
  vaultIn: string;
  vaultOut: string;
  observation: string;
  slot: number;
  authorityDecimals: number;
  input: ReturnType<typeof tokenState>;
  outputExists: boolean;
};
async function context(s: SwapScope, rpc: Rpc): Promise<Context> {
  ok(
    (await rpc("getGenesisHash", [])) === SOLANA_GENESIS,
    "Wrong Solana cluster.",
  );
  const result = await rpc<RpcContext<(RpcAccount | null)[]>>(
    "getMultipleAccounts",
    [
      [s.pool, s.inputAccount, s.outputAccount, s.inputMint, s.outputMint],
      { encoding: "base64", commitment: "confirmed" },
    ],
  );
  ok(
    Number.isSafeInteger(result.context.slot) &&
      result.context.slot > 0 &&
      result.value.length === 5,
    "Unavailable canonical pool state.",
  );
  const [pool, input, output, fromMint, toMint] = result.value;
  ok(
    pool &&
      pool.owner === CPMM &&
      !pool.executable &&
      pool.data[1] === "base64",
    "Unknown pool program.",
  );
  const b = Buffer.from(pool.data[0], "base64"),
    key = (i: number) => encode58(b.subarray(8 + 32 * i, 8 + 32 * (i + 1)));
  ok(
    b.length >= 333 &&
      b.subarray(0, 8).equals(poolDisc) &&
      key(7) === SPL &&
      key(8) === SPL,
    "Unverified pool layout or extended token.",
  );
  ok((b[329] & 4) === 0, "Swaps are disabled on this pool.");
  const forward = key(5) === s.inputMint && key(6) === s.outputMint;
  ok(
    forward || (key(6) === s.inputMint && key(5) === s.outputMint),
    "Pool mints do not match.",
  );
  const source = tokenState(input);
  ok(
    source.owner === s.fundingOwner && source.mint === s.inputMint,
    "Invalid funding account owner or mint.",
  );
  if (output) {
    const out = tokenState(output);
    ok(
      out.owner === s.fundingOwner && out.mint === s.outputMint,
      "Invalid receiving account.",
    );
  }
  const dec = mintDecimals(fromMint);
  mintDecimals(toMint);
  return {
    authority: encode58(
      pda(
        [Buffer.from("vault_and_lp_mint_auth_seed"), Buffer.from([b[328]])],
        CPMM,
      ),
    ),
    config: key(0),
    vaultIn: key(forward ? 2 : 3),
    vaultOut: key(forward ? 3 : 2),
    observation: key(9),
    slot: result.context.slot,
    authorityDecimals: dec,
    input: source,
    outputExists: !!output,
  };
}
type Head = RpcContext<{ blockhash: string; lastValidBlockHeight: number }>;
const head = (rpc: Rpc, minContextSlot?: number) =>
  rpc<Head>("getLatestBlockhash", [
    { commitment: "confirmed", ...(minContextSlot ? { minContextSlot } : {}) },
  ]);
export type FundingApproval = {
  unsigned: string;
  expiresAtBlock: number;
  splDelegate: string;
  inputMint: string;
  totalInputUnits: string;
  createsReceivingAccount: boolean;
};
/** Owner-only preparation. An unrelated existing delegate cannot be silently superseded. */
export async function fundingApproval(
  s: SwapScope,
  rpc: Rpc,
  now = Date.now(),
): Promise<FundingApproval> {
  validateScope(s, now);
  const c = await context(s, rpc);
  ok(
    c.input.delegate === null || c.input.delegate === s.executor,
    "The source account already delegates to another address.",
  );
  const instructions: Ix[] = [];
  if (!c.outputExists)
    instructions.push({
      program: ATA,
      accounts: [
        meta(s.fundingOwner, true, true),
        meta(s.outputAccount, true),
        meta(s.fundingOwner),
        meta(s.outputMint),
        meta(SYSTEM),
        meta(SPL),
      ],
      data: Buffer.from([1]),
    });
  instructions.push({
    program: SPL,
    accounts: [
      meta(s.inputAccount, true),
      meta(s.inputMint),
      meta(s.executor),
      meta(s.fundingOwner, false, true),
    ],
    data: Buffer.concat([
      Buffer.from([13]),
      u64(s.totalInputUnits),
      Buffer.from([c.authorityDecimals]),
    ]),
  });
  const h = await head(rpc, c.slot);
  return {
    unsigned: tx(s.fundingOwner, h.value.blockhash, instructions),
    expiresAtBlock: h.value.lastValidBlockHeight,
    splDelegate: s.executor,
    inputMint: s.inputMint,
    totalInputUnits: s.totalInputUnits,
    createsReceivingAccount: !c.outputExists,
  };
}
export async function fundingRevoke(s: SwapScope, rpc: Rpc) {
  const c = await context(s, rpc);
  ok(
    c.input.delegate === s.executor,
    "Refusing to revoke a different or absent delegate.",
  );
  const h = await head(rpc, c.slot);
  return {
    unsigned: tx(s.fundingOwner, h.value.blockhash, [
      {
        program: SPL,
        accounts: [
          meta(s.inputAccount, true),
          meta(s.fundingOwner, false, true),
        ],
        data: Buffer.from([5]),
      },
    ]),
    expiresAtBlock: h.value.lastValidBlockHeight,
  };
}
export async function verifyAllowance(
  s: SwapScope,
  rpc: Rpc,
  activating = false,
) {
  const c = await context(s, rpc);
  ok(
    c.outputExists &&
      c.input.delegate === s.executor &&
      c.input.allowance >= amount(s.unitsPerOrder) &&
      c.input.allowance <= amount(s.totalInputUnits) &&
      (!activating || c.input.allowance === amount(s.totalInputUnits)),
    "The expected bounded token delegation is not active.",
  );
  return c;
}
export type DirectPin = {
  unsigned: string;
  digest: string;
  blockhash: string;
  lastValidBlockHeight: number;
  minimumOut: string;
  slot: number;
  scope: SwapScope;
  expectedOut: string;
  fee: string;
};
function swapIxs(s: SwapScope, c: Context, minimum: string): Ix[] {
  return [
    {
      program: CPMM,
      data: Buffer.concat([swapDisc, u64(s.unitsPerOrder), u64(minimum)]),
      accounts: [
        meta(s.executor, false, true),
        meta(c.authority),
        meta(c.config),
        meta(s.pool, true),
        meta(s.inputAccount, true),
        meta(s.outputAccount, true),
        meta(c.vaultIn, true),
        meta(c.vaultOut, true),
        meta(SPL),
        meta(SPL),
        meta(s.inputMint),
        meta(s.outputMint),
        meta(c.observation, true),
      ],
    },
  ];
}
type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string };
};
type Evidence = {
  err: unknown;
  fee?: number;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
};
function amounts(s: SwapScope, wire: string, e: Evidence, min: string) {
  const decoded = decodeWire(wire),
    keys = decoded.accountKeys;
  ok(
    e &&
      e.err === null &&
      Array.isArray(e.preTokenBalances) &&
      Array.isArray(e.postTokenBalances) &&
      e.preBalances?.length === keys.length &&
      e.postBalances?.length === keys.length,
    "Missing standard balance evidence.",
  );
  const delta = (key: string, mint: string) => {
    const ix = keys.indexOf(key);
    ok(ix >= 0, "Token account missing from message.");
    const side = (balances: TokenBalance[]) => {
      const entries = balances.filter((t) => t.accountIndex === ix);
      ok(
        entries.length === 1 &&
          entries[0].owner === s.fundingOwner &&
          entries[0].mint === mint &&
          entries[0].programId === SPL,
        "Token evidence did not prove the owner and mint.",
      );
      return amount(entries[0].uiTokenAmount.amount);
    };
    return side(e.postTokenBalances) - side(e.preTokenBalances);
  };
  const used = -delta(s.inputAccount, s.inputMint),
    received = delta(s.outputAccount, s.outputMint);
  const pre = e.preBalances[0],
    post = e.postBalances[0];
  ok(
    Number.isSafeInteger(pre) &&
      Number.isSafeInteger(post) &&
      pre >= post &&
      post >= 0,
    "Fee evidence unavailable.",
  );
  const fee = BigInt(pre - post);
  ok(
    used === amount(s.unitsPerOrder) &&
      received >= amount(min) &&
      fee <= amount(s.feeCapLamports) &&
      Number.isSafeInteger(e.fee) &&
      fee === BigInt(e.fee!),
    "Spend, output or fee is outside the signed policy.",
  );
  return {
    input: used.toString(),
    output: received.toString(),
    fee: fee.toString(),
  };
}
async function simulate(
  s: SwapScope,
  rpc: Rpc,
  wire: string,
  verify: boolean,
  slot: number,
  min: string,
) {
  // Standard nodes may omit simulation pre/post balance arrays. Request the exact post-state accounts and
  // bracket the simulation with confirmed reads. Changed baseline or reordered context cannot authorize a trade.
  const keys = [s.executor, s.inputAccount, s.outputAccount],
    cfg = { encoding: "base64", commitment: "confirmed", minContextSlot: slot };
  const before = await rpc<RpcContext<(RpcAccount | null)[]>>(
    "getMultipleAccounts",
    [keys, cfg],
  );
  const v = await rpc<
    RpcContext<Evidence & { accounts?: (RpcAccount | null)[] }>
  >("simulateTransaction", [
    wire,
    {
      ...cfg,
      accounts: { encoding: "base64", addresses: keys },
      minContextSlot: before.context.slot,
      replaceRecentBlockhash: false,
      sigVerify: verify,
    },
  ]);
  ok(
    v.context.slot >= before.context.slot &&
      before.context.slot >= slot &&
      v.value.err === null,
    "Simulation failed or is stale.",
  );
  if (
    Array.isArray(v.value.preBalances) &&
    Array.isArray(v.value.postBalances) &&
    Array.isArray(v.value.preTokenBalances) &&
    Array.isArray(v.value.postTokenBalances) &&
    Number.isSafeInteger(v.value.fee)
  )
    return amounts(s, wire, v.value, min);
  const after = await rpc<RpcContext<(RpcAccount | null)[]>>(
    "getMultipleAccounts",
    [keys, { ...cfg, minContextSlot: v.context.slot }],
  );
  ok(
    after.context.slot >= v.context.slot &&
      before.value.length === 3 &&
      after.value.length === 3 &&
      v.value.accounts?.length === 3,
    "Missing simulated account proof.",
  );
  const same = (a: RpcAccount | null, b: RpcAccount | null) =>
    !!a &&
    !!b &&
    a.lamports === b.lamports &&
    a.owner === b.owner &&
    a.executable === b.executable &&
    a.data?.[0] === b.data?.[0] &&
    a.data[1] === b.data[1];
  ok(
    before.value.every((a, i) => same(a, after.value[i])),
    "Account state changed during simulation.",
  );
  const [preP, preIn, preOut] = before.value,
    [postP, postIn, postOut] = v.value.accounts;
  const system = (a: RpcAccount | null) =>
    !!a &&
    a.owner === SYSTEM &&
    !a.executable &&
    a.data?.[0] === "" &&
    Number.isSafeInteger(a.lamports) &&
    a.lamports >= 0;
  ok(system(preP) && system(postP), "Unexpected fee account state.");
  const pi = tokenState(preIn),
    qi = tokenState(postIn),
    po = tokenState(preOut),
    qo = tokenState(postOut);
  ok(
    [pi, qi, po, qo].every((t) => t.owner === s.fundingOwner) &&
      pi.mint === s.inputMint &&
      qi.mint === pi.mint &&
      po.mint === s.outputMint &&
      qo.mint === po.mint,
    "Simulated token identity changed.",
  );
  const used = pi.units - qi.units,
    received = qo.units - po.units,
    fee = BigInt(preP!.lamports - postP!.lamports);
  const quote = await rpc<RpcContext<number | null>>("getFeeForMessage", [
    decodeWire(wire).message.toString("base64"),
    { commitment: "confirmed", minContextSlot: v.context.slot },
  ]);
  ok(
    used === amount(s.unitsPerOrder) &&
      received >= amount(min) &&
      fee >= 0n &&
      fee <= amount(s.feeCapLamports) &&
      quote.value !== null &&
      Number.isSafeInteger(quote.value) &&
      BigInt(quote.value) === fee,
    "Signed fee or simulated balances exceed the intent.",
  );
  return { input: String(used), output: String(received), fee: String(fee) };
}
/** Requires a live scope minted by the server. The estimate is measured by a real simulation, then tightened to slippage and simulated again. */
export async function prepareDirect(
  s: SwapScope,
  rpc: Rpc,
  slippageBps: number,
  now = Date.now(),
  independentFloor = "0",
) {
  validateScope(s, now);
  ok(
    Number.isInteger(slippageBps) && slippageBps >= 0 && slippageBps <= 100,
    "Maximum slippage is 100 bps.",
  );
  const c = await verifyAllowance(s, rpc),
    h = await head(rpc, c.slot);
  ok(
    c.input.units >= amount(s.unitsPerOrder) &&
      Number.isSafeInteger(h.value.lastValidBlockHeight) &&
      h.context.slot >= c.slot,
    "Funding or recent blockhash unavailable.",
  );
  const make = (floor: string) =>
    tx(s.executor, h.value.blockhash, swapIxs(s, c, floor));
  const early = await simulate(
    s,
    rpc,
    make(s.minimumOutputUnits),
    false,
    h.context.slot,
    s.minimumOutputUnits,
  );
  const slippageFloor =
    (amount(early.output) * BigInt(10000 - slippageBps)) / 10000n;
  const minimum = [
    slippageFloor,
    amount(s.minimumOutputUnits),
    amount(independentFloor),
  ]
    .reduce((a, b) => (a > b ? a : b))
    .toString();
  const wire = make(minimum);
  const expected = await simulate(s, rpc, wire, false, h.context.slot, minimum);
  const output: DirectPin = {
    unsigned: wire,
    digest: decodeWire(wire).digest,
    scope: structuredClone(s),
    blockhash: h.value.blockhash,
    lastValidBlockHeight: h.value.lastValidBlockHeight,
    minimumOut: minimum,
    slot: h.context.slot,
    expectedOut: expected.output,
    fee: expected.fee,
  };
  return output;
}
export async function verifyUnsigned(pin: DirectPin, rpc: Rpc, now: number) {
  validateScope(pin.scope, now);
  const c = await verifyAllowance(pin.scope, rpc);
  ok(
    amount(pin.minimumOut) >= amount(pin.scope.minimumOutputUnits) &&
      tx(
        pin.scope.executor,
        pin.blockhash,
        swapIxs(pin.scope, c, pin.minimumOut),
      ) === pin.unsigned &&
      decodeWire(pin.unsigned).digest === pin.digest,
    "Pinned transaction differs from permitted swap.",
  );
  const height = await rpc<number>("getBlockHeight", [
    { commitment: "confirmed", minContextSlot: pin.slot },
  ]);
  ok(
    Number.isSafeInteger(height) && height <= pin.lastValidBlockHeight,
    "Swap blockhash expired.",
  );
  return simulate(
    pin.scope,
    rpc,
    pin.unsigned,
    false,
    Math.max(pin.slot, c.slot),
    pin.minimumOut,
  );
}
export function bindSigned(pin: DirectPin, wire: string) {
  const tx = decodeWire(wire);
  ok(
    tx.message.equals(decodeWire(pin.unsigned).message) &&
      tx.signerKeys.length === 1 &&
      tx.signerKeys[0] === pin.scope.executor &&
      verifyEd25519(pin.scope.executor, tx.message, tx.signatures[0]),
    "The signed transaction does not match the approved message.",
  );
  return encode58(tx.signatures[0]);
}
export async function verifySigned(
  pin: DirectPin,
  rpc: Rpc,
  wire: string,
  now = Date.now(),
) {
  await verifyUnsigned(pin, rpc, now);
  const txid = bindSigned(pin, wire);
  const actual = await simulate(
    pin.scope,
    rpc,
    wire,
    true,
    pin.slot,
    pin.minimumOut,
  );
  return { txid, actual };
}
export async function finalizedDirect(pin: DirectPin, rpc: Rpc, txid: string) {
  read58(txid, 64);
  ok(
    (await rpc("getGenesisHash", [])) === SOLANA_GENESIS,
    "Incorrect Solana network.",
  );
  const s = await rpc<
    RpcContext<
      ({ slot: number; confirmationStatus: string; err: unknown } | null)[]
    >
  >("getSignatureStatuses", [[txid], { searchTransactionHistory: true }]);
  const v = s.value[0];
  if (v?.confirmationStatus !== "finalized" || v.err === undefined)
    return { status: "pending" } as const;
  const receipt = await rpc<{
    slot: number;
    blockTime?: number;
    transaction: [string, "base64"];
    meta: Evidence;
  } | null>("getTransaction", [
    txid,
    {
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
      commitment: "finalized",
    },
  ]);
  if (!receipt) return { status: "pending" } as const;
  ok(
    receipt.slot === v.slot && bindSigned(pin, receipt.transaction[0]) === txid,
    "Receipt does not prove the prepared transaction.",
  );
  const fee = receipt.meta?.fee;
  ok(
    typeof fee === "number" && Number.isSafeInteger(fee) && fee >= 0,
    "Missing finalized transaction fee.",
  );
  if (v.err !== null) {
    ok(receipt.meta?.err != null, "Receipt contradicts failed status.");
    return { status: "failed", txid, slot: v.slot, fee: String(fee) } as const;
  }
  ok(
    Number.isSafeInteger(receipt.blockTime) && receipt.blockTime! > 0,
    "Missing authoritative block time.",
  );
  return {
    status: "filled",
    txid,
    slot: v.slot,
    at: receipt.blockTime! * 1000,
    fill: amounts(
      pin.scope,
      receipt.transaction[0],
      receipt.meta,
      pin.minimumOut,
    ),
  } as const;
}
export async function discoverDirectPool(
  inputMint: string,
  outputMint: string,
  send: typeof fetch = fetch,
) {
  pk(inputMint);
  pk(outputMint);
  ok(inputMint !== outputMint, "Mints must differ.");
  const q = new URLSearchParams({
    mint1: inputMint,
    mint2: outputMint,
    poolType: "standard",
    poolSortField: "liquidity",
    sortType: "desc",
    pageSize: "30",
    page: "1",
  });
  const response = await send(
    "https://api-v3.raydium.io/pools/info/mint?" + q,
    { redirect: "error", signal: AbortSignal.timeout(6000) },
  );
  ok(response.ok, "Raydium pair lookup unavailable.");
  const r = (await response.json()) as {
    success: boolean;
    data: {
      data: {
        id: string;
        programId: string;
        mintA: { address: string };
        mintB: { address: string };
      }[];
    };
  };
  const pair =
    r.success &&
    r.data?.data.find(
      (p) =>
        p.programId === CPMM &&
        [p.mintA?.address, p.mintB?.address].includes(inputMint) &&
        [p.mintA?.address, p.mintB?.address].includes(outputMint),
    );
  ok(pair, "No direct Raydium CPMM pool for this pair.");
  pk(pair.id);
  return pair.id;
}

export async function makeFundingBundle(
  scopes: SwapScope[],
  rpc: Rpc,
  now = Date.now(),
) {
  ok(scopes.length > 0 && scopes.length <= 8, "Bundle size exceeded.");
  const s = scopes[0],
    all = await Promise.all(
      scopes.map(async (x) => {
        validateScope(x, now);
        ok(
          x.inputAccount === s.inputAccount &&
            s.executor === x.executor &&
            x.totalInputUnits === s.totalInputUnits &&
            x.fundingOwner === s.fundingOwner,
          "Inconsistent delegate funding.",
        );
        return { s: x, c: await context(x, rpc) };
      }),
    );
  const first = all[0].c;
  ok(
    !first.input.delegate || first.input.delegate === s.executor,
    "The source account already has a different delegate.",
  );
  const missing = new Map(
    all
      .filter((x) => !x.c.outputExists)
      .map(({ s }) => [s.outputAccount, s.outputMint]),
  );
  const ix: Ix[] = [...missing].map(([key, mint]) => ({
    program: ATA,
    accounts: [
      meta(s.fundingOwner, true, true),
      meta(key, true),
      meta(s.fundingOwner),
      meta(mint),
      meta(SYSTEM),
      meta(SPL),
    ],
    data: Buffer.from([1]),
  }));
  ix.push({
    program: SPL,
    accounts: [
      meta(s.inputAccount, true),
      meta(s.inputMint),
      meta(s.executor),
      meta(s.fundingOwner, false, true),
    ],
    data: Buffer.concat([
      Buffer.from([13]),
      u64(s.totalInputUnits),
      Buffer.from([first.authorityDecimals]),
    ]),
  });
  const h = await head(rpc, Math.max(...all.map((x) => x.c.slot))),
    unsigned = tx(s.fundingOwner, h.value.blockhash, ix);
  const [fee, rent] = await Promise.all([
    rpc<RpcContext<number | null>>("getFeeForMessage", [
      decodeWire(unsigned).message.toString("base64"),
      { commitment: "confirmed", minContextSlot: h.context.slot },
    ]),
    missing.size
      ? rpc<number>("getMinimumBalanceForRentExemption", [
          165,
          { commitment: "confirmed" },
        ])
      : Promise.resolve(0),
  ]);
  ok(
    Number.isSafeInteger(fee.value) &&
      fee.value !== null &&
      fee.value >= 0 &&
      fee.value <= 100000 &&
      Number.isSafeInteger(rent) &&
      rent >= 0 &&
      rent <= 4000000,
    "Unverified setup fee or rent estimate.",
  );
  return {
    unsigned,
    expiresAtBlock: h.value.lastValidBlockHeight,
    createsReceivingAccounts: [...missing.keys()],
    estimatedFeeLamports: String(fee.value),
    estimatedRentLamports: String(BigInt(missing.size) * BigInt(rent)),
  };
}
export function bindSetup(unsigned: string, signed: string, owner: string) {
  const a = decodeWire(unsigned),
    b = decodeWire(signed);
  ok(
    a.message.equals(b.message) &&
      b.signerKeys.length === 1 &&
      b.signerKeys[0] === owner &&
      verifyEd25519(owner, b.message, b.signatures[0]),
    "The funding wallet signed a different setup request.",
  );
  return encode58(b.signatures[0]);
}
export async function broadcastExact(rpc: Rpc, wire: string, txid: string) {
  ok(
    (await rpc("getGenesisHash", [])) === SOLANA_GENESIS,
    "Unknown Solana cluster.",
  );
  ok(
    encode58(decodeWire(wire).signatures[0]) === txid,
    "Broadcast identity differs from durable receipt ID.",
  );
  const response = await rpc<string>("sendTransaction", [
    wire,
    {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 0,
    },
  ]);
  ok(
    response === txid,
    "The network did not acknowledge the original transaction ID.",
  );
}
export function solanaRpc(
  rpcUrl: string | undefined,
  http: typeof fetch = fetch,
): Rpc {
  const url = new URL(rpcUrl || "https://api.mainnet-beta.solana.com");
  ok(
    url.protocol === "https:" && !url.username && !url.password,
    "A trusted HTTPS Solana RPC is required.",
  );
  return async <T>(method: string, params: unknown[]) => {
    const r = await http(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(9000),
    });
    ok(r.ok, "Solana request unavailable.");
    const j = (await r.json()) as {
      jsonrpc: string;
      id: number;
      result: T;
      error?: unknown;
    };
    ok(
      j.id === 1 && j.jsonrpc === "2.0" && !j.error && j.result !== undefined,
      "Solana could not verify " + method,
    );
    return j.result;
  };
}
