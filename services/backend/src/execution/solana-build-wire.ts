import { encode58, read58, decodeWire } from "./solana-wire";

export type MetaIx = {
  programId: string;
  accounts: { pubkey: string; isWritable: boolean; isSigner: boolean }[];
  data: string;
};
type Build = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  transactionVersion?: number;
  computeBudgetInstructions: MetaIx[];
  setupInstructions: MetaIx[];
  swapInstruction: MetaIx;
  cleanupInstruction?: MetaIx | null;
  otherInstructions?: MetaIx[];
  tipInstruction?: MetaIx | null;
  addressesByLookupTableAddress?: Record<string, string[]> | null;
  blockhashWithMetadata: { blockhash: number[]; lastValidBlockHeight: number };
};
export type JupiterBuild = Build;
const COMPUTE = "ComputeBudget111111111111111111111111111111";
function check(v: unknown, m: string): asserts v {
  if (!v) throw Error(m);
}
const short = (n: number) => {
  check(
    Number.isSafeInteger(n) && n >= 0 && n < 16384,
    "Exceeded v0 message capacity",
  );
  return Buffer.from(n < 128 ? [n] : [(n & 127) | 128, n >> 7]);
};
export function compileMetisV0(wallet: string, b: Build) {
  read58(wallet, 32);
  check(
    !b.tipInstruction &&
      (b.transactionVersion === undefined || b.transactionVersion === 0),
    "Unsupported transaction version or wallet tip",
  );
  check(
    Array.isArray(b.computeBudgetInstructions) &&
      b.computeBudgetInstructions.length <= 4 &&
      Array.isArray(b.setupInstructions) &&
      b.setupInstructions.length <= 8,
    "Invalid setup instructions",
  );
  const budget = b.computeBudgetInstructions;
  const limit = Buffer.alloc(5);
  limit[0] = 2;
  limit.writeUInt32LE(1400000, 1);
  const instructions = [
    ...(!budget.some(
      (x) => x.programId === COMPUTE && Buffer.from(x.data, "base64")[0] === 2,
    )
      ? [{ programId: COMPUTE, accounts: [], data: limit.toString("base64") }]
      : []),
    ...budget,
    ...b.setupInstructions,
    b.swapInstruction,
    ...(b.cleanupInstruction ? [b.cleanupInstruction] : []),
    ...(b.otherInstructions ?? []),
  ];
  check(instructions.length <= 18, "Excessive instruction count");
  const metas = new Map<string, { writable: boolean; invoked: boolean }>([
    [wallet, { writable: true, invoked: false }],
  ]);
  const merge = (key: string, writable: boolean, invoked: boolean) => {
    read58(key, 32);
    const m = metas.get(key);
    if (m) {
      m.writable ||= writable;
      m.invoked ||= invoked;
    } else metas.set(key, { writable, invoked });
  };
  for (const ix of instructions) {
    check(
      ix &&
        Array.isArray(ix.accounts) &&
        ix.accounts.length <= 100 &&
        typeof ix.data === "string" &&
        ix.data.length <= 1644 &&
        Buffer.from(ix.data, "base64").toString("base64") === ix.data,
      "Invalid instruction metadata",
    );
    merge(ix.programId, false, true);
    for (const k of ix.accounts) {
      check(
        k &&
          typeof k.isWritable === "boolean" &&
          typeof k.isSigner === "boolean" &&
          (!k.isSigner || k.pubkey === wallet),
        "Unexpected signer in Jupiter instruction",
      );
      merge(k.pubkey, k.isWritable, false);
    }
  }
  const metasList = [...metas];
  check(
    metasList.length <= 100 && metaNotInvoked(wallet),
    "Excessive or ambiguous transaction accounts",
  );
  function metaNotInvoked(k: string) {
    return !metas.get(k)?.invoked;
  }
  for (const [, m] of metasList)
    check(
      !(m.invoked && m.writable),
      "Writable program requests are forbidden",
    );
  const drained = new Set<string>(),
    w: string[] = [],
    r: string[] = [],
    lookups: Buffer[] = [];
  const tables = Object.entries(b.addressesByLookupTableAddress ?? {});
  check(tables.length <= 12, "Excessive lookup tables");
  for (const [table, addresses] of tables) {
    read58(table, 32);
    check(
      Array.isArray(addresses) &&
        addresses.length <= 256 &&
        new Set(addresses).size === addresses.length,
      "Invalid lookup mapping",
    );
    for (const a of addresses) read58(a, 32);
    const wi: number[] = [],
      ri: number[] = [];
    for (const [k, m] of metasList) {
      if (k === wallet || m.invoked || drained.has(k)) continue;
      const i = addresses.indexOf(k);
      if (i < 0) continue;
      (m.writable ? wi : ri).push(i);
      (m.writable ? w : r).push(k);
      drained.add(k);
    }
    if (wi.length || ri.length)
      lookups.push(
        Buffer.concat([
          read58(table, 32),
          short(wi.length),
          Buffer.from(wi),
          short(ri.length),
          Buffer.from(ri),
        ]),
      );
  }
  const stat = metasList.filter(([k]) => k !== wallet && !drained.has(k));
  const ro = stat.filter(([, m]) => !m.writable).map(([k]) => k);
  const st = [
      wallet,
      ...stat.filter(([, m]) => m.writable).map(([k]) => k),
      ...ro,
    ],
    all = [...st, ...w, ...r];
  const bh = b.blockhashWithMetadata;
  check(
    bh &&
      Number.isSafeInteger(bh.lastValidBlockHeight) &&
      bh.lastValidBlockHeight > 0 &&
      Array.isArray(bh.blockhash) &&
      bh.blockhash.length === 32 &&
      bh.blockhash.every((n) => Number.isInteger(n) && n >= 0 && n <= 255),
    "Invalid blockhash metadata",
  );
  const contextBlockhash = Buffer.from(bh.blockhash);
  const ixs = instructions.map((ix) => {
    const d = Buffer.from(ix.data, "base64"),
      indexes = ix.accounts.map((a) => all.indexOf(a.pubkey));
    return Buffer.concat([
      Buffer.from([all.indexOf(ix.programId)]),
      short(indexes.length),
      Buffer.from(indexes),
      short(d.length),
      d,
    ]);
  });
  const msg = Buffer.concat([
    Buffer.from([128, 1, 0, ro.length]),
    short(st.length),
    ...st.map((k) => read58(k, 32)),
    contextBlockhash,
    short(ixs.length),
    ...ixs,
    short(lookups.length),
    ...lookups,
  ]);
  const unsigned = Buffer.concat([
    Buffer.from([1]),
    Buffer.alloc(64),
    msg,
  ]).toString("base64");
  const tx = decodeWire(unsigned);
  check(
    tx.blockhash === encode58(contextBlockhash),
    "Transaction blockhash changed",
  );
  return unsigned;
}
