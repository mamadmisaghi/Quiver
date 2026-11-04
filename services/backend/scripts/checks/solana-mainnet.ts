import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  SolanaMainnet,
  USDC_MINT,
  MAINNET_GENESIS,
  NATIVE_FEES,
  associated,
} from "../../src/execution/solana-mainnet";
import {
  compileMetisV0,
  type JupiterBuild,
  type MetaIx,
} from "../../src/execution/solana-build-wire";
import { makeSolanaDriver } from "../../src/execution/solana-live-driver";
import { decodeWire, encode58, read58 } from "../../src/execution/solana-wire";
import {
  WRAPPED_SOL,
  type SwapIntent,
} from "../../src/execution/solana-jupiter";
import type {
  Action,
  LiveProgram,
  WalletBudget,
} from "../../src/execution/live-program";
const SYSTEM = "11111111111111111111111111111111",
  TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  CP = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  ALT = "AddressLookupTab1e1111111111111111111111111",
  MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  COMP = "ComputeBudget111111111111111111111111111111",
  OWNER = "quiver_user_test";
const key = (s: string) => encode58(createHash("sha256").update(s).digest());
const addr = key("test-mint"),
  event = key("event"),
  vault = key("vault"),
  table = key("alt");
const pair = generateKeyPairSync("ed25519"),
  wallet = encode58(
    pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
const input = associated(wallet, USDC_MINT, TOKEN),
  output = associated(wallet, addr, TOKEN);
const ix = (
  programId: string,
  keys: [string, boolean, boolean?][],
  data: Buffer,
): MetaIx => ({
  programId,
  accounts: keys.map(([pubkey, isWritable, isSigner = false]) => ({
    pubkey,
    isWritable,
    isSigner,
  })),
  data: data.toString("base64"),
});
const u64 = (v: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    return b;
  },
  u16 = (v: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    return b;
  },
  u32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    return b;
  };
const hash = (n: string) =>
  createHash("sha256")
    .update("global:" + n)
    .digest()
    .subarray(0, 8);
const sizes = {
  input: 1250000n,
  output: 625000000n,
  network: 5000n,
  rent: 2039280n,
};
const slot = 72400000,
  at = 1800000000000,
  blockTime = at / 1000,
  blockheight = 71000000,
  blockhash = key("block");
const build: JupiterBuild = {
  inputMint: USDC_MINT,
  outputMint: addr,
  inAmount: String(sizes.input),
  outAmount: String(sizes.output),
  otherAmountThreshold: "621875000",
  swapMode: "ExactIn",
  slippageBps: 50,
  priceImpactPct: "0.0001",
  transactionVersion: 0,
  computeBudgetInstructions: [],
  setupInstructions: [
    ix(
      ATA,
      [
        [wallet, true, true],
        [output, true],
        [wallet, false],
        [addr, false],
        [SYSTEM, false],
        [TOKEN, false],
      ],
      Buffer.from([1]),
    ),
  ],
  swapInstruction: ix(
    JUP,
    [
      [wallet, false, true],
      [input, true],
      [output, true],
      [USDC_MINT, false],
      [addr, false],
      [TOKEN, false],
      [TOKEN, false],
      [JUP, false],
      [event, false],
      [JUP, false],
      [CP, false],
      [vault, true],
    ],
    Buffer.concat([
      hash("route_v2"),
      u64(sizes.input),
      u64(sizes.output),
      u16(50),
      u16(0),
      u16(0),
      u32(1),
      Buffer.from([46]),
      u16(10000),
      Buffer.from([0, 1]),
    ]),
  ),
  addressesByLookupTableAddress: {
    [table]: [input, output, USDC_MINT, addr, CP, vault],
  },
  blockhashWithMetadata: {
    blockhash: [...read58(blockhash, 32)],
    lastValidBlockHeight: blockheight + 100,
  },
};
const mk = (
  owner: string,
  lamports: number | bigint,
  bytes: Buffer,
  executable = false,
) => ({
  owner,
  lamports: Number(lamports),
  data: [bytes.toString("base64"), "base64"] as [string, "base64"],
  executable,
  space: bytes.length,
});
const mint = () => {
  const d = Buffer.alloc(82);
  d[44] = 6;
  d[45] = 1;
  return mk(TOKEN, 1500000, d);
};
const ta = (address: string, owner: string, n: bigint) => {
  const b = Buffer.alloc(165);
  read58(address, 32).copy(b);
  read58(owner, 32).copy(b, 32);
  b.writeBigUInt64LE(n, 64);
  b[108] = 1;
  return mk(TOKEN, sizes.rent, b);
};
let ledger = new Map<string, ReturnType<typeof mk> | null>();
ledger.set(wallet, mk(SYSTEM, 100000000, Buffer.alloc(0)));
ledger.set(USDC_MINT, mint());
ledger.set(addr, mint());
ledger.set(input, ta(USDC_MINT, wallet, 20000000n));
ledger.set(output, null);
ledger.set(vault, ta(addr, key("pool"), 60000000000n));
for (const a of [CP, ATA, TOKEN, SYSTEM, JUP, COMP, MEMO])
  ledger.set(a, mk(key("loader"), 1, Buffer.alloc(0), true));
const lt = Buffer.alloc(56);
lt.writeUInt32LE(1);
lt.writeBigUInt64LE(2n ** 64n - 1n, 4);
lt.writeBigUInt64LE(BigInt(slot - 4), 12);
ledger.set(
  table,
  mk(
    ALT,
    5000000,
    Buffer.concat([
      lt,
      ...build.addressesByLookupTableAddress![table].map((s) => read58(s, 32)),
    ]),
  ),
);
const post = [
  mk(SYSTEM, 100000000n - sizes.rent - sizes.network, Buffer.alloc(0)),
  ta(USDC_MINT, wallet, 20000000n - sizes.input),
  ta(addr, wallet, sizes.output),
];
let current = structuredClone(build),
  net = MAINNET_GENESIS,
  useMeta = true,
  alterAuth = false,
  badTable = false,
  mode: "missing" | "filled" | "failed" = "missing",
  sent: string | null = null;
const context = <T>(value: T, atSlot = slot) => ({
  context: { slot: atSlot },
  value,
});
const rawToken = (index: number, mint: string, qty: bigint) => ({
  accountIndex: index,
  mint,
  owner: wallet,
  uiTokenAmount: { amount: qty.toString() },
});
function resolve(raw: string) {
  const tx = decodeWire(raw),
    ws: string[] = [],
    rs: string[] = [];
  for (const t of tx.lookups) {
    const keys = build.addressesByLookupTableAddress![t.table];
    ws.push(...t.writable.map((i) => keys[i]));
    rs.push(...t.readonly.map((i) => keys[i]));
  }
  return {
    tx,
    keys: [...tx.accountKeys, ...ws, ...rs],
    loadedAddresses: { writable: ws, readonly: rs },
  };
}
function meta(raw: string, failed = false) {
  const { keys, loadedAddresses } = resolve(raw),
    preBalances = keys.map((k) => ledger.get(k)?.lamports ?? 0),
    postBalances = preBalances.slice(),
    src = keys.indexOf(input),
    dst = keys.indexOf(output);
  postBalances[0] -= Number(sizes.network);
  if (!failed) {
    postBalances[0] -= Number(sizes.rent);
    postBalances[dst] = Number(sizes.rent);
  }
  return {
    err: failed ? { InstructionError: [2, "Custom"] } : null,
    fee: Number(sizes.network),
    preBalances,
    postBalances,
    loadedAddresses,
    preTokenBalances: [rawToken(src, USDC_MINT, 20000000n)],
    postTokenBalances: failed
      ? [rawToken(src, USDC_MINT, 20000000n)]
      : [
          rawToken(src, USDC_MINT, 20000000n - sizes.input),
          rawToken(dst, addr, sizes.output),
        ],
  };
}
const fetcher: typeof fetch = async (inputUrl, init) => {
  const url = new URL(String(inputUrl));
  if (url.origin === "https://api.jup.ag") {
    assert.equal(new Headers(init?.headers).get("x-api-key"), null);
    assert.equal(init?.redirect, "error");
    if (url.pathname === "/price/v3")
      return Response.json({
        [USDC_MINT]: { usdPrice: 1, blockId: slot, decimals: 6 },
        [addr]: { usdPrice: 0.002, blockId: slot, decimals: 6 },
      });
    assert.equal(url.pathname, "/swap/v2/build");
    assert.equal(url.searchParams.get("taker"), wallet);
    assert.equal(url.searchParams.get("receiver"), null);
    return Response.json(current);
  }
  assert.equal(url.origin, "https://api.mainnet-beta.solana.com");
  const j = JSON.parse(String(init?.body)),
    p = j.params;
  let result: unknown;
  if (j.method === "getGenesisHash") result = net;
  else if (j.method === "getSlot") result = slot;
  else if (j.method === "getBlockHeight") result = blockheight;
  else if (j.method === "isBlockhashValid") result = context(true);
  else if (j.method === "getMultipleAccounts") {
    result = context(
      p[0].map((address: string) => {
        const a = ledger.get(address) ?? null;
        return badTable && address === table && a ? { ...a, owner: SYSTEM } : a;
      }),
    );
  } else if (j.method === "getFeeForMessage")
    result = context(Number(sizes.network));
  else if (j.method === "simulateTransaction") {
    const { loadedAddresses } = resolve(p[0]);
    const snap = structuredClone(post);
    if (alterAuth) {
      const raw = Buffer.from(snap[2].data[0], "base64");
      raw.writeUInt32LE(1, 72);
      snap[2].data[0] = raw.toString("base64");
    }
    result = context({
      ...(useMeta ? meta(p[0]) : { err: null, loadedAddresses }),
      accounts: snap,
      replacementBlockhash: null,
    });
  } else if (j.method === "sendTransaction") {
    assert.equal(p[1].skipPreflight, false);
    assert.equal(p[1].maxRetries, 0);
    assert(!sent);
    sent = p[0];
    result = encode58(decodeWire(p[0]).signatures[0]);
  } else if (j.method === "getSignatureStatuses")
    result = context([
      mode === "missing"
        ? null
        : {
            slot,
            confirmationStatus: "finalized",
            err: mode === "failed" ? { InstructionError: [2, "Custom"] } : null,
          },
    ]);
  else if (j.method === "getTransaction")
    result = sent
      ? {
          slot,
          blockTime,
          transaction: [sent, "base64"],
          meta: meta(sent, mode === "failed"),
        }
      : null;
  else throw Error("Unexpected method " + j.method);
  return Response.json({ id: 1, jsonrpc: "2.0", result });
};
const venue = new SolanaMainnet({ fetch: fetcher, now: () => at });
const intent: SwapIntent = {
  ownerId: OWNER,
  intentId: "intent_test",
  taker: wallet,
  inputMint: USDC_MINT,
  outputMint: addr,
  inputAmount: String(sizes.input),
  minOutput: "621800000",
  maxImpactBps: 50,
  maxSwapFeeBps: 0,
  maxSlippageBps: 50,
  maxNetworkAndRentLamports: "2500000",
  expiresAt: at + 60000,
};
let passed = 0;
const pass = (name: string) => {
  passed++;
  console.log("PASS " + name);
};
const cached = await venue.quote(intent),
  pin = cached.pin;
assert.equal(cached.expected.input, String(sizes.input));
assert.equal(cached.expected.output, String(sizes.output));
assert.equal(cached.expected.networkFeeLamports, String(sizes.network));
assert.equal(cached.expected.rentDeltaLamports, String(sizes.rent));
assert(decodeWire(pin.unsigned).lookups.length);
pass(
  "keyless self-managed Metis v0 build with real address-table layout and exact simulated balances",
);
const bind = (text: string) => {
  const tx = decodeWire(text);
  return Buffer.concat([
    Buffer.of(1),
    sign(null, tx.message, pair.privateKey),
    tx.message,
  ]).toString("base64");
};
const signed = bind(pin.unsigned),
  signature = encode58(decodeWire(signed).signatures[0]);
useMeta = false;
assert.deepEqual((await venue.simulate(pin, signed)).expected, cached.expected);
useMeta = true;
pass(
  "signed standard-RPC account-snapshot evidence agrees with atomic transaction metadata",
);
alterAuth = true;
await assert.rejects(venue.simulate(pin, signed), /delegate|authority/);
alterAuth = false;
badTable = true;
await assert.rejects(venue.simulate(pin), /lookup table/);
badTable = false;
net = "wrong";
await assert.rejects(venue.simulate(pin), /genesis/);
net = MAINNET_GENESIS;
await assert.rejects(venue.broadcast(pin, signed, key("other")), /ID differs/);
pass(
  "authority drainer, rogue lookup, foreign cluster and swapped signature ID fail closed",
);
const tamper = async (change: (b: JupiterBuild) => void, m: RegExp) => {
  const v = structuredClone(build);
  change(v);
  const unsigned = compileMetisV0(wallet, v);
  const w = decodeWire(unsigned);
  await assert.rejects(
    venue.simulate({ ...pin, unsigned, messageHash: w.digest }),
    m,
  );
};
await tamper((b) => {
  b.swapInstruction.accounts[2].pubkey = key("attacker");
}, /associated|wallet accounts/);
await tamper((b) => {
  const d = Buffer.from(b.swapInstruction.data, "base64");
  d.writeBigUInt64LE(2n, 16);
  b.swapInstruction.data = d.toString("base64");
}, /minimum output/);
await tamper((b) => {
  b.swapInstruction.data = Buffer.concat([
    Buffer.from(b.swapInstruction.data, "base64"),
    u64(sizes.input),
    u64(sizes.output),
  ]).toString("base64");
}, /Extra data/);
await tamper((b) => {
  b.otherInstructions = [
    ix(
      TOKEN,
      [
        [input, true],
        [key("attacker"), false],
        [wallet, false, true],
      ],
      Buffer.concat([Buffer.of(4), u64(99999n)]),
    ),
  ];
}, /authority changes/);
pass(
  "on-chain output, payload suffix, exact account destination and token grant tampering rejected",
);
await venue.broadcast(pin, signed, signature);
assert.equal(sent, signed);
assert.deepEqual(await venue.receipt(pin, signature), {
  status: "awaiting_finality",
});
mode = "filled";
const proof = await venue.proof(pin, signature);
assert.equal(proof.settlement.status, "filled");
assert.equal(proof.feeLamports, String(sizes.network));
mode = "failed";
assert.equal((await venue.proof(pin, signature)).settlement.status, "failed");
pass(
  "durable-id exact-byte send, unknown lookup, finalized receipt and atomic failure fee",
);
const action: Action = {
  id: "intent_test",
  owner: OWNER,
  programId: "pg_fixture",
  strategyId: "stg_fixture",
  version: 1,
  stage: "buy",
  sequence: 1,
  network: "solana-mainnet",
  wallet,
  instrument: {
    id: "sol:token:" + addr,
    symbol: "TEST",
    address: addr,
    venue: "solana",
    kind: "token",
  },
  leg: "entry",
  side: "buy",
  leverage: 1,
  spendAsset: USDC_MINT,
  spendUnits: String(sizes.input),
  reduceOnly: false,
  exitReason: null,
  slippageBps: 50,
};
const budget: WalletBudget = {
  network: "solana-mainnet",
  wallet,
  settlementAsset: USDC_MINT,
  decimals: 6,
  allocations: [
    { asset: USDC_MINT, units: "10000000" },
    { asset: NATIVE_FEES, units: "9000000" },
  ],
  maxFeesPerOrder: [{ asset: NATIVE_FEES, units: "3000000" }],
};
const driver = makeSolanaDriver(venue, {
  linked: (owner, addr) => owner === OWNER && addr === wallet,
  lossUsd6: async () => "50",
  now: () => at,
});
const p = {
  id: "pg_fixture",
  owner: OWNER,
  orders: {},
  ledger: { accounts: [] },
} as unknown as LiveProgram;
const bal = await driver.balance(budget, p);
assert.equal(bal.lossUsd6, "50");
assert.equal(bal.free.find((a) => a.asset === NATIVE_FEES)?.units, "9000000");
const fee = String(sizes.rent + sizes.network);
const terms = await driver.prepare(action);
assert.equal(terms.targetUnits, String(sizes.input));
assert.deepEqual(
  terms.reserves.find((v) => v.asset === NATIVE_FEES),
  { asset: NATIVE_FEES, units: fee },
);
await assert.rejects(
  driver.seal(action, terms, { kind: "delegate" }),
  /signature/,
);
const typed = terms.payload as { pin: typeof pin };
const s2 = bind(typed.pin.unsigned);
const sealed = await driver.seal(action, terms, { kind: "wallet", value: s2 });
assert.equal(sealed.recoveryId, signature);
mode = "filled";
let e = await driver.reconcile(action, terms, sealed.recoveryId, []);
assert.equal(e.final?.outcome, "filled");
assert.equal(e.holding?.averageEntryUsd, 0.002);
assert.equal(e.holding?.quantity, String(sizes.output));
assert.equal(
  e.fills[0].debits.find((a) => a.asset === NATIVE_FEES)?.units,
  fee,
);
mode = "failed";
e = await driver.reconcile(action, terms, sealed.recoveryId, []);
assert.equal(e.final?.outcome, "rejected");
assert.deepEqual(e.fills[0].debits, [
  { asset: NATIVE_FEES, units: String(sizes.network) },
]);
assert.equal(e.fills[0].qty, "0");
pass(
  "program driver binds owner, USD mark, verified stable six-decimal spend, measured fees and granular finalized evidence",
);

async function nativeCase(buyNative: boolean) {
  const nativeAta = associated(wallet, WRAPPED_SOL, TOKEN),
    outAddress = buyNative ? WRAPPED_SOL : USDC_MINT,
    inAddress = buyNative ? USDC_MINT : WRAPPED_SOL;
  const src = buyNative ? input : nativeAta,
    dst = buyNative ? nativeAta : input;
  const nc = buyNative ? 25000000n : 100000000n,
    no = buyNative ? 100000000n : 25000000n,
    sol = 2000000000n,
    cash = 100000000n;
  const bb = structuredClone(build);
  bb.inputMint = inAddress;
  bb.outputMint = outAddress;
  bb.inAmount = String(nc);
  bb.outAmount = String(no);
  bb.otherAmountThreshold = String((no * 9950n) / 10000n);
  bb.addressesByLookupTableAddress = {};
  bb.setupInstructions = [
    ix(
      ATA,
      [
        [wallet, true, true],
        [nativeAta, true],
        [wallet, false],
        [WRAPPED_SOL, false],
        [SYSTEM, false],
        [TOKEN, false],
      ],
      Buffer.of(1),
    ),
  ];
  if (!buyNative)
    bb.setupInstructions.push(
      ix(
        SYSTEM,
        [
          [wallet, true, true],
          [nativeAta, true],
        ],
        Buffer.concat([u32(2), u64(nc)]),
      ),
      ix(TOKEN, [[nativeAta, true]], Buffer.of(17)),
    );
  bb.cleanupInstruction = ix(
    TOKEN,
    [
      [nativeAta, true],
      [wallet, true],
      [wallet, false, true],
    ],
    Buffer.of(9),
  );
  bb.swapInstruction = ix(
    JUP,
    [
      [wallet, false, true],
      [src, true],
      [dst, true],
      [inAddress, false],
      [outAddress, false],
      [TOKEN, false],
      [TOKEN, false],
      [JUP, false],
      [event, false],
      [JUP, false],
      [CP, false],
      [vault, true],
    ],
    Buffer.concat([
      hash("route_v2"),
      u64(nc),
      u64(no),
      u16(50),
      u16(0),
      u16(0),
      u32(1),
      Buffer.of(46),
      u16(10000),
      Buffer.of(0, 1),
    ]),
  );
  const smint = mint();
  const sm = Buffer.from(smint.data[0], "base64");
  sm[44] = 9;
  smint.data[0] = sm.toString("base64");
  const state = new Map(ledger);
  state.set(WRAPPED_SOL, smint);
  state.set(wallet, mk(SYSTEM, sol, Buffer.alloc(0)));
  state.set(input, ta(USDC_MINT, wallet, cash));
  state.set(nativeAta, null);
  let nativeWire = "";
  function data(raw: string) {
    const keys = decodeWire(raw).accountKeys,
      si = keys.indexOf(input),
      a = keys.map((k) => state.get(k)?.lamports ?? 0),
      b = a.slice();
    const finalCash = buyNative ? cash - nc : cash + no;
    const finalSol = buyNative
      ? sol + no - sizes.network
      : sol - nc - sizes.network;
    b[0] = Number(finalSol);
    const items = [
      mk(SYSTEM, finalSol, Buffer.alloc(0)),
      ...(buyNative
        ? [ta(USDC_MINT, wallet, finalCash), null]
        : [null, ta(USDC_MINT, wallet, finalCash)]),
    ];
    return {
      info: {
        err: null,
        fee: Number(sizes.network),
        preBalances: a,
        postBalances: b,
        preTokenBalances: [rawToken(si, USDC_MINT, cash)],
        postTokenBalances: [rawToken(si, USDC_MINT, finalCash)],
        loadedAddresses: { writable: [], readonly: [] },
      },
      items,
    };
  }
  const f: typeof fetch = async (url, init) => {
    if (String(url).startsWith("https://api.jup.ag")) return Response.json(bb);
    const q = JSON.parse(String(init?.body)),
      ps = q.params;
    let a: unknown;
    switch (q.method) {
      case "getMultipleAccounts":
        a = context(ps[0].map((k: string) => state.get(k) ?? null));
        break;
      case "simulateTransaction": {
        const { info, items } = data(ps[0]);
        a = context({ ...info, accounts: items });
        break;
      }
      case "sendTransaction":
        nativeWire = ps[0];
        a = encode58(decodeWire(nativeWire).signatures[0]);
        break;
      case "getSignatureStatuses":
        a = context([{ slot, err: null, confirmationStatus: "finalized" }]);
        break;
      case "getTransaction":
        a = {
          transaction: [nativeWire, "base64"],
          slot,
          blockTime,
          meta: data(nativeWire).info,
        };
        break;
      default:
        return fetcher(url, init);
    }
    return Response.json({ id: 1, jsonrpc: "2.0", result: a });
  };
  const v = new SolanaMainnet({ now: () => at, fetch: f });
  const rq = await v.quote({
    ...intent,
    intentId: "native" + buyNative,
    inputMint: inAddress,
    outputMint: outAddress,
    inputAmount: String(nc),
    minOutput: bb.otherAmountThreshold,
  });
  assert.equal(rq.expected.input, String(nc));
  assert.equal(rq.expected.output, String(no));
  assert.equal(rq.expected.rentDeltaLamports, "0");
  const wire = bind(rq.pin.unsigned),
    authorized = await v.simulate(rq.pin, wire);
  await v.broadcast(rq.pin, wire, authorized.txid!);
  const rec = await v.receipt(rq.pin, authorized.txid!);
  assert.equal(rec.status, "filled");
}
await nativeCase(true);
await nativeCase(false);
pass(
  "canonical native SOL buy/unwrap and sell/wrap exact in, network fee/ATA rent separated through finalized receipts",
);
const baseLegacy: MetaIx = ix(
  JUP,
  [
    [TOKEN, false],
    [wallet, false, true],
    [input, true],
    [output, true],
    [JUP, false],
    [addr, false],
    [JUP, false],
    [event, false],
    [JUP, false],
    [CP, false],
    [vault, true],
  ],
  Buffer.concat([
    hash("route"),
    u32(1),
    Buffer.from([46, 100, 0, 1]),
    u64(sizes.input),
    u64(sizes.output),
    u16(50),
    Buffer.of(0),
  ]),
);
await tamper((b) => {
  b.swapInstruction = {
    ...baseLegacy,
    data: Buffer.concat([
      Buffer.from(baseLegacy.data, "base64"),
      u64(sizes.input),
      u64(sizes.output),
      u16(50),
      Buffer.of(0),
    ]).toString("base64"),
  };
}, /Extra data/);
const v2 = new SolanaMainnet({ now: () => at, fetch: fetcher });
const unique = await v2.quote({
  ...intent,
  intentId: "distinct-sequential-intent",
});
assert.notEqual(unique.pin.messageHash, pin.messageHash);
pass(
  "legacy route suffix smuggling is rejected; identical orders at one blockhash have different recovery identities",
);

// Post-activation, the USDC ATA carries an SPL delegation. Reads and safe wallet swaps must accept an unchanged allowance.
function grantFlag(a: ReturnType<typeof mk>, holder: string, allow: bigint) {
  const bytes = Buffer.from(a.data[0], "base64");
  bytes.writeUInt32LE(1, 72);
  read58(holder, 32).copy(bytes, 76);
  bytes.writeBigUInt64LE(allow, 121);
  return {
    ...a,
    data: [bytes.toString("base64"), "base64"] as [string, "base64"],
  };
}
const beforeDelegate = ledger.get(input)!,
  afterDelegate = post[1],
  managed = key("user-authorized-executor");
ledger.set(input, grantFlag(beforeDelegate, managed, 3000000n));
post[1] = grantFlag(afterDelegate, managed, 3000000n);
assert.equal(
  (await venue.balances(wallet, [USDC_MINT])).mints[0].units,
  "20000000",
);
assert.equal((await venue.simulate(pin)).expected.input, String(sizes.input));
post[1] = grantFlag(afterDelegate, managed, 3000001n);
await assert.rejects(venue.simulate(pin), /changed the token delegate/);
post[1] = grantFlag(afterDelegate, key("foreign-executor"), 3000000n);
await assert.rejects(venue.simulate(pin), /changed the token delegate/);
post[1] = afterDelegate;
ledger.set(input, beforeDelegate);
pass(
  "a real, existing funding delegate can coexist with read-only balances and a wallet-signed route; new, replaced and increased allowances fail",
);

const sale: Action = {
  ...action,
  id: "intent-funded-sale",
  side: "sell",
  reduceOnly: true,
  spendAsset: addr,
  spendUnits: "1000000",
};
const allocated: WalletBudget = {
  ...budget,
  allocations: [...budget.allocations, { asset: addr, units: sale.spendUnits }],
};
const saleDriver = makeSolanaDriver(
  {
    balances: async () => ({
      nativeLamports: "10000000",
      mints: [
        { address: addr, units: "1000000", decimals: 6 },
        { address: USDC_MINT, units: "1000000", decimals: 6 },
      ],
    }),
    marks: async () => ({
      [addr]: { usd: 2, decimals: 6 },
      [USDC_MINT]: { usd: 1, decimals: 6 },
    }),
    quote: async (i: SwapIntent) => {
      assert.equal(i.inputMint, addr);
      assert.equal(i.outputMint, USDC_MINT);
      return {
        pin: { ...pin, intent: i, requiredOutput: i.minOutput },
        expected: {
          networkFeeLamports: "5000",
          rentDeltaLamports: "0",
          otherNativeCostLamports: "0",
        },
      };
    },
    proof: async (_pin: typeof pin, id: string) => ({
      txid: id,
      slot,
      at,
      feeLamports: "5000",
      settlement: {
        status: "filled",
        txid: id,
        slot,
        fill: {
          input: sale.spendUnits,
          output: "2000000",
          rentDeltaLamports: "0",
          otherNativeCostLamports: "0",
          networkFeeLamports: "5000",
        },
      },
    }),
  } as unknown as SolanaMainnet,
  {
    linked: () => true,
    lossUsd6: async () => {
      throw Error("no unrelated daily risk mark");
    },
    now: () => at,
  },
);
const fundedStage = {
  side: "sell",
  leverage: 1,
  amount: { unit: "native" },
} as Parameters<typeof saleDriver.readiness>[2];
assert.equal(
  await saleDriver.readiness(allocated, sale.instrument, fundedStage),
  null,
);
assert.notEqual(
  await saleDriver.readiness(budget, sale.instrument, fundedStage),
  null,
);
assert.equal(
  (await saleDriver.balance(allocated, p, "reduce")).assetDecimals?.[addr],
  6,
);
await assert.rejects(saleDriver.balance(allocated, p, "risk"), /unrelated/);
const saleTerms = await saleDriver.prepare(sale);
const evidence = await saleDriver.reconcile(sale, saleTerms, signature, []);
assert.equal(evidence.final?.outcome, "filled");
assert.equal(evidence.holding, undefined);
assert.deepEqual(evidence.fills[0].credits, [
  { asset: USDC_MINT, units: "2000000" },
]);
await assert.rejects(
  saleDriver.seal(sale, saleTerms, { kind: "delegate" }),
  /signature/,
);
pass(
  "native-unit funded stock of Solana tokens sells only its explicitly allocated mint with wallet approval, proper USDC credit and no invented token holding",
);
console.log(
  passed +
    " Solana mainnet fixture groups passed. No outside requests or broadcasts.",
);
