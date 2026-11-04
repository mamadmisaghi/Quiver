import {
  concatHex,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getCreate2Address,
  isAddress,
  keccak256,
  parseAbi,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";
import { nyLocal, nyseSession } from "../venues/calendar";
import {
  ROBINHOOD_ISSUER_ASSETS,
  robinhoodIssuerCandidate,
} from "../compile/robinhood-assets";

export const RH_MAINNET_CHAIN_ID = 4663;
export const RH_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN = 4663n,
  ZERO = "0x" + "00".repeat(20);
const addr = (a: string) => a.toLowerCase() as Address;
export const RH_USDG = addr("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
  RH_WETH = addr("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const RH_V3 = {
  factory: addr("0x1f7d7550b1b028f7571e69a784071f0205fd2efa"),
  quoter: addr("0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7"),
  router: addr("0xcaf681a66d020601342297493863e78c959e5cb2"),
  init: "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54" as Hex,
  // keccak(deployed runtime), reconstructed by executing each official creation artifact with the 4663 constructor parameters.
  routerHash:
    "0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc",
  quoterHash:
    "0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28",
  factoryHash:
    "0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739",
} as const;
const ASSETS = ROBINHOOD_ISSUER_ASSETS;
const FEEDS =
  "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const abi = parseAbi([
  "function factory() view returns(address)",
  "function WETH9() view returns(address)",
  "function uid() view returns(bytes32)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function balanceOf(address who) view returns(uint256)",
  "function allowance(address owner,address spender) view returns(uint256)",
  "function approve(address spender,uint256 amount) returns(bool)",
  "function getPool(address a,address b,uint24 fee) view returns(address)",
  "function liquidity() view returns(uint128)",
  "function quoteExactInput(bytes path,uint256 amountIn) returns(uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns(uint256 amountOut)",
  "function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)",
  "function latestRoundData() view returns(uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
  "function description() view returns(string)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
]);
const SWAP = toEventSelector(
    "Swap(address,address,int256,int256,uint160,uint128,int24)",
  ),
  TRANSFER = toEventSelector("Transfer(address,address,uint256)"),
  APPROVAL = toEventSelector("Approval(address,address,uint256)");
const wordHex = (n: bigint) => ("0x" + n.toString(16)) as Hex;
const FEE_TIERS = [100, 500, 3000, 10000],
  BPS = 10000n,
  MAX_UINT = (1n << 256n) - 1n;
function need(c: unknown, why: string): asserts c {
  if (!c) throw Error(why);
}
function obj(v: unknown): Record<string, unknown> {
  need(
    v && typeof v === "object" && !Array.isArray(v),
    "Missing chain or registry evidence",
  );
  return v as Record<string, unknown>;
}
function address(v: unknown): Address {
  need(
    typeof v === "string" &&
      isAddress(v, { strict: false }) &&
      v.toLowerCase() !== ZERO,
    "Invalid mainnet address",
  );
  return addr(v);
}
function hash(v: unknown): Hex {
  need(
    typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v),
    "Missing 32-byte chain evidence",
  );
  return v.toLowerCase() as Hex;
}
function qty(v: unknown): bigint {
  need(
    typeof v === "string" &&
      /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v) &&
      v.length <= 66,
    "Malformed RPC quantity",
  );
  return BigInt(v);
}
function hex(v: unknown): Hex {
  need(
    typeof v === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(v),
    "Malformed chain bytes",
  );
  return v.toLowerCase() as Hex;
}
function amount(v: unknown): bigint {
  need(
    typeof v === "string" &&
      /^[1-9][0-9]{0,76}$/.test(v) &&
      BigInt(v) <= MAX_UINT,
    "Use positive integer amounts in token base units",
  );
  return BigInt(v);
}
function band(v: unknown, upper: number) {
  need(
    Number.isInteger(v) && Number(v) >= 1 && Number(v) <= upper,
    "Risk limit is outside the allowed range",
  );
  return BigInt(v as number);
}
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
function data(name: string, args: readonly unknown[]): Hex {
  return encodeFunctionData({
    abi,
    functionName: name as never,
    args: args as never,
  });
}
function output(name: string, bytes: unknown): unknown {
  return decodeFunctionResult({
    abi,
    functionName: name as never,
    data: hex(bytes),
  });
}
const fmtTag = (h: Hex) => ({ blockHash: h, requireCanonical: true });
function positiveSafe(x: bigint) {
  need(
    x >= 0n && x <= BigInt(Number.MAX_SAFE_INTEGER),
    "Block timestamp cannot be represented",
  );
  return Number(x);
}
function header(v: unknown) {
  const b = obj(v);
  return {
    number: qty(b.number),
    hash: hash(b.hash),
    at: positiveSafe(qty(b.timestamp)) * 1000,
  };
}
function indexOK(arr: unknown): unknown[] {
  need(Array.isArray(arr), "Incomplete chain evidence");
  return arr;
}
async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const r = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  need(r.ok, "Robinhood mainnet provider is unavailable");
  const reader = r.body?.getReader();
  need(reader, "Provider returned no body");
  let n = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const x = await reader.read();
      if (x.done) break;
      n += x.value.length;
      need(n <= 4 * 1024 * 1024, "Mainnet reply exceeds the read limit");
      chunks.push(x.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export type RhRpc = (
  method: string,
  params: readonly unknown[],
) => Promise<unknown>;
function httpRpc(url: string): RhRpc {
  const u = new URL(url);
  need(
    u.protocol === "https:" && !u.username && !u.password,
    "A trusted HTTPS production RPC is required",
  );
  let next = 0;
  return async (method, params) => {
    const id = ++next;
    const body = obj(
      await fetchJson(u.href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      }),
    );
    need(
      body.id === id && !body.error && "result" in body,
      "Robinhood RPC could not verify this request",
    );
    return body.result;
  };
}
export type RhIntent = {
  owner: Address | string;
  symbol: string;
  side: "buy" | "sell";
  amountIn: string;
  minOutput: string;
  slippageBps: number;
  maxImpactBps: number;
  maxFeeWei: string;
  eligible: boolean;
};
type Hop = { pool: Address; tokenIn: Address; tokenOut: Address; fee: number };
export type RhPrepared = {
  version: 1;
  chainId: 4663;
  kind: "approve_zero" | "approve" | "swap";
  owner: Address;
  symbol: string;
  side: "buy" | "sell";
  inputToken: Address;
  outputToken: Address;
  inputUnits: string;
  minimumOutputUnits: string;
  expectedOutputUnits: string;
  anchorNumber: string;
  anchorHash: Hex;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  maxFeeWei: string;
  maxImpactBps: number;
  slippageBps: number;
  hops: Hop[];
  tx: {
    chainId: Hex;
    from: Address;
    to: Address;
    value: "0x0";
    data: Hex;
    nonce: Hex;
    gas: Hex;
    gasPrice: Hex;
  };
  termsHash: Hex;
};
export type RhResult = {
  status:
    | "pending"
    | "unverified"
    | "replaced"
    | "failed"
    | "approval_confirmed"
    | "filled";
  txHash?: Hex;
  blockNumber?: string;
  blockHash?: Hex;
  blockTime?: number;
  notionalUsd6?: string;
  amountIn?: string;
  amountOut?: string;
  feeWei?: string;
  fillId?: string;
  reason?: string;
  cursor?: string;
};
type Options = {
  rpc?: RhRpc;
  rpcUrl?: string;
  assets?: () => Promise<unknown>;
  feeds?: () => Promise<unknown>;
  now?: () => number;
};
function memo(source: () => Promise<unknown>, ttl: number, now: () => number) {
  let at = 0,
    value: unknown,
    active: Promise<unknown> | undefined;
  return async () => {
    if (value !== undefined && now() - at < ttl) return value;
    if (!active)
      active = source()
        .then((v) => {
          value = v;
          at = now();
          return v;
        })
        .finally(() => {
          active = undefined;
        });
    return active;
  };
}
function registered(
  v: unknown,
  symbol: string,
  side: "buy" | "sell",
  at: number,
) {
  const candidate = robinhoodIssuerCandidate(v, symbol);
  need(
    candidate,
    "Choose an exact active issuer-registered stock token on chain 4663",
  );
  const row = indexOK(obj(v).assets)
    .map(obj)
    .find((r) => r.tokenSymbol === symbol)!;
  const c = obj(row.tradingCapabilities),
    session = nyseSession(at),
    local = nyLocal(at);
  const allow = (f: unknown) =>
    f === "tradable" ||
    (side === "buy" && f === "position_opening_only") ||
    (side === "sell" && f === "position_closing_only");
  const isNight =
    session === "closed" &&
    !["Sat", "Sun"].includes(local.weekday) &&
    (local.mins < 240 || local.mins >= 1200);
  const key =
    session === "open"
      ? "market"
      : session === "pre" || session === "post"
        ? "extended"
        : isNight
          ? "overnight"
          : null;
  need(key, "Stock token availability is not verified for this session");
  const capability = c[key];
  const legacy =
    capability && typeof capability === "object"
      ? obj(capability).fractional
      : undefined;
  const oldAllowed =
    legacy === "TRADING_STATUS_TRADABLE" ||
    (side === "sell" && legacy === "TRADING_STATUS_POSITION_CLOSING_ONLY") ||
    (side === "buy" && legacy === "TRADING_STATUS_POSITION_OPENING_ONLY");
  need(
    legacy !== undefined
      ? oldAllowed
      : allow(c.fractionalTradability) &&
          (key === "market" ||
            (key === "extended" &&
              c.extendedHoursFractionalTradability === true) ||
            (key === "overnight" && allow(c.allDayTradability))),
    "This asset is not tradable in the selected session",
  );
  return { stock: address(candidate.address), uid: hash(row.id) };
}
function oracleRef(list: unknown, sym: string) {
  const rows = indexOK(list)
    .map(obj)
    .filter(
      (f) =>
        f.name ===
        (sym === "USDG" || sym === "ETH"
          ? sym + " / USD"
          : "Robinhood " + sym + " / USD"),
    );
  need(rows.length === 1, "No unique verified " + sym + " / USD oracle");
  const f = rows[0];
  need(
    Number.isInteger(f.decimals) &&
      Number(f.decimals) >= 0 &&
      Number(f.decimals) <= 18 &&
      Number.isInteger(f.heartbeat) &&
      Number(f.heartbeat) > 0,
    "Oracle metadata unavailable",
  );
  return {
    addr: address(f.proxyAddress),
    decimals: Number(f.decimals),
    age: Math.min(Number(f.heartbeat), 86400),
    name: String(f.name),
  };
}
export function rhPoolAddress(
  tokenA: Address,
  tokenB: Address,
  fee: number,
): Address {
  const a = address(tokenA),
    b = address(tokenB);
  need(a !== b && FEE_TIERS.includes(fee), "Unsupported stock-token route");
  const sorted = [a, b].sort();
  return addr(
    getCreate2Address({
      from: RH_V3.factory,
      salt: keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "uint24" }],
          [sorted[0], sorted[1], fee],
        ),
      ),
      bytecodeHash: RH_V3.init,
    }),
  );
}
function path(hops: Hop[]) {
  need(hops.length === 1 || hops.length === 2, "Invalid path length");
  let bytes = hops[0].tokenIn as Hex;
  for (const h of hops)
    bytes = concatHex([
      bytes,
      encodePacked(["uint24", "address"], [h.fee, h.tokenOut]),
    ]);
  return bytes;
}
function calldata(
  p: Pick<
    RhPrepared,
    | "kind"
    | "hops"
    | "owner"
    | "inputUnits"
    | "minimumOutputUnits"
    | "expiresAt"
  >,
) {
  if (p.kind !== "swap")
    return data("approve", [
      RH_V3.router,
      p.kind === "approve_zero" ? 0n : amount(p.inputUnits),
    ]);
  const swap = data("exactInput", [
    {
      path: path(p.hops),
      recipient: p.owner,
      amountIn: amount(p.inputUnits),
      amountOutMinimum: amount(p.minimumOutputUnits),
    },
  ]);
  return data("multicall", [BigInt(Math.floor(p.expiresAt / 1000)), [swap]]);
}
function termsDigest(p: Omit<RhPrepared, "termsHash">): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        CHAIN,
        p.owner,
        p.tx.to,
        keccak256(p.tx.data),
        BigInt(p.nonce),
        qty(p.tx.gas),
        qty(p.tx.gasPrice),
        p.anchorHash,
      ],
    ),
  );
}
export class RobinhoodMainnet {
  private rpc: RhRpc;
  private assets: () => Promise<unknown>;
  private feeds: () => Promise<unknown>;
  readonly now: () => number;
  constructor(o: Options = {}) {
    this.now = o.now ?? Date.now;
    this.rpc = o.rpc ?? httpRpc(o.rpcUrl ?? RH_MAINNET_RPC);
    this.assets = memo(o.assets ?? (() => fetchJson(ASSETS)), 15000, this.now);
    this.feeds = memo(o.feeds ?? (() => fetchJson(FEEDS)), 300000, this.now);
  }
  private async call(
    to: Address,
    name: string,
    args: readonly unknown[],
    at: Hex,
    from?: Address,
  ) {
    return output(
      name,
      await this.rpc("eth_call", [
        { to, data: data(name, args), ...(from ? { from } : {}) },
        fmtTag(at),
      ]),
    );
  }
  private async head() {
    const [chain, b] = await Promise.all([
      this.rpc("eth_chainId", []),
      this.rpc("eth_getBlockByNumber", ["latest", false]),
    ]);
    need(qty(chain) === CHAIN, "The RPC is on another network");
    const h = header(b);
    need(
      this.now() - h.at >= -10000 && this.now() - h.at < 60000,
      "Stale Robinhood mainnet head",
    );
    return h;
  }
  private async venue(h: Hex) {
    const pins = [
      [RH_V3.router, RH_V3.routerHash],
      [RH_V3.factory, RH_V3.factoryHash],
      [RH_V3.quoter, RH_V3.quoterHash],
    ] as const;
    await Promise.all(
      pins.map(async ([a, expected]) => {
        const code = hex(await this.rpc("eth_getCode", [a, fmtTag(h)]));
        need(
          code !== "0x" && keccak256(code) === expected,
          "Uniswap deployed code differs from the verified Robinhood deployment",
        );
      }),
    );
  }
  private async market(
    symbol: string,
    side: "buy" | "sell",
    at: number,
    h: Hex,
  ) {
    const stock = registered(await this.assets(), symbol, side, at);
    const [ticker, uid, sDec, uDec, uSym] = await Promise.all([
      this.call(stock.stock, "symbol", [], h),
      this.call(stock.stock, "uid", [], h),
      this.call(stock.stock, "decimals", [], h),
      this.call(RH_USDG, "decimals", [], h),
      this.call(RH_USDG, "symbol", [], h),
    ]);
    need(
      ticker === symbol &&
        uid === stock.uid &&
        sDec === 18 &&
        uDec === 6 &&
        uSym === "USDG",
      "Stock or USDG identity changed",
    );
    return stock.stock;
  }
  private async rate(symbol: string, h: Hex, at: number) {
    const ref = oracleRef(await this.feeds(), symbol);
    const [desc, d, ans] = await Promise.all([
      this.call(ref.addr, "description", [], h),
      this.call(ref.addr, "decimals", [], h),
      this.call(ref.addr, "latestRoundData", [], h),
    ]);
    need(
      (desc === ref.name ||
        (symbol !== "USDG" && desc === "RH" + symbol + " / USD")) &&
        d === ref.decimals,
      "Oracle identity mismatch",
    );
    const [round, price, , stamp, answered] = ans as readonly bigint[];
    const age = at / 1000 - Number(stamp);
    need(
      round > 0n &&
        answered >= round &&
        price > 0n &&
        age >= -5 &&
        age <= ref.age,
      "Price oracle is stale or incomplete",
    );
    return price * 10n ** BigInt(18 - ref.decimals);
  }
  private async quotePool(a: Address, b: Address, h: Hex) {
    const candidates = await Promise.all(
      FEE_TIERS.map(async (fee) => {
        const pool = await this.call(RH_V3.factory, "getPool", [a, b, fee], h);
        if (typeof pool !== "string" || pool.toLowerCase() === ZERO)
          return null;
        need(
          address(pool) === rhPoolAddress(a, b, fee),
          "Factory returned a noncanonical pool",
        );
        const liq = await this.call(address(pool), "liquidity", [], h);
        return typeof liq === "bigint" && liq > 0n
          ? { pool: address(pool), tokenIn: a, tokenOut: b, fee }
          : null;
      }),
    );
    return candidates.filter((x) => x !== null) as Hop[];
  }
  private async best(input: Address, out: Address, units: bigint, h: Hex) {
    const [direct, middleA, middleB] = await Promise.all([
      this.quotePool(input, out, h),
      this.quotePool(input, RH_WETH, h),
      this.quotePool(RH_WETH, out, h),
    ]);
    const routes = [
      ...direct.map((v) => [v]),
      ...middleA.flatMap((a) => middleB.map((b) => [a, b])),
    ];
    need(routes.length, "No liquid verified V3 pool for the selected stock");
    const values = await Promise.all(
      routes.map(async (hops) => {
        try {
          const r = (await this.call(
            RH_V3.quoter,
            "quoteExactInput",
            [path(hops), units],
            h,
          )) as [bigint, bigint[], number[], bigint];
          return r[0] > 0n ? { hops, out: r[0] } : null;
        } catch {
          return null;
        }
      }),
    );
    const good = values
      .filter((v) => v !== null)
      .sort((a, b) => (a!.out > b!.out ? -1 : a!.out < b!.out ? 1 : 0));
    need(good[0], "No verifiable stock-token quote is available");
    return good[0]!;
  }
  async verifyDeployment() {
    const h = await this.head();
    await this.venue(h.hash);
    return {
      chainId: 4663,
      blockNumber: String(h.number),
      blockHash: h.hash,
      observedAt: h.at,
      router: RH_V3.router,
      quoter: RH_V3.quoter,
      factory: RH_V3.factory,
    };
  }
  async blockAt(time: number) {
    const tip = await this.head();
    need(
      Number.isSafeInteger(time) &&
        time <= this.now() &&
        time >= this.now() - 3 * 86400000,
      "Unsupported risk valuation date",
    );
    let low = 0n,
      high = tip.number;
    while (low < high) {
      const mid = (low + high + 1n) >> 1n;
      const v = header(
        await this.rpc("eth_getBlockByNumber", [wordHex(mid), false]),
      );
      need(v.number === mid, "Invalid historical block");
      if (v.at <= time) low = mid;
      else high = mid - 1n;
    }
    const b = header(
      await this.rpc("eth_getBlockByNumber", [wordHex(low), false]),
    );
    need(
      b.number === low && b.at <= time && time - b.at < 1800000,
      "No reliable observation near the daily boundary",
    );
    return { number: String(b.number), hash: b.hash, at: b.at };
  }
  async gasUsd6(wei: string, blockHash: Hex, blockTime: number) {
    const units = BigInt(wei);
    need(units >= 0n, "Invalid gas debit");
    return ceil(
      units * (await this.rate("ETH", blockHash, blockTime)),
      10n ** 30n,
    );
  }
  async stockValueUsd6(
    symbol: string,
    token: string,
    units: bigint,
    historical?: { hash: Hex; at: number },
  ) {
    need(units > 0n, "A positive holding is required");
    const h = historical ?? (await this.head());
    // Valuation remains available outside trading hours. An order uses market() to check tradability separately.
    const candidate = robinhoodIssuerCandidate(await this.assets(), symbol);
    need(candidate?.address === address(token), "Unverified holding");
    await this.venue(h.hash);
    const [q, usd, fair] = await Promise.all([
      this.best(address(token), RH_USDG, units, h.hash),
      this.rate("USDG", h.hash, h.at),
      this.rate(symbol, h.hash, h.at),
    ]);
    const observed = (q.out * usd) / 10n ** 18n,
      reference = (units * fair) / 10n ** 30n;
    need(
      observed > 0n &&
        reference > 0n &&
        observed * 100n >= reference * 95n &&
        observed * 100n <= reference * 105n,
      "Execution value disagrees with the stock oracle",
    );
    return observed;
  }
  async stockIdentity(symbol: string, side: "buy" | "sell" = "buy") {
    const h = await this.head();
    await this.venue(h.hash);
    return this.market(symbol, side, h.at, h.hash);
  }
  /** Current executable sell-side reference for exactly 0.01 of this stock token, converted using the live USDG/USD oracle. */
  async spotPrice(symbol: string) {
    const h = await this.head();
    await this.venue(h.hash);
    const stock = await this.market(symbol, "sell", h.at, h.hash),
      size = 10n ** 16n;
    const [bid, stable, fair] = await Promise.all([
      this.best(stock, RH_USDG, size, h.hash),
      this.rate("USDG", h.hash, h.at),
      this.rate(symbol, h.hash, h.at),
    ]);
    const dollars18 = (bid.out * stable * 10n ** 12n) / size;
    need(
      dollars18 * 100n >= fair * 95n && dollars18 * 100n <= fair * 105n,
      "Stock venue mark is outside its oracle band.",
    );
    const price = Number(dollars18) / 1e18;
    need(Number.isFinite(price) && price > 0, "Invalid stock venue price");
    return {
      price,
      observedAt: h.at,
      source: "Robinhood mainnet · Uniswap V3 stock bid",
      synthetic: false as const,
      address: stock,
      decimals: 18 as const,
    };
  }
  async balances(ownerInput: string, tokens: readonly string[]) {
    const owner = address(ownerInput),
      h = await this.head();
    need(tokens.length <= 32, "Too many token balance requests");
    const gas = qty(await this.rpc("eth_getBalance", [owner, fmtTag(h.hash)]));
    const free = await Promise.all(
      [...new Set([RH_USDG, ...tokens.map(address)])].map(async (a) => ({
        asset: a,
        units: String(await this.call(a, "balanceOf", [owner], h.hash)),
      })),
    );
    return {
      free: [{ asset: "ETH", units: gas.toString() }, ...free],
      observedAt: h.at,
    };
  }
  async priceUsd6(symbol: string) {
    const h = await this.head();
    return {
      usd6: (await this.rate(symbol, h.hash, h.at)) / 10n ** 12n,
      observedAt: h.at,
    };
  }
  async prepare(v: RhIntent): Promise<RhPrepared> {
    need(v.eligible === true, "Stock-token eligibility is required");
    need(v.side === "buy" || v.side === "sell", "Unknown stock order side");
    need(/^[A-Z][A-Z0-9.-]{0,14}$/.test(v.symbol), "Invalid stock symbol");
    const owner = address(v.owner),
      input = amount(v.amountIn),
      userMin = amount(v.minOutput),
      slip = band(v.slippageBps, 300),
      impact = band(v.maxImpactBps, 500),
      maxFee = amount(v.maxFeeWei);
    const h = await this.head();
    await this.venue(h.hash);
    const stock = await this.market(v.symbol, v.side, h.at, h.hash);
    const buy = v.side === "buy",
      inputToken = buy ? RH_USDG : stock,
      outputToken = buy ? stock : RH_USDG;
    const [
      best,
      usd,
      stockUsd,
      balance,
      allowance,
      wei,
      gasRate,
      nonce,
      latestNonce,
    ] = await Promise.all([
      this.best(inputToken, outputToken, input, h.hash),
      this.rate("USDG", h.hash, h.at),
      this.rate(v.symbol, h.hash, h.at),
      this.call(inputToken, "balanceOf", [owner], h.hash),
      this.call(inputToken, "allowance", [owner, RH_V3.router], h.hash),
      this.rpc("eth_getBalance", [owner, fmtTag(h.hash)]),
      this.rpc("eth_gasPrice", []),
      this.rpc("eth_getTransactionCount", [owner, "pending"]),
      this.rpc("eth_getTransactionCount", [owner, fmtTag(h.hash)]),
    ]);
    need(
      typeof balance === "bigint" && balance >= input,
      "Insufficient funds in this Robinhood Chain wallet",
    );
    need(typeof allowance === "bigint", "Missing allowance");
    need(
      qty(nonce) === qty(latestNonce),
      "Wait for this wallet's pending transaction before preparing another stock order",
    );
    const fair = buy
      ? (input * usd * 10n ** 12n) / stockUsd
      : (input * stockUsd) / (usd * 10n ** 12n);
    const floor = [
      userMin,
      ceil(best.out * (BPS - slip), BPS),
      ceil(fair * (BPS - impact), BPS),
    ].reduce((a, b) => (a > b ? a : b));
    need(
      fair > 0n && floor <= best.out,
      "The pool price or minimum return is outside the authorized limit",
    );
    // No new unlimited or additive grants. Clear an existing nonzero insufficient allowance first.
    const kind =
      allowance >= input
        ? "swap"
        : allowance === 0n
          ? "approve"
          : "approve_zero";
    const createdAt = this.now(),
      expiresAt = Math.min(createdAt, h.at) + 90000;
    const intent = {
      version: 1 as const,
      chainId: 4663 as const,
      kind: kind as RhPrepared["kind"],
      owner,
      symbol: v.symbol,
      side: v.side,
      inputToken,
      outputToken,
      inputUnits: v.amountIn,
      minimumOutputUnits: String(floor),
      expectedOutputUnits: String(best.out),
      anchorNumber: String(h.number),
      anchorHash: h.hash,
      nonce: String(qty(nonce)),
      createdAt,
      expiresAt,
      maxFeeWei: v.maxFeeWei,
      maxImpactBps: v.maxImpactBps,
      slippageBps: v.slippageBps,
      hops: best.hops,
    };
    const to = kind === "swap" ? RH_V3.router : inputToken,
      encoded = calldata(intent),
      gasPrice = qty(gasRate);
    const call = { from: owner, to, value: "0x0" as const, data: encoded };
    await this.simulate(call, kind, floor, h.hash);
    const measured = qty(
        await this.rpc("eth_estimateGas", [call, wordHex(h.number)]),
      ),
      gasLimit = ceil(measured * 120n, 100n);
    need(
      gasPrice > 0n &&
        gasLimit >= 21000n &&
        gasLimit <= 15000000n &&
        gasLimit * gasPrice <= maxFee &&
        qty(wei) >= gasLimit * gasPrice,
      "Insufficient ETH or gas exceeds the approved fee cap",
    );
    const result = {
      ...intent,
      tx: {
        ...call,
        chainId: wordHex(CHAIN),
        nonce: wordHex(qty(nonce)),
        gas: wordHex(gasLimit),
        gasPrice: wordHex(gasPrice),
      },
    };
    return { ...result, termsHash: termsDigest(result) };
  }
  private async simulate(
    call: { from: Address; to: Address; value: "0x0"; data: Hex },
    kind: RhPrepared["kind"],
    floor: bigint,
    h: Hex,
  ) {
    const out = await this.rpc("eth_call", [call, fmtTag(h)]);
    if (kind === "swap") {
      const rows = output("multicall", out) as Hex[];
      need(
        rows.length === 1 && (output("exactInput", rows[0]) as bigint) >= floor,
        "Signed route simulation misses the minimum output",
      );
    } else
      need(
        output("approve", out) === true,
        "The exact token approval simulation failed",
      );
  }
  async validate(p: RhPrepared, eligible: boolean): Promise<void> {
    need(eligible, "Stock-token eligibility is required");
    need(
      p.version === 1 &&
        p.chainId === 4663 &&
        p.tx.chainId === wordHex(CHAIN) &&
        p.tx.from === p.owner &&
        p.termsHash === termsDigest(p),
      "Stock order terms changed",
    );
    need(
      this.now() < p.expiresAt && this.now() >= p.createdAt,
      "The wallet terms have expired",
    );
    const h = await this.head();
    await this.venue(h.hash);
    const stock = await this.market(p.symbol, p.side, h.at, h.hash),
      buy = p.side === "buy";
    need(
      p.inputToken === (buy ? RH_USDG : stock) &&
        p.outputToken === (buy ? stock : RH_USDG) &&
        p.tx.to === (p.kind === "swap" ? RH_V3.router : p.inputToken) &&
        p.tx.data === calldata(p) &&
        p.hops.every(
          (x) => x.pool === rhPoolAddress(x.tokenIn, x.tokenOut, x.fee),
        ),
      "Route identity changed",
    );
    const input = amount(p.inputUnits),
      floor = amount(p.minimumOutputUnits);
    const [pending, bal, wei, allow, oracleUsd, oracleStock] =
      await Promise.all([
        this.rpc("eth_getTransactionCount", [p.owner, "pending"]),
        this.call(p.inputToken, "balanceOf", [p.owner], h.hash),
        this.rpc("eth_getBalance", [p.owner, fmtTag(h.hash)]),
        this.call(p.inputToken, "allowance", [p.owner, RH_V3.router], h.hash),
        this.rate("USDG", h.hash, h.at),
        this.rate(p.symbol, h.hash, h.at),
      ]);
    need(
      qty(pending) === BigInt(p.nonce) &&
        typeof bal === "bigint" &&
        bal >= input &&
        typeof allow === "bigint",
      "Wallet balance, allowance or nonce changed",
    );
    need(
      p.kind === "swap"
        ? allow >= input
        : p.kind === "approve"
          ? allow === 0n
          : allow > 0n && allow < input,
      "Re-prepare with the wallet's current allowance",
    );
    const fair = buy
      ? (input * oracleUsd * 10n ** 12n) / oracleStock
      : (input * oracleStock) / (oracleUsd * 10n ** 12n);
    need(
      floor >= ceil(fair * (BPS - BigInt(p.maxImpactBps)), BPS),
      "Oracle changed outside the approved price band",
    );
    const estimate = qty(
      await this.rpc("eth_estimateGas", [
        { to: p.tx.to, from: p.owner, data: p.tx.data, value: "0x0" },
        wordHex(h.number),
      ]),
    );
    const cost = qty(p.tx.gas) * qty(p.tx.gasPrice);
    need(
      qty(wei) >= cost &&
        cost <= amount(p.maxFeeWei) &&
        estimate <= qty(p.tx.gas),
      "Mainnet gas requirements changed",
    );
    await this.simulate(p.tx, p.kind, floor, h.hash);
  }
  private async byNonce(
    p: RhPrepared,
    tip: bigint,
  ): Promise<{ tx: Record<string, unknown> | null; cursor?: string }> {
    // Account nonces are monotonic. Binary-search even when a wallet response is lost for days.
    const n = BigInt(p.nonce),
      accountNonce = async (block: bigint) =>
        qty(
          await this.rpc("eth_getTransactionCount", [p.owner, wordHex(block)]),
        );
    if ((await accountNonce(tip)) <= n) return { tx: null };
    let lo = BigInt(p.anchorNumber),
      hi = tip;
    // If the quote's anchor was reorganized, search from genesis on the current canonical branch.
    if (lo > hi || (await accountNonce(lo)) > n) lo = 0n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1n;
      if ((await accountNonce(mid)) > n) hi = mid;
      else lo = mid + 1n;
    }
    return { tx: await this.inBlock(p, lo), cursor: lo.toString() };
  }
  private async inBlock(p: RhPrepared, n: bigint) {
    const b = obj(await this.rpc("eth_getBlockByNumber", [wordHex(n), true]));
    need(qty(b.number) === n, "Provider returned a different block");
    return (
      indexOK(b.transactions)
        .map(obj)
        .find(
          (t) =>
            typeof t.from === "string" &&
            t.from.toLowerCase() === p.owner &&
            qty(t.nonce) === BigInt(p.nonce),
        ) ?? null
    );
  }
  private async scan(p: RhPrepared, tip: bigint, cursor?: string) {
    let from = BigInt(p.anchorNumber) > 2n ? BigInt(p.anchorNumber) - 2n : 0n;
    if (cursor && /^(0|[1-9][0-9]{0,18}):0x[0-9a-f]{64}$/.test(cursor)) {
      const [n, h] = cursor.split(":");
      if (BigInt(n) >= from && BigInt(n) <= tip) {
        const prior = await this.rpc("eth_getBlockByNumber", [
          wordHex(BigInt(n)),
          false,
        ]);
        if (prior && header(prior).hash === h) from = BigInt(n) + 1n;
      }
    }
    if (from > tip) return { tx: null, cursor };
    let lastCursor = cursor;
    for (let n = from; n <= tip && n < from + 16n; n++) {
      const b = obj(await this.rpc("eth_getBlockByNumber", [wordHex(n), true]));
      need(qty(b.number) === n, "Wrong canonical scan block");
      const bh = hash(b.hash);
      const tx = indexOK(b.transactions)
        .map(obj)
        .find(
          (t) =>
            typeof t.from === "string" &&
            t.from.toLowerCase() === p.owner &&
            qty(t.nonce) === BigInt(p.nonce),
        );
      lastCursor = n + ":" + bh;
      if (tx) return { tx, cursor: lastCursor };
    }
    return { tx: null, cursor: lastCursor };
  }
  async reconcile(
    p: RhPrepared,
    provided?: string,
    cursor?: string,
  ): Promise<RhResult> {
    try {
      need(
        p.version === 1 && p.chainId === 4663 && p.termsHash === termsDigest(p),
        "Unknown prepared terms",
      );
      need(qty(await this.rpc("eth_chainId", [])) === CHAIN, "Wrong network");
      let tx: Record<string, unknown> | null = null;
      if (provided) {
        const candidate = await this.rpc("eth_getTransactionByHash", [
          hash(provided),
        ]);
        if (candidate) {
          const t = obj(candidate);
          // An unrelated or malicious browser candidate cannot turn an intent into a replacement.
          if (
            hash(t.hash) === hash(provided) &&
            typeof t.from === "string" &&
            t.from.toLowerCase() === p.owner &&
            qty(t.nonce) === BigInt(p.nonce)
          )
            tx = t;
        }
      }
      if (!tx) {
        const latest = header(
          await this.rpc("eth_getBlockByNumber", ["latest", false]),
        );
        let found;
        try {
          found = await this.byNonce(p, latest.number);
        } catch {
          found = await this.scan(p, latest.number, cursor);
        }
        if (!found.tx)
          return {
            status: "pending",
            cursor: found.cursor ?? cursor,
            reason:
              "Waiting for the wallet's original nonce on the canonical chain",
          };
        tx = found.tx;
      }
      const txHash = hash(tx.hash);
      const raw = await this.rpc("eth_getTransactionReceipt", [txHash]);
      if (!raw || !tx.blockHash)
        return { status: "pending", txHash, reason: "Waiting for inclusion" };
      const rec = obj(raw),
        bh = hash(rec.blockHash),
        bn = qty(rec.blockNumber);
      need(
        hash(rec.transactionHash) === txHash &&
          hash(tx.blockHash) === bh &&
          qty(tx.blockNumber) === bn &&
          address(rec.from) === p.owner,
        "Receipt and transaction do not match",
      );
      const [canonRaw, finalRaw] = await Promise.all([
        this.rpc("eth_getBlockByNumber", [wordHex(bn), false]),
        this.rpc("eth_getBlockByNumber", ["finalized", false]),
      ]);
      if (!canonRaw || !finalRaw)
        return {
          status: "pending",
          txHash,
          reason: "Waiting for canonical finality",
        };
      const canon = obj(canonRaw),
        b = header(canon),
        final = header(finalRaw);
      if (
        b.hash !== bh ||
        b.number !== bn ||
        final.number < bn ||
        (final.number === bn && final.hash !== bh)
      )
        return {
          status: "pending",
          txHash,
          reason: "Waiting for canonical finality",
        };
      if (final.number > bn) {
        const f = await this.rpc("eth_getBlockByNumber", [
          wordHex(final.number),
          false,
        ]);
        if (!f || header(f).hash !== final.hash)
          return {
            status: "pending",
            txHash,
            reason: "Finalized head is not canonical",
          };
      }
      need(
        hash(
          indexOK(canon.transactions)[positiveSafe(qty(rec.transactionIndex))],
        ) === txHash,
        "Receipt is not at its canonical transaction index",
      );
      const expected =
        typeof tx.to === "string" &&
        addr(tx.to) === p.tx.to &&
        qty(tx.value) === 0n &&
        hex(tx.input) === p.tx.data &&
        qty(tx.chainId) === CHAIN;
      const at = {
        txHash,
        blockNumber: bn.toString(),
        blockHash: bh,
        blockTime: b.at,
      };
      if (!expected)
        return {
          status: "replaced",
          ...at,
          reason:
            "A different finalized transaction consumed this wallet nonce",
        };
      need(
        typeof rec.to === "string" &&
          address(rec.to) === p.tx.to &&
          qty(tx.nonce) === BigInt(p.nonce),
        "Receipt destination or nonce mismatch",
      );
      const limit = qty(tx.gas),
        used = qty(rec.gasUsed),
        effective = qty(rec.effectiveGasPrice);
      need(
        used > 0n && used <= limit && effective > 0n,
        "Invalid receipt gas evidence",
      );
      const fees = used * effective,
        feeCeiling = limit * qty(tx.maxFeePerGas ?? tx.gasPrice);
      // A wallet may modify fee caps. Irreversible spend is still reported for manual reconciliation instead of silently accepted.
      need(
        feeCeiling <= BigInt(p.maxFeeWei) && fees <= feeCeiling,
        "Wallet fee envelope exceeded its authorization",
      );
      const status = qty(rec.status);
      need(status === 0n || status === 1n, "Malformed receipt status");
      let result: RhResult;
      if (status === 0n) {
        need(indexOK(rec.logs).length === 0, "Reverted receipt contains logs");
        result = {
          status: "failed",
          ...at,
          feeWei: fees.toString(),
          reason: "Finalized EVM revert",
        };
      } else {
        // The selected factory and router must still have their approved production runtime at execution.
        await this.venue(bh);
        result = {
          ...rhLogs(p, rec, txHash, bh, bn),
          ...at,
          feeWei: fees.toString(),
        };
        if (result.status === "filled" && result.amountIn && result.amountOut) {
          const stableBase = BigInt(
            p.side === "buy" ? result.amountIn : result.amountOut,
          );
          result.notionalUsd6 = (
            (stableBase * (await this.rate("USDG", bh, b.at))) /
            10n ** 18n
          ).toString();
        }
      }
      const finalCheck = await this.rpc("eth_getBlockByNumber", [
        wordHex(bn),
        false,
      ]);
      if (!finalCheck || header(finalCheck).hash !== bh)
        return {
          status: "pending",
          txHash,
          reason: "The inclusion changed during verification",
        };
      return result;
    } catch (e) {
      return {
        status: "unverified",
        reason:
          e instanceof Error
            ? e.message
            : "Robinhood receipt evidence unavailable",
        cursor,
      };
    }
  }
}
function rhLogs(
  p: RhPrepared,
  rec: Record<string, unknown>,
  txHash: Hex,
  bh: Hex,
  bn: bigint,
): RhResult {
  const logIndices = new Set<string>(),
    transfers: {
      token: Address;
      from: Address;
      to: Address;
      value: bigint;
      index: bigint;
    }[] = [],
    swaps: {
      pool: Address;
      sender: Address;
      recipient: Address;
      q0: bigint;
      q1: bigint;
      index: bigint;
    }[] = [];
  let approval = 0;
  for (const item of indexOK(rec.logs)) {
    const r = obj(item);
    need(
      r.removed !== true &&
        hash(r.transactionHash) === txHash &&
        hash(r.blockHash) === bh &&
        qty(r.blockNumber) === bn &&
        qty(r.transactionIndex) === qty(rec.transactionIndex),
      "Log outside the canonical transaction",
    );
    const index = qty(r.logIndex),
      indexKey = String(index);
    need(!logIndices.has(indexKey), "Duplicate receipt log");
    logIndices.add(indexKey);
    const emitter = address(r.address),
      topics = indexOK(r.topics).map(hash) as [Hex, ...Hex[]];
    if (!topics.length) continue;
    if (topics[0] !== TRANSFER && topics[0] !== APPROVAL && topics[0] !== SWAP)
      continue;
    const d = decodeEventLog({ abi, data: hex(r.data), topics, strict: true });
    if (d.eventName === "Transfer") {
      transfers.push({
        token: emitter,
        from: addr(d.args.from),
        to: addr(d.args.to),
        value: d.args.value,
        index,
      });
    }
    if (d.eventName === "Approval" && addr(d.args.owner) === p.owner) {
      need(
        emitter === p.inputToken && addr(d.args.spender) === RH_V3.router,
        "Unexpected wallet approval",
      );
      if (p.kind !== "swap") {
        need(
          d.args.value ===
            (p.kind === "approve_zero" ? 0n : BigInt(p.inputUnits)),
          "Approval amount mismatch",
        );
        approval++;
      }
    }
    if (d.eventName === "Swap")
      swaps.push({
        pool: emitter,
        sender: addr(d.args.sender),
        recipient: addr(d.args.recipient),
        q0: d.args.amount0,
        q1: d.args.amount1,
        index,
      });
  }
  if (p.kind !== "swap") {
    need(
      approval === 1 &&
        swaps.length === 0 &&
        !transfers.some((t) => t.from === p.owner || t.to === p.owner),
      "Missing approval evidence or unexpected swap",
    );
    return { status: "approval_confirmed" };
  }
  need(swaps.length === p.hops.length, "Missing or extra pool execution");
  let input = BigInt(p.inputUnits),
    lastFill = 0n;
  const expected: typeof transfers = [];
  for (let i = 0; i < p.hops.length; i++) {
    const h = p.hops[i],
      events = swaps.filter((s) => s.pool === h.pool);
    need(
      events.length === 1 &&
        h.pool === rhPoolAddress(h.tokenIn, h.tokenOut, h.fee),
      "Unverified or duplicate pool",
    );
    const s = events[0],
      recipient = i === p.hops.length - 1 ? p.owner : RH_V3.router;
    const first = h.tokenIn < h.tokenOut,
      spent = first ? s.q0 : s.q1,
      out = -(first ? s.q1 : s.q0);
    need(
      s.sender === RH_V3.router &&
        s.recipient === recipient &&
        spent === input &&
        out > 0n,
      "Swap amount, signer or recipient mismatch",
    );
    const from = i === 0 ? p.owner : RH_V3.router;
    for (const [token, payer, to, value] of [
      [h.tokenIn, from, h.pool, spent],
      [h.tokenOut, h.pool, recipient, out],
    ] as const) {
      const t = transfers.filter(
        (x) =>
          x.token === token &&
          x.from === payer &&
          x.to === to &&
          x.value === value,
      );
      need(t.length === 1, "Missing exact ERC20 movement");
      expected.push(t[0]);
    }
    input = out;
    lastFill = s.index;
  }
  need(
    transfers
      .filter((t) => t.from === p.owner || t.to === p.owner)
      .every((t) => expected.includes(t)),
    "Unexpected wallet movement",
  );
  need(
    input >= BigInt(p.minimumOutputUnits),
    "Final output below the approved floor",
  );
  return {
    status: "filled",
    amountIn: p.inputUnits,
    amountOut: input.toString(),
    fillId: txHash + ":" + lastFill,
  };
}
