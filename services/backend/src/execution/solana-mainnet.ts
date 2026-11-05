import { priceAtSlot } from "../venues/solana-price";
import { createHash } from "node:crypto";
import { compileMetisV0, type JupiterBuild } from "./solana-build-wire";
import { ed25519 } from "@noble/curves/ed25519";
import {
  bindSignature,
  actualFill,
  pinOrder,
  settle,
  WRAPPED_SOL,
  type ActualFill,
  type PinnedOrder,
  type SwapIntent,
  type JupiterOrder,
  type Balances,
  type Settlement,
} from "./solana-jupiter";
import { decodeWire, encode58, read58, type WireTx } from "./solana-wire";

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const NATIVE_FEES = "SOL:lamports";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM = "11111111111111111111111111111111",
  ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE = "ComputeBudget111111111111111111111111111111",
  ALT = "AddressLookupTab1e1111111111111111111111111",
  MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const DEXES: Record<string, string> = {
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium",
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: "Raydium CP",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Whirlpool",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "Meteora DAMM v2",
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: "Pump.fun Amm",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "Pump.fun",
};
const EXECUTABLE = new Set([
  JUP,
  TOKEN,
  TOKEN22,
  SYSTEM,
  ATA,
  COMPUTE,
  MEMO,
  ...Object.keys(DEXES),
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
]);
const UMAX = (1n << 64n) - 1n;
function ensure(test: unknown, msg: string): asserts test {
  if (!test) throw Error(msg);
}
function nat(v: unknown): bigint {
  if (typeof v === "number") {
    ensure(
      Number.isSafeInteger(v) && v >= 0,
      "RPC returned an imprecise integer",
    );
    return BigInt(v);
  }
  ensure(
    typeof v === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(v),
    "Invalid base units",
  );
  const n = BigInt(v);
  ensure(n <= UMAX, "Base units overflow");
  return n;
}
function checkedSlot(v: number) {
  ensure(Number.isSafeInteger(v) && v >= 0, "Invalid chain slot");
  return v;
}
export function associated(
  wallet: string,
  mint: string,
  program: string,
): string {
  ensure(program === TOKEN || program === TOKEN22, "Unknown token program");
  const seeds = [read58(wallet, 32), read58(program, 32), read58(mint, 32)],
    owner = read58(ATA, 32);
  for (let bump = 255; bump >= 0; bump--) {
    const key = createHash("sha256")
      .update(
        Buffer.concat([
          ...seeds,
          Buffer.from([bump]),
          owner,
          Buffer.from("ProgramDerivedAddress"),
        ]),
      )
      .digest();
    try {
      ed25519.ExtendedPoint.fromHex(key);
    } catch {
      return encode58(key);
    }
  }
  throw Error("Cannot derive associated account");
}
type Account = {
  owner: string;
  lamports: string | number;
  executable: boolean;
  data: [string, "base64"];
  space?: number;
};
type Contextual<T> = { context: { slot: number }; value: T };
type WalletSlots = {
  keys: string[];
  writable: boolean[];
  minSlot: number;
  loaded: { writable: string[]; readonly: string[] };
};
type Mint = { address: string; program: string; decimals: number; ata: string };
type Status = {
  slot: number;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  err: unknown;
};
type Receipt = {
  slot: number;
  blockTime?: number | null;
  transaction: [string, "base64"];
  meta: Balances | null;
};
type Simulation = {
  err: unknown;
  accounts?: Array<Account | null> | null;
  replacementBlockhash?: unknown;
  loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  fee?: number | null;
} & Partial<Balances>;
export type FinalSolanaProof = {
  settlement: Settlement;
  txid: string;
  slot: number | null;
  at: number | null;
  feeLamports: string | null;
};
type Options = {
  rpcUrl?: string;
  jupiterKey?: string;
  fetch?: typeof fetch;
  now?: () => number;
};
const tokenProgram = (p: string) => p === TOKEN || p === TOKEN22;
function bytes(a: Account) {
  ensure(
    a && Array.isArray(a.data) && a.data[1] === "base64",
    "RPC account evidence missing",
  );
  return Buffer.from(a.data[0], "base64");
}
function walletAccount(a: Account | null) {
  ensure(
    a && a.owner === SYSTEM && !a.executable && bytes(a).length === 0,
    "Linked wallet must be a funded system account",
  );
  return nat(a.lamports);
}
function tokenAccount(a: Account | null, m: Mint, wallet: string) {
  if (!a) return null;
  const b = bytes(a);
  ensure(
    a.owner === m.program &&
      !a.executable &&
      b.length >= 165 &&
      encode58(b.subarray(0, 32)) === m.address &&
      encode58(b.subarray(32, 64)) === wallet &&
      b[108] === 1,
    "Wallet token account identity, state or mint changed",
  );
  const tag = b.readUInt32LE(72);
  ensure(
    (tag === 0 || tag === 1) && b.readUInt32LE(129) === 0,
    "Invalid SPL delegate or close authority",
  );
  return {
    quantity: b.readBigUInt64LE(64),
    lamports: nat(a.lamports),
    delegate: tag ? encode58(b.subarray(76, 108)) : null,
    delegated: tag ? b.readBigUInt64LE(121) : 0n,
  };
}
function readMint(wallet: string, address: string, a: Account | null): Mint {
  ensure(
    a && !a.executable && tokenProgram(a.owner),
    "Selected mint does not belong to a supported token program",
  );
  const d = bytes(a);
  ensure(
    d.length >= 82 && d[45] === 1 && d[44] <= 18,
    "Invalid or uninitialized mint",
  );
  if (a.owner === TOKEN) ensure(d.length === 82, "Expected a classic SPL mint");
  if (a.owner === TOKEN22 && d.length !== 82) {
    ensure(d.length >= 166 && d[165] === 1, "Invalid extended mint");
    for (let pos = 166; pos < d.length; ) {
      if (d.subarray(pos).every((n) => n === 0)) break;
      ensure(pos + 4 <= d.length, "Invalid mint extension");
      const type = d.readUInt16LE(pos),
        length = d.readUInt16LE(pos + 2);
      pos += 4;
      ensure(
        (type === 18 || type === 19) && pos + length <= d.length,
        "This mint's transfer or authority extension is unsupported",
      );
      pos += length;
    }
  }
  if (address === USDC_MINT)
    ensure(a.owner === TOKEN && d[44] === 6, "Incorrect USDC mint precision");
  if (address === WRAPPED_SOL)
    ensure(a.owner === TOKEN && d[44] === 9, "Incorrect native SOL mint");
  return {
    address,
    program: a.owner,
    decimals: d[44],
    ata: associated(wallet, address, a.owner),
  };
}
const disc = (n: string) =>
  createHash("sha256")
    .update("global:" + n)
    .digest()
    .subarray(0, 8)
    .toString("hex");
const variants = new Map(
  [
    ["route", false, false],
    ["shared_accounts_route", true, false],
    ["route_v2", false, true],
    ["shared_accounts_route_v2", true, true],
  ].map((r) => [
    disc(String(r[0])),
    { shared: Boolean(r[1]), v2: Boolean(r[2]) },
  ]),
);
// Borsh Swap variants are append-only. Decode the complete route, including its exact end.
// A tail read alone allows forged trailing amount fields after an otherwise valid v1 instruction.
const VENUE_VARIANT = new Map<number, string>();
for (const [codes, program] of [
  [[7, 105], "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"],
  [[26, 40], "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"],
  [[46], "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"],
  [[17, 47], "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"],
  [[38, 75], "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"],
  [[77, 108], "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"],
  [
    [49, 50, 90, 91, 97, 98, 112, 113, 149, 150],
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  ],
  [
    [72, 73, 92, 93, 99, 100, 147, 148],
    "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  ],
] as [number[], string][])
  for (const code of codes) VENUE_VARIANT.set(code, program);
function parsePlan(data: Buffer, start: number, v2: boolean, keys: string[]) {
  let pos = start;
  const take = (len: number) => {
    ensure(pos + len <= data.length, "Truncated swap steps");
    const b = data.subarray(pos, pos + len);
    pos += len;
    return b;
  };
  const flag = () => {
    const f = take(1)[0];
    ensure(f <= 1, "Invalid route flag");
    return f;
  };
  const slices = () => {
    const n = take(4).readUInt32LE();
    ensure(n <= 16, "Excessive account slices");
    take(n * 2);
  };
  const n = take(4).readUInt32LE();
  ensure(n > 0 && n <= 32, "Invalid route plan length");
  for (let i = 0; i < n; i++) {
    const variant = take(1)[0],
      program = VENUE_VARIANT.get(variant);
    ensure(
      program && keys.includes(program),
      "Unrecognized Jupiter DEX or missing venue program",
    );
    if (variant === 17) flag();
    if (variant === 47) {
      flag();
      if (flag()) slices();
    }
    if (variant === 75) slices();
    const fraction = v2 ? take(2).readUInt16LE() : take(1)[0];
    ensure(
      fraction > 0 && fraction <= (v2 ? 10000 : 100),
      "Invalid route fraction",
    );
    take(2);
  }
  return pos;
}
function routeCheck(
  ix: WireTx["instructions"][number],
  ks: WalletSlots,
  p: PinnedOrder,
  input: Mint,
  output: Mint,
) {
  const data = ix.data,
    keys = ix.indexes.map((i) => ks.keys[i]),
    variant = variants.get(data.subarray(0, 8).toString("hex"));
  ensure(variant, "Unrecognized Jupiter instruction or non-exact-in swap");
  const { v2, shared } = variant,
    offset = v2
      ? 8 + Number(shared)
      : parsePlan(data, 8 + Number(shared), false, keys),
    base = v2 ? (shared ? 12 : 10) : shared ? 13 : 9;
  ensure(
    keys.length >= base &&
      data.length >= (v2 ? 36 + Number(shared) : 33 + Number(shared)) &&
      offset >= 12 - 4 * Number(v2),
    "Incomplete Jupiter route",
  );
  const amount = data.readBigUInt64LE(offset),
    price = data.readBigUInt64LE(offset + 8),
    slip = data.readUInt16LE(offset + 16),
    fee = v2 ? data.readUInt16LE(offset + 18) : data[offset + 18];
  ensure(
    amount === nat(p.intent.inputAmount) &&
      price > 0n &&
      slip <= p.intent.maxSlippageBps &&
      fee === 0 &&
      (price * BigInt(10000 - slip)) / 10000n >= nat(p.requiredOutput),
    "Encoded minimum output, fee or input differs from the quote",
  );
  ensure(
    v2
      ? parsePlan(data, offset + 22, true, keys) === data.length
      : offset + 19 === data.length,
    "Extra data after the exact-in route",
  );
  const user = v2 ? (shared ? 1 : 0) : shared ? 2 : 1,
    src = v2 ? (shared ? 2 : 1) : shared ? 3 : 2,
    dst = v2 ? (shared ? 5 : 2) : shared ? 6 : 3;
  ensure(
    keys[user] === p.intent.taker &&
      keys[src] === input.ata &&
      keys[dst] === output.ata &&
      ks.writable[ix.indexes[src]] &&
      ks.writable[ix.indexes[dst]],
    "Swap is not restricted to the linked wallet’s associated accounts",
  );
  if (v2)
    ensure(
      keys[shared ? 6 : 3] === input.address &&
        keys[shared ? 7 : 4] === output.address &&
        keys[shared ? 8 : 5] === input.program &&
        keys[shared ? 9 : 6] === output.program,
      "Unexpected mints or token programs",
    );
  else if (shared)
    ensure(
      keys[7] === input.address &&
        keys[8] === output.address &&
        keys[0] === TOKEN,
      "Unexpected shared-route mints or token program",
    );
  else
    ensure(
      keys[5] === output.address && keys[0] === input.program,
      "Unexpected output mint or token program",
    );
  if (!shared) {
    const optional = keys[v2 ? 7 : 4];
    ensure(
      optional === JUP || optional === output.ata,
      "Separate output recipient is not authorized",
    );
  }
  ensure(keys[base - 1] === JUP, "Missing Jupiter program binding");
  if (!v2) {
    const fk = keys[shared ? 9 : 6];
    if (fee === 0) ensure(fk === JUP, "Unquoted fee account");
  }
}
function intentMemo(i: SwapIntent) {
  ensure(
    typeof i.ownerId === "string" &&
      i.ownerId.length > 0 &&
      i.ownerId.length <= 160 &&
      typeof i.intentId === "string" &&
      i.intentId.length > 0 &&
      i.intentId.length <= 180,
    "Missing unique execution scope",
  );
  return (
    "QV:" +
    createHash("sha256")
      .update(
        JSON.stringify(["solana-mainnet", i.ownerId, i.intentId, i.taker]),
      )
      .digest()
      .subarray(0, 16)
      .toString("base64url")
  );
}
function approvalIdentity(p: PinnedOrder) {
  const i = p.intent;
  return createHash("sha256")
    .update(
      JSON.stringify([
        p.messageHash,
        p.blockhash,
        p.requiredOutput,
        p.expiresAt,
        p.lastValidBlockHeight,
        i.ownerId,
        i.intentId,
        i.taker,
        i.inputMint,
        i.outputMint,
        i.inputAmount,
        i.minOutput,
        i.maxSlippageBps,
        i.maxImpactBps,
        i.maxSwapFeeBps,
        i.maxNetworkAndRentLamports,
        i.expiresAt,
      ]),
    )
    .digest("hex");
}
function checkInstructions(
  w: WireTx,
  ks: WalletSlots,
  p: PinnedOrder,
  input: Mint,
  output: Mint,
  accounts: (Account | null)[],
) {
  const payer = p.intent.taker;
  ensure(
    w.signerKeys.length === 1 &&
      w.signerKeys[0] === payer &&
      payer === ks.keys[0],
    "Unexpected fee payer or signer",
  );
  let swaps = 0,
    funding = 0n,
    sync = 0,
    close = 0,
    marker = 0,
    passed = false;
  const compute = new Set<number>();
  for (const ix of w.instructions) {
    const program = ks.keys[ix.programIndex],
      k = ix.indexes.map((i) => ks.keys[i]),
      d = ix.data;
    if (program === COMPUTE) {
      const size = new Map([
        [1, 5],
        [2, 5],
        [3, 9],
        [4, 5],
      ]);
      ensure(
        k.length === 0 && !compute.has(d[0]) && d.length === size.get(d[0]),
        "Unrecognized compute-budget mutation",
      );
      compute.add(d[0]);
      if (d[0] === 2)
        ensure(d.readUInt32LE(1) <= 1400000, "Invalid compute limit");
      continue;
    }
    if (program === MEMO) {
      ensure(
        d.length <= 256 && k.every((a) => a === payer),
        "Unsupported memo side effects",
      );
      if (!k.length && d.toString("utf8") === intentMemo(p.intent)) marker++;
      continue;
    }
    if (program === ATA) {
      ensure(
        !passed &&
          ((d.length === 1 && (d[0] === 0 || d[0] === 1)) || d.length === 0) &&
          k.length === 6 &&
          k[0] === payer &&
          k[2] === payer &&
          k[4] === SYSTEM,
        "Only wallet-owned account creation is authorized",
      );
      const m =
        k[3] === input.address
          ? input
          : k[3] === output.address
            ? output
            : null;
      ensure(
        m && k[1] === m.ata && k[5] === m.program,
        "Unrelated associated account",
      );
      continue;
    }
    if (program === SYSTEM) {
      ensure(
        !passed &&
          d.length === 12 &&
          d.readUInt32LE(0) === 2 &&
          k.length === 2 &&
          k[0] === payer &&
          input.address === WRAPPED_SOL &&
          k[1] === input.ata,
        "Native transfer is not exact wallet wrapping",
      );
      funding += d.readBigUInt64LE(4);
      ensure(
        funding <= nat(p.intent.inputAmount),
        "Native wrapping exceeds authorized input",
      );
      continue;
    }
    if (tokenProgram(program)) {
      if (d.length === 1 && d[0] === 17) {
        ensure(
          !passed &&
            !sync++ &&
            k.length === 1 &&
            input.address === WRAPPED_SOL &&
            k[0] === input.ata &&
            program === TOKEN,
          "Unexpected native sync",
        );
        continue;
      }
      if (d.length === 1 && d[0] === 9) {
        const native =
          input.address === WRAPPED_SOL
            ? input
            : output.address === WRAPPED_SOL
              ? output
              : null;
        ensure(
          passed &&
            !close++ &&
            k.length === 3 &&
            native &&
            k[0] === native.ata &&
            k[1] === payer &&
            k[2] === payer &&
            program === TOKEN,
          "Unexpected close or refund authority",
        );
        continue;
      }
      throw Error(
        "Arbitrary token transfers, approvals and authority changes are blocked",
      );
    }
    ensure(program === JUP && !swaps++, "Unrecognized top-level instruction");
    routeCheck(ix, ks, p, input, output);
    passed = true;
  }
  ensure(
    swaps === 1 && marker === 1 && (!funding || sync === 1),
    "Missing unique exact-in swap or native sync",
  );
  if (output.address === WRAPPED_SOL)
    ensure(
      close === 1,
      "Native SOL output must settle back to the linked account",
    );
  ensure(!accounts[0]?.executable, "Invalid fee payer");
  for (const [i, a] of accounts.entries()) {
    if (!a) continue;
    const address = ks.keys[i];
    if (a.executable) {
      ensure(
        EXECUTABLE.has(address) && !ks.writable[i],
        "Unsupported executable account in route",
      );
      continue;
    }
    if (!ks.writable[i] || i === 0) continue;
    if (address === input.ata) {
      tokenAccount(a, input, payer);
      continue;
    }
    if (address === output.ata) {
      tokenAccount(a, output, payer);
      continue;
    }
    if (tokenProgram(a.owner)) {
      const raw = bytes(a);
      ensure(
        raw.length >= 165,
        "Writable mint, multisig or unknown wallet authority",
      );
      const owned = encode58(raw.subarray(32, 64)) === payer,
        delegated =
          raw.readUInt32LE(72) === 1 &&
          encode58(raw.subarray(76, 108)) === payer,
        closeable =
          raw.readUInt32LE(129) === 1 &&
          encode58(raw.subarray(133, 165)) === payer;
      ensure(
        !owned && !delegated && !closeable,
        "Route requested another wallet asset or authority",
      );
    }
  }
}
async function readJson(fetcher: typeof fetch, url: string, init: RequestInit) {
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok)
    throw Error(
      response.status === 429
        ? "Solana provider quota reached; the order was not confirmed"
        : "Solana provider unavailable (" + response.status + ")",
    );
  ensure(response.body, "Provider returned no body");
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const s = await reader.read();
      if (s.done) break;
      n += s.value.length;
      if (n > 2500000) {
        await reader.cancel();
        throw Error("Oversized provider response");
      }
      parts.push(s.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
}
export class SolanaMainnet {
  private readonly now: () => number;
  private readonly http: typeof fetch;
  private readonly rpcUrl: string;
  private nextJupiter = 0;
  private signedChecks = new Map<
    string,
    { digest: string; slot: number; until: number; cap: string }
  >();
  private async jupiter(url: string) {
    const at = this.now(),
      start = Math.max(at, this.nextJupiter),
      spacing = this.options.jupiterKey ? 120 : 2100;
    ensure(
      start - at <= 12000,
      "Jupiter quote queue is full; retry after the current request",
    );
    this.nextJupiter = start + spacing;
    if (start > at) await new Promise((r) => setTimeout(r, start - at));
    return readJson(this.http, url, {
      method: "GET",
      headers: this.options.jupiterKey
        ? { "x-api-key": this.options.jupiterKey }
        : {},
    });
  }
  constructor(private readonly options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.http = options.fetch ?? fetch;
    const url = new URL(
      options.rpcUrl ?? "https://api.mainnet-beta.solana.com",
    );
    ensure(
      url.protocol === "https:" && !url.username && !url.password,
      "Trusted HTTPS Solana RPC required",
    );
    this.rpcUrl = url.href;
  }
  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const out = (await readJson(this.http, this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })) as {
      jsonrpc?: string;
      id?: number;
      result?: T;
      error?: { code?: number };
    };
    ensure(
      out.jsonrpc === "2.0" &&
        out.id === 1 &&
        !out.error &&
        out.result !== undefined,
      "The RPC could not verify " + method,
    );
    return out.result;
  }
  private async network() {
    ensure(
      (await this.rpc<string>("getGenesisHash", [])) === MAINNET_GENESIS,
      "Incorrect Solana genesis hash",
    );
  }
  private async accounts(keys: string[], minSlot = 0, slice = false) {
    ensure(
      keys.length > 0 && keys.length <= 100,
      "Unsupported Solana account count",
    );
    const r = await this.rpc<Contextual<(Account | null)[]>>(
      "getMultipleAccounts",
      [
        keys,
        {
          commitment: "confirmed",
          encoding: "base64",
          minContextSlot: minSlot,
          ...(slice ? { dataSlice: { offset: 0, length: 166 } } : {}),
        },
      ],
    );
    ensure(
      checkedSlot(r.context.slot) >= minSlot &&
        Array.isArray(r.value) &&
        r.value.length === keys.length,
      "Incomplete or stale RPC account evidence",
    );
    return r;
  }
  private async resolved(w: WireTx): Promise<WalletSlots> {
    const writable: string[] = [],
      readonly: string[] = [];
    let minSlot = 0;
    if (w.lookups.length) {
      const res = await this.accounts(w.lookups.map((t) => t.table));
      minSlot = res.context.slot;
      w.lookups.forEach((table, i) => {
        const a = res.value[i];
        ensure(
          a && a.owner === ALT && !a.executable,
          "Untrusted account lookup table",
        );
        const raw = bytes(a);
        ensure(
          raw.length >= 56 &&
            (raw.length - 56) % 32 === 0 &&
            raw.length <= 56 + 256 * 32 &&
            raw.readUInt32LE(0) === 1 &&
            raw.readBigUInt64LE(4) === UMAX,
          "Inactive or invalid lookup table",
        );
        const last = raw.readBigUInt64LE(12),
          count = (raw.length - 56) / 32;
        ensure(last <= BigInt(minSlot), "Future lookup table");
        function resolve(index: number) {
          ensure(
            index < count && (last < BigInt(minSlot) || index < raw[20]),
            "Lookup entry not active at the verified slot",
          );
          return encode58(raw.subarray(56 + 32 * index, 88 + 32 * index));
        }
        writable.push(...table.writable.map(resolve));
        readonly.push(...table.readonly.map(resolve));
      });
    }
    const keys = [...w.accountKeys, ...writable, ...readonly];
    ensure(
      keys.length === w.totalKeys &&
        keys.length <= 100 &&
        new Set(keys).size === keys.length,
      "Repeated or excessive resolved accounts",
    );
    return {
      keys,
      writable: [
        ...w.writableStatic,
        ...writable.map(() => true),
        ...readonly.map(() => false),
      ],
      minSlot,
      loaded: { writable, readonly },
    };
  }
  async balances(wallet: string, addresses: string[]) {
    read58(wallet, 32);
    ensure(
      addresses.length > 0 &&
        addresses.length <= 24 &&
        new Set(addresses).size === addresses.length,
      "Invalid selected mint list",
    );
    for (const a of addresses) read58(a, 32);
    await this.network();
    const first = await this.accounts(addresses),
      mints = addresses.map((a, i) => readMint(wallet, a, first.value[i]));
    const amounts = await this.accounts(
      [wallet, ...mints.map((m) => m.ata)],
      first.context.slot,
    );
    return {
      nativeLamports: walletAccount(amounts.value[0]).toString(),
      slot: amounts.context.slot,
      mints: mints.map((m, i) => ({
        ...m,
        units: (
          tokenAccount(amounts.value[i + 1], m, wallet)?.quantity ?? 0n
        ).toString(),
      })),
    };
  }
  async marks(mints: string[]) {
    ensure(mints.length > 0 && mints.length <= 24, "Invalid price request");
    for (const mint of mints) read58(mint, 32);
    await this.network();
    const [raw, slot] = await Promise.all([
      this.jupiter(
        "https://api.jup.ag/price/v3?ids=" +
          encodeURIComponent(mints.join(",")),
      ),
      this.rpc<number>("getSlot", [{ commitment: "confirmed" }]),
    ]);
    checkedSlot(slot);
    const prices = raw as Record<
      string,
      { usdPrice: number; blockId: number; decimals: number }
    >;
    const out: Record<string, { usd: number; slot: number; decimals: number }> =
      {};
    for (const mint of mints) {
      out[mint] = priceAtSlot(prices[mint], slot);
    }
    return out;
  }
  async quote(intent: SwapIntent) {
    for (const a of [intent.taker, intent.inputMint, intent.outputMint])
      read58(a, 32);
    ensure(
      intent.inputMint !== intent.outputMint &&
        nat(intent.inputAmount) > 0n &&
        nat(intent.minOutput) > 0n &&
        Number.isSafeInteger(intent.expiresAt) &&
        intent.expiresAt > this.now(),
      "Invalid or expired swap request",
    );
    ensure(
      Number.isSafeInteger(intent.maxSlippageBps) &&
        intent.maxSlippageBps > 0 &&
        intent.maxSlippageBps <= 500 &&
        Number.isSafeInteger(intent.maxImpactBps) &&
        intent.maxImpactBps >= 0 &&
        intent.maxImpactBps <= 1000 &&
        Number.isSafeInteger(intent.maxSwapFeeBps) &&
        intent.maxSwapFeeBps >= 0 &&
        intent.maxSwapFeeBps <= 500,
      "Invalid swap risk limits",
    );
    const url = new URL("https://api.jup.ag/swap/v2/build");
    for (const [key, val] of Object.entries({
      inputMint: intent.inputMint,
      outputMint: intent.outputMint,
      amount: intent.inputAmount,
      taker: intent.taker,
      slippageBps: String(intent.maxSlippageBps),
      transactionVersion: "0",
      maxAccounts: "64",
      dexes: Object.values(DEXES).join(","),
    }))
      url.searchParams.set(key, val);
    await this.network();
    const [raw, height] = await Promise.all([
      this.jupiter(url.href),
      this.rpc<number>("getBlockHeight", [{ commitment: "confirmed" }]),
    ]);
    const b = raw as JupiterBuild;
    ensure(
      typeof b.priceImpactPct === "string" &&
        /^-?[0-9]+(?:\.[0-9]+)?$/.test(b.priceImpactPct) &&
        Number.isFinite(Number(b.priceImpactPct)),
      "Missing route impact",
    );
    ensure(
      !b.otherInstructions ||
        (Array.isArray(b.otherInstructions) && b.otherInstructions.length < 5),
      "Unexpected extra instructions",
    );
    const tx = compileMetisV0(intent.taker, {
      ...b,
      otherInstructions: [
        ...(b.otherInstructions ?? []),
        {
          programId: MEMO,
          accounts: [],
          data: Buffer.from(intentMemo(intent)).toString("base64"),
        },
      ],
    });
    // /build is always intermediary-free, zero Jupiter platform fee. The actual network and rent costs are obtained from the very same message below.
    const q: JupiterOrder = {
      requestId: decodeWire(tx).digest,
      transaction: tx,
      transactionVersion: 0,
      inputMint: b.inputMint,
      outputMint: b.outputMint,
      inAmount: b.inAmount,
      outAmount: b.outAmount,
      otherAmountThreshold: b.otherAmountThreshold,
      swapMode: b.swapMode,
      slippageBps: b.slippageBps,
      feeBps: 0,
      priceImpact: Number(b.priceImpactPct) * 100,
      signatureFeePayer: intent.taker,
      gasless: false,
      signatureFeeLamports: 0,
      prioritizationFeeLamports: 0,
      rentFeeLamports: 0,
      taker: intent.taker,
      lastValidBlockHeight: String(
        b.blockhashWithMetadata.lastValidBlockHeight,
      ),
      router: "metis",
    };
    const pin = pinOrder(intent, q, this.now(), String(checkedSlot(height))),
      simulation = await this.simulate(pin);
    const usdc =
      intent.inputMint === USDC_MINT
        ? intent.inputAmount
        : intent.outputMint === USDC_MINT
          ? simulation.expected.output
          : null;
    return {
      pin,
      expected: simulation.expected,
      swapUsdValue:
        usdc && nat(usdc) <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(usdc) / 1e6
          : null,
    };
  }
  async simulate(pin: PinnedOrder, signed?: string) {
    const wire = signed ?? pin.unsigned;
    const w = decodeWire(wire),
      identity = signed ? bindSignature(pin, signed) : null;
    ensure(
      w.digest === pin.messageHash &&
        w.blockhash === pin.blockhash &&
        (!signed ? w.signatures[0].every((v) => v === 0) : true),
      "Unrecognized pinned swap message",
    );
    ensure(this.now() < pin.expiresAt, "Swap terms expired");
    await this.network();
    const ks = await this.resolved(w),
      wallet = pin.intent.taker,
      mintState = await this.accounts(
        [pin.intent.inputMint, pin.intent.outputMint],
        ks.minSlot,
      );
    const input = readMint(wallet, pin.intent.inputMint, mintState.value[0]),
      output = readMint(wallet, pin.intent.outputMint, mintState.value[1]);
    const pre = await this.accounts(ks.keys, mintState.context.slot, true),
      minSlot = pre.context.slot;
    const indexes = [
      0,
      ks.keys.indexOf(input.ata),
      ks.keys.indexOf(output.ata),
    ];
    ensure(
      indexes.every((i) => i >= 0) && new Set(indexes).size === 3,
      "Missing wallet accounts",
    );
    walletAccount(pre.value[0]);
    checkInstructions(w, ks, pin, input, output, pre.value);
    const addresses = indexes.map((i) => ks.keys[i]);
    const [sim, fee, valid, height] = await Promise.all([
      this.rpc<Contextual<Simulation>>("simulateTransaction", [
        wire,
        {
          encoding: "base64",
          commitment: "confirmed",
          sigVerify: !!signed,
          replaceRecentBlockhash: false,
          minContextSlot: minSlot,
          accounts: { encoding: "base64", addresses },
        },
      ]),
      this.rpc<Contextual<number | null>>("getFeeForMessage", [
        w.message.toString("base64"),
        { commitment: "confirmed", minContextSlot: minSlot },
      ]),
      this.rpc<Contextual<boolean>>("isBlockhashValid", [
        pin.blockhash,
        { commitment: "confirmed", minContextSlot: minSlot },
      ]),
      this.rpc<number>("getBlockHeight", [
        { commitment: "confirmed", minContextSlot: minSlot },
      ]),
    ]);
    ensure(
      valid.value === true &&
        valid.context.slot >= minSlot &&
        checkedSlot(height) <= Number(nat(pin.lastValidBlockHeight)) &&
        this.now() < pin.expiresAt,
      "Approval or network blockhash expired",
    );
    ensure(
      fee.value !== null &&
        fee.context.slot >= minSlot &&
        nat(fee.value) <= nat(pin.intent.maxNetworkAndRentLamports),
      "Fee exceeds the approved budget",
    );
    const sv = sim.value,
      slot = checkedSlot(sim.context.slot);
    ensure(
      slot >= minSlot &&
        sv?.err === null &&
        !sv.replacementBlockhash &&
        Array.isArray(sv.accounts) &&
        sv.accounts.length === 3,
      "Unsuccessful or unverifiable simulation",
    );
    if (sv.loadedAddresses)
      ensure(
        JSON.stringify(sv.loadedAddresses.writable) ===
          JSON.stringify(ks.loaded.writable) &&
          JSON.stringify(sv.loadedAddresses.readonly) ===
            JSON.stringify(ks.loaded.readonly),
        "Simulation resolved different lookup table entries",
      );
    const post = sv.accounts;
    walletAccount(post[0]);
    for (const [j, m] of [input, output].entries()) {
      const before = tokenAccount(pre.value[indexes[j + 1]], m, wallet),
        after = tokenAccount(post[j + 1], m, wallet);
      // An existing owner-granted allowance can coexist with a wallet-signed trade. The swap must never grant, replace or increase it.
      ensure(
        (before?.delegate ?? null) === (after?.delegate ?? null) &&
          (after?.delegated ?? 0n) <= (before?.delegated ?? 0n),
        "The swap changed the token delegate or its allowance",
      );
    }
    ensure(
      output.address === WRAPPED_SOL ? !post[2] : !!post[2],
      "Output does not settle to the authorized destination",
    );
    let expected: ActualFill;
    if (
      Array.isArray(sv.preBalances) &&
      Array.isArray(sv.postBalances) &&
      Array.isArray(sv.preTokenBalances) &&
      Array.isArray(sv.postTokenBalances)
    ) {
      for (const [ki, account] of post.entries())
        ensure(
          nat(sv.postBalances[indexes[ki]]) === nat(account?.lamports ?? 0),
          "RPC post-lamport snapshots disagree",
        );
      for (const [j, m] of [input, output].entries()) {
        const item = sv.postTokenBalances.find(
            (v) => v.accountIndex === indexes[j + 1],
          ),
          a = tokenAccount(post[j + 1], m, wallet);
        ensure(
          a
            ? item?.owner === wallet &&
                item.mint === m.address &&
                nat(item.uiTokenAmount.amount) === a.quantity
            : !item,
          "Post-simulation token authority or quantity evidence disagrees",
        );
      }
      expected = actualFill(pin, w, {
        ...sv,
        fee: sv.fee ?? fee.value!,
      } as Balances);
      ensure(
        nat(expected.networkFeeLamports) === nat(fee.value),
        "Simulation fee changed",
      );
    } else {
      let before = indexes.map((i) => pre.value[i]);
      if (pre.context.slot !== slot) {
        const aligned = await this.accounts(addresses, slot, true);
        ensure(
          aligned.context.slot === slot,
          "The RPC cannot prove starting balances at the simulation bank",
        );
        before = aligned.value;
      }
      expected = snapshots(pin, input, output, before, post, nat(fee.value));
    }
    ensure(
      expected.otherNativeCostLamports === "0",
      "Unexpected native transfer outside the exact price, network fee and rent",
    );
    if (identity) {
      for (const [id, e] of this.signedChecks)
        if (e.until <= this.now()) this.signedChecks.delete(id);
      if (this.signedChecks.size < 128)
        this.signedChecks.set(identity.txid, {
          digest: approvalIdentity(pin),
          cap: pin.intent.maxNetworkAndRentLamports,
          slot,
          until: Math.min(this.now() + 4000, pin.expiresAt),
        });
    }
    return { txid: identity?.txid ?? null, expected, slot };
  }
  /** The caller must commit the deterministic recovery ID and the single-dispatch state before this operation. */
  async broadcast(pin: PinnedOrder, signed: string, txid: string) {
    const verified = bindSignature(pin, signed);
    ensure(
      verified.txid === txid,
      "Persisted transaction ID differs from the signed swap",
    );
    await this.network();
    const cached = this.signedChecks.get(txid);
    const sim =
      cached &&
      cached.digest === approvalIdentity(pin) &&
      cached.cap === pin.intent.maxNetworkAndRentLamports &&
      cached.until > this.now()
        ? cached
        : await this.simulate(pin, signed);
    this.signedChecks.delete(txid);
    ensure(pin.expiresAt > this.now(), "Signed swap expired");
    const accepted = await this.rpc<string>("sendTransaction", [
      signed,
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "confirmed",
        minContextSlot: sim.slot,
        maxRetries: 0,
      },
    ]);
    ensure(
      accepted === txid,
      "Ambiguous submission; reconcile the original transaction ID",
    );
    return txid;
  }
  async proof(pin: PinnedOrder, txid: string): Promise<FinalSolanaProof> {
    read58(txid, 64);
    await this.network();
    const statuses = await this.rpc<Contextual<(Status | null)[]>>(
      "getSignatureStatuses",
      [[txid], { searchTransactionHistory: true }],
    );
    const status = statuses.value?.[0];
    const out = (
      settlement: Settlement,
      slot: number | null = null,
      at: number | null = null,
      feeLamports: string | null = null,
    ) => ({ settlement, txid, slot, at, feeLamports });
    if (!status || status.confirmationStatus !== "finalized")
      return out({ status: "awaiting_finality" });
    const receipt = await this.rpc<Receipt | null>("getTransaction", [
      txid,
      {
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
        commitment: "finalized",
      },
    ]);
    if (!receipt?.meta) return out({ status: "awaiting_finality" });
    if (receipt.slot !== status.slot || receipt.transaction?.[1] !== "base64")
      return out({ status: "review" });
    const bound = bindSignature(pin, receipt.transaction[0]);
    if (bound.txid !== txid) return out({ status: "review" });
    if ((status.err === null) !== (receipt.meta.err === null))
      return out({ status: "review" });
    const fee = nat(receipt.meta.fee),
      at =
        Number.isSafeInteger(receipt.blockTime) && receipt.blockTime! > 0
          ? receipt.blockTime! * 1000
          : null;
    if (status.err !== null) {
      const { preBalances, postBalances } = receipt.meta;
      if (
        !preBalances ||
        !postBalances ||
        preBalances.length !== bound.tx.totalKeys ||
        postBalances.length !== preBalances.length ||
        nat(preBalances[0]) - nat(postBalances[0]) !== fee ||
        preBalances.slice(1).some((v, i) => nat(v) !== nat(postBalances[i + 1]))
      )
        return out({ status: "review" });
      return out({ status: "failed" }, status.slot, at, fee.toString());
    }
    const settled = settle(pin, txid, status, receipt);
    return out(
      settled.status === "filled" &&
        settled.fill.otherNativeCostLamports !== "0"
        ? { status: "review" }
        : settled,
      status.slot,
      at,
      fee.toString(),
    );
  }
  async receipt(pin: PinnedOrder, txid: string) {
    return (await this.proof(pin, txid)).settlement;
  }
}
function snapshots(
  pin: PinnedOrder,
  input: Mint,
  output: Mint,
  before: (Account | null)[],
  after: (Account | null)[],
  fee: bigint,
): ActualFill {
  function totals(list: (Account | null)[]) {
    const w = pin.intent.taker,
      token = [
        tokenAccount(list[1], input, w),
        tokenAccount(list[2], output, w),
      ];
    let native = walletAccount(list[0]),
      rent = 0n;
    for (const [i, a] of token.entries())
      if (a) {
        native += a.lamports;
        const r =
          a.lamports -
          ([input, output][i].address === WRAPPED_SOL ? a.quantity : 0n);
        ensure(r >= 0n, "Invalid wrapped native reserve");
        rent += r;
      }
    return {
      native,
      rent,
      first: token[0]?.quantity ?? 0n,
      second: token[1]?.quantity ?? 0n,
    };
  }
  const a = totals(before),
    b = totals(after),
    native = b.native - a.native + fee,
    rent = b.rent - a.rent;
  const spent = input.address === WRAPPED_SOL ? -native : a.first - b.first,
    received = output.address === WRAPPED_SOL ? native : b.second - a.second;
  const other =
    input.address !== WRAPPED_SOL &&
    output.address !== WRAPPED_SOL &&
    native < 0n
      ? -native
      : 0n;
  ensure(
    spent === nat(pin.intent.inputAmount) &&
      received >= nat(pin.requiredOutput) &&
      fee + other + (rent > 0n ? rent : 0n) <=
        nat(pin.intent.maxNetworkAndRentLamports),
    "Simulated wallet movements exceed approved bounds",
  );
  return {
    input: String(spent),
    output: String(received),
    networkFeeLamports: String(fee),
    rentDeltaLamports: String(rent),
    otherNativeCostLamports: String(other),
  };
}
