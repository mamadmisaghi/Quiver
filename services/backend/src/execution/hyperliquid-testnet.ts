/** Hyperliquid perpetuals. Venue URLs and signature domains are selected as one unit. */
import { encode } from "@msgpack/msgpack";
import {
  concatHex,
  encodeAbiParameters,
  recoverAddress,
  stringToHex,
  concatBytes,
  keccak256,
  numberToBytes,
  parseSignature,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

export type HyperliquidNetwork = "testnet" | "mainnet";
const NETWORKS = {
  testnet: {
    endpoint: "https://api.hyperliquid-testnet.xyz",
    source: "b",
    chain: "Testnet",
    walletChainId: 421614,
    walletChainHex: "0x66eee",
  },
  mainnet: {
    endpoint: "https://api.hyperliquid.xyz",
    source: "a",
    chain: "Mainnet",
    walletChainId: 42161,
    walletChainHex: "0xa4b1",
  },
} as const;
function networkConfig(network: HyperliquidNetwork) {
  if (network !== "testnet" && network !== "mainnet") throw Error("Unknown Hyperliquid network");
  return NETWORKS[network];
}
const ATOMS = 10n ** 18n;
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const cloidId = z.string().regex(/^0x[0-9a-f]{32}$/);
const coinName = z.string().regex(/^(?:[a-z0-9]{1,16}:)?[A-Za-z0-9@._-]{1,24}$/);
const uint = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveWire = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{0,7}[1-9])?$/)
  .refine((v) => v !== "0");
const rawAmount = z.string().regex(/^-?\d{1,24}(?:\.\d{1,18})?$/);
const assetIndex = z.number().int().nonnegative().max(0x7fffffff);
function atoms(raw: string) {
  rawAmount.parse(raw);
  const negative = raw.startsWith("-");
  const [whole, fractions = ""] = (negative ? raw.slice(1) : raw).split(".");
  const amount = BigInt(whole) * ATOMS + BigInt(fractions.padEnd(18, "0"));
  return negative ? -amount : amount;
}
function decimal(amount: bigint): string {
  if (amount < 0n) return "-" + decimal(-amount);
  const tail = (amount % ATOMS).toString().padStart(18, "0").replace(/0+$/, "");
  return String(amount / ATOMS) + (tail ? "." + tail : "");
}

export type Perp = {
  symbol: string;
  asset: number;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
};
const Market = z.object({
  symbol: coinName,
  asset: assetIndex,
  szDecimals: z.number().int().min(0).max(6),
  maxLeverage: z.number().int().positive(),
  onlyIsolated: z.boolean(),
});

/** Return a marketable limit which cannot widen slippage after tick rounding. */
export function iocLimit(reference: string, isBuy: boolean, maxSlippageBps: number, szDecimals: number) {
  const px = atoms(reference);
  z.number().int().min(0).max(6).parse(szDecimals);
  z.number()
    .int()
    .min(0)
    .max(10_000 - 1)
    .parse(maxSlippageBps);
  if (px <= 0n) throw Error("A positive reference price is required");
  const n = px * BigInt(10_000 + (isBuy ? 1 : -1) * maxSlippageBps);
  const rough = n / 10_000n;
  if (rough <= 0n) throw Error("Price is below supported precision");
  const integerDigits = rough.toString().length - 18;
  const places = Math.max(0, Math.min(6 - szDecimals, 5 - integerDigits));
  const tick = 10n ** BigInt(18 - places);
  const divisor = 10_000n * tick;
  const count = isBuy ? n / divisor : (n + divisor - 1n) / divisor;
  return positiveWire.parse(decimal(count * tick));
}

/** Round DOWN to a venue lot. No order is possible if the authorized size rounds to zero. */
export function sizeFromNotional(notionalUsd: string, reference: string, szDecimals: number) {
  const usd = atoms(notionalUsd),
    px = atoms(reference);
  z.number().int().min(0).max(6).parse(szDecimals);
  if (usd <= 0n || px <= 0n) throw Error("Positive notional and price required");
  const lot = 10n ** BigInt(18 - szDecimals);
  return positiveWire.parse(decimal(((usd * ATOMS) / px / lot) * lot));
}

const WireOrder = z
  .object({
    a: assetIndex,
    b: z.boolean(),
    p: positiveWire,
    s: positiveWire,
    r: z.boolean(),
    t: z.union([
      z.object({ limit: z.object({ tif: z.enum(["Ioc", "Gtc"]) }).strict() }).strict(),
      z
        .object({
          trigger: z
            .object({ isMarket: z.literal(false), triggerPx: positiveWire, tpsl: z.enum(["tp", "sl"]) })
            .strict(),
        })
        .strict(),
    ]),
    c: cloidId.optional(), // historical SDK hash vectors omit c; submission always requires it.
  })
  .strict();
const Action = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("order"), orders: z.array(WireOrder).length(1), grouping: z.literal("na") })
    .strict(),
  z
    .object({
      type: z.literal("cancelByCloid"),
      cancels: z.array(z.object({ asset: assetIndex, cloid: cloidId }).strict()).length(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("updateLeverage"),
      asset: assetIndex,
      isCross: z.boolean(),
      leverage: z.number().int().positive().max(255),
    })
    .strict(),
]);
export type L1Action = z.infer<typeof Action>;

/** Rebuild in SDK field order even when a PostgreSQL JSONB document reorders keys. */
function canonical(action: L1Action): L1Action {
  const parsed = Action.parse(action);
  if (parsed.type === "order") {
    const o = parsed.orders[0];
    return {
      type: "order",
      orders: [
        {
          a: o.a,
          b: o.b,
          p: o.p,
          s: o.s,
          r: o.r,
          t:
            "limit" in o.t
              ? { limit: { tif: o.t.limit.tif } }
              : { trigger: { isMarket: false, triggerPx: o.t.trigger.triggerPx, tpsl: o.t.trigger.tpsl } },
          ...(o.c ? { c: o.c } : {}),
        },
      ],
      grouping: "na",
    };
  }
  if (parsed.type === "cancelByCloid") {
    const c = parsed.cancels[0];
    return { type: "cancelByCloid", cancels: [{ asset: c.asset, cloid: c.cloid }] };
  }
  return { type: "updateLeverage", asset: parsed.asset, isCross: parsed.isCross, leverage: parsed.leverage };
}
export function perpOrder(
  market: Perp,
  isBuy: boolean,
  limit: string,
  quantity: string,
  reduceOnly: boolean,
  cloid: string,
  tif: "Gtc" | "Ioc" = "Ioc",
): L1Action {
  Market.parse(market);
  positiveWire.parse(limit);
  positiveWire.parse(quantity);
  const sizePlaces = (quantity.split(".")[1] ?? "").length;
  if (sizePlaces > market.szDecimals) throw Error("Size exceeds this asset's lot precision");
  if (iocLimit(limit, true, 0, market.szDecimals) !== limit)
    throw Error("Limit violates this asset's price precision");
  return canonical({
    type: "order",
    orders: [
      {
        a: market.asset,
        b: isBuy,
        p: limit,
        s: quantity,
        r: reduceOnly,
        t: { limit: { tif } },
        c: cloidId.parse(cloid),
      },
    ],
    grouping: "na",
  });
}
export function cancelByCloid(market: Perp, cloid: string): L1Action {
  Market.parse(market);
  return canonical({
    type: "cancelByCloid",
    cancels: [{ asset: market.asset, cloid: cloidId.parse(cloid) }],
  });
}
export function updateLeverage(market: Perp, leverage: number, isCross = false): L1Action {
  Market.parse(market);
  if (
    !Number.isInteger(leverage) ||
    leverage < 1 ||
    leverage > market.maxLeverage ||
    (isCross && market.onlyIsolated)
  ) {
    throw Error("Requested leverage or margin mode unavailable for this asset");
  }
  return canonical({ type: "updateLeverage", asset: market.asset, isCross, leverage });
}

/** This implementation only acts on the master's account. A vault/subaccount cannot be supplied. */
export function l1ActionHash(action: L1Action, nonce: number, expiresAfter?: number): Hex {
  uint.parse(nonce);
  const parts = [encode(canonical(action)), numberToBytes(BigInt(nonce), { size: 8 }), Uint8Array.of(0)];
  if (expiresAfter !== undefined) {
    uint.parse(expiresAfter);
    parts.push(Uint8Array.of(0), numberToBytes(BigInt(expiresAfter), { size: 8 }));
  }
  return keccak256(concatBytes(parts));
}
export function l1TypedData(
  action: L1Action,
  nonce: number,
  expiresAfter?: number,
  network: HyperliquidNetwork = "testnet",
) {
  return {
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: zeroAddress },
    primaryType: "Agent",
    types: {
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    message: {
      source: networkConfig(network).source,
      connectionId: l1ActionHash(action, nonce, expiresAfter),
    },
  } as const;
}
export type Grant = { agent: Address; name: string; nonce: number; validUntil: number };
const GrantSchema = z
  .object({ agent: address, name: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/), nonce: uint, validUntil: uint })
  .strict();
export function approvalData(grant: Grant, network: HyperliquidNetwork = "testnet") {
  const config = networkConfig(network);
  GrantSchema.parse(grant);
  if (
    grant.agent.toLowerCase() === zeroAddress ||
    grant.validUntil <= grant.nonce ||
    grant.validUntil - grant.nonce > 180 * 86400000
  )
    throw Error("Invalid named agent or expiry");
  const agentName = grant.name + " valid_until " + grant.validUntil;
  const message = {
    hyperliquidChain: config.chain,
    agentAddress: grant.agent.toLowerCase() as Address,
    agentName,
    nonce: BigInt(grant.nonce),
  } as const;
  const action = {
    type: "approveAgent",
    hyperliquidChain: message.hyperliquidChain,
    signatureChainId: config.walletChainHex,
    agentAddress: message.agentAddress,
    agentName,
    nonce: grant.nonce,
  } as const;
  const typedData = {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: config.walletChainId,
      verifyingContract: zeroAddress,
    },
    primaryType: "HyperliquidTransaction:ApproveAgent",
    types: {
      "HyperliquidTransaction:ApproveAgent": [
        { name: "hyperliquidChain", type: "string" },
        { name: "agentAddress", type: "address" },
        { name: "agentName", type: "string" },
        { name: "nonce", type: "uint64" },
      ],
    },
    message,
  } as const;
  return { action, typedData };
}
/** Hyperliquid's wire type contains a colon, which generic Solidity identifier validators reject. */
export function approvalDigest(grant: Grant, network: HyperliquidNetwork = "testnet"): Hex {
  const {
    typedData: { domain, message },
  } = approvalData(grant, network);
  const str = (s: string) => keccak256(stringToHex(s));
  const domainHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        str("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        str(domain.name),
        str(domain.version),
        BigInt(domain.chainId),
        domain.verifyingContract,
      ],
    ),
  );
  const actionHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint64" },
      ],
      [
        str(
          "HyperliquidTransaction:ApproveAgent(string hyperliquidChain,address agentAddress,string agentName,uint64 nonce)",
        ),
        str(message.hyperliquidChain),
        message.agentAddress,
        str(message.agentName),
        message.nonce,
      ],
    ),
  );
  return keccak256(concatHex(["0x1901", domainHash, actionHash]));
}
/** Serializable EIP-1193 payload for a master-wallet eth_signTypedData_v4 prompt. */
export function walletApprovalPayload(grant: Grant, network: HyperliquidNetwork = "testnet") {
  const { typedData } = approvalData(grant, network);
  const domainFields = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ] as const;
  return {
    ...typedData,
    types: { EIP712Domain: domainFields, ...typedData.types },
    message: { ...typedData.message, nonce: String(typedData.message.nonce) },
  };
}
function wireSignature(signature: Hex) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw Error("Expected canonical 65-byte EVM signature");
  const { r, s, v, yParity } = parseSignature(signature);
  const parity = v === 27n || v === 28n ? Number(v) : yParity === 0 || yParity === 1 ? 27 + yParity : -1;
  if (
    parity < 0 ||
    BigInt(r) === 0n ||
    BigInt(s) === 0n ||
    BigInt(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n
  )
    throw Error("Invalid signature");
  return { r, s, v: parity };
}
/** Older persisted envelopes were exclusively testnet. An absent tag can never authorize mainnet. */
export type SignedL1 = {
  action: L1Action;
  nonce: number;
  expiresAfter: number;
  signature: Hex;
  network?: HyperliquidNetwork;
};
export type TestnetSigner = (data: ReturnType<typeof l1TypedData>) => Promise<Hex>;
export async function signL1(
  network: HyperliquidNetwork,
  action: L1Action,
  nonce: number,
  expiresAfter: number,
  sign: TestnetSigner,
): Promise<SignedL1> {
  if (expiresAfter <= nonce || expiresAfter - nonce > 60_000)
    throw Error("Limit the signed order lifetime to sixty seconds");
  const checked = canonical(action);
  if (checked.type === "order" && !checked.orders[0].c) throw Error("A durable client order id is required");
  return {
    action: checked,
    nonce,
    expiresAfter,
    network,
    signature: await sign(l1TypedData(checked, nonce, expiresAfter, network)),
  };
}

export function signTestnet(action: L1Action, nonce: number, expiresAfter: number, sign: TestnetSigner) {
  return signL1("testnet", action, nonce, expiresAfter, sign);
}

/** Cap a reduce-only IOC to the receipt-confirmed strategy lot and the live position, on its original side. */
export function reduceOnlyClose(
  market: Perp,
  positionSide: "long" | "short",
  signedVenueSize: string,
  remainingOwnedSize: string,
  reference: string,
  slippageBps: number,
  cloid: string,
) {
  const venue = atoms(signedVenueSize),
    owned = atoms(remainingOwnedSize);
  if (
    (positionSide !== "long" && positionSide !== "short") ||
    owned <= 0n ||
    venue === 0n ||
    venue > 0n !== (positionSide === "long")
  )
    throw Error("No matching strategy-owned position to reduce");
  const available = venue < 0n ? -venue : venue;
  const quantity = decimal(available < owned ? available : owned);
  const isBuy = positionSide === "short";
  const limit = iocLimit(reference, isBuy, slippageBps, market.szDecimals);
  return {
    quantity,
    limit,
    side: isBuy ? ("B" as const) : ("A" as const),
    action: perpOrder(market, isBuy, limit, quantity, true, cloid),
  };
}

/** A fixed-size, exchange-resident TP/SL limit uses the mark for its trigger and the owner's explicit execution-price bound. */
export function nativeProtection(
  market: Perp,
  positionSide: "long" | "short",
  signedVenueSize: string,
  ownedSize: string,
  triggerPrice: string,
  maxSlippageBps: number,
  kind: "tp" | "sl",
  cloid: string,
): L1Action {
  // Round a long threshold upward, a short threshold downward (earlier stop or later profit).
  const triggerPx = iocLimit(triggerPrice, positionSide === "short", 0, market.szDecimals);
  const close = reduceOnlyClose(
    market,
    positionSide,
    signedVenueSize,
    ownedSize,
    triggerPx,
    maxSlippageBps,
    cloid,
  );
  if (close.action.type !== "order") throw Error("Invalid protective order");
  return canonical({
    type: "order",
    grouping: "na",
    orders: [{ ...close.action.orders[0], t: { trigger: { isMarket: false, triggerPx, tpsl: kind } } }],
  });
}

/** EIP-1193 wallet form for an explicitly reviewed master order, independent of the network used for wallet login. */
export function walletL1Payload(
  action: L1Action,
  nonce: number,
  expiresAfter: number,
  network: HyperliquidNetwork,
) {
  const d = l1TypedData(action, nonce, expiresAfter, network);
  return {
    ...d,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...d.types,
    },
  };
}

/** The protocol deregisters the old named agent on replacement. No signing secret exists in Quiver for the short-lived replacement address. */
export function revocationReplacement(
  grant: Grant,
  owner: Address,
  nonce: number,
  network: HyperliquidNetwork = "testnet",
): Grant {
  approvalData(grant, network);
  address.parse(owner);
  uint.parse(nonce);
  if (nonce <= grant.nonce) throw Error("Revocation nonce must follow the original grant");
  const commitment = keccak256(
    stringToHex(
      [
        "Quiver agent deregistration v1",
        network,
        owner.toLowerCase(),
        grant.name,
        grant.agent.toLowerCase(),
        String(grant.nonce),
        String(nonce),
      ].join("|"),
    ),
  );
  return {
    agent: ("0x" + commitment.slice(-40)) as Address,
    name: grant.name,
    nonce,
    validUntil: nonce + 60000,
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export class VenueFailure extends Error {
  constructor(
    readonly outcome: "unconfirmed" | "venue_error",
    message: string,
  ) {
    super(message);
  }
}
const Meta = z.object({
  collateralToken: uint.optional(),
  universe: z.array(
    z.object({
      name: z.string(),
      szDecimals: z.number().int().min(0).max(6),
      maxLeverage: z.number().int().positive(),
      isDelisted: z.boolean().optional(),
      onlyIsolated: z.boolean().optional(),
    }),
  ),
});
export class HyperliquidVenue {
  private readonly endpoint: string;
  constructor(
    readonly network: HyperliquidNetwork,
    private readonly send: Fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {
    this.endpoint = networkConfig(network).endpoint;
  }
  walletApprovalPayload(grant: Grant) {
    return walletApprovalPayload(grant, this.network);
  }
  walletRevocationPayload(grant: Grant, owner: Address, nonce: number) {
    return this.walletApprovalPayload(revocationReplacement(grant, owner, nonce, this.network));
  }
  sign(action: L1Action, nonce: number, expiresAfter: number, signer: TestnetSigner) {
    return signL1(this.network, action, nonce, expiresAfter, signer);
  }
  private async post(path: "/info" | "/exchange", body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.send(this.endpoint + path, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error();
      return await response.json();
    } catch {
      throw new VenueFailure("unconfirmed", "No conclusive venue response; reconcile before retrying.");
    }
  }
  async account(owner: Address, symbol?: string) {
    address.parse(owner);
    const dex = symbol?.includes(":") ? symbol.split(":")[0] : "";
    const margin = z.object({
      accountValue: rawAmount,
      totalNtlPos: rawAmount.optional(),
      totalRawUsd: rawAmount.optional(),
      totalMarginUsed: rawAmount.optional(),
    });
    const acct = z.object({
      withdrawable: rawAmount,
      marginSummary: margin,
      crossMarginSummary: margin.optional(),
      assetPositions: z.array(
        z.object({
          position: z.object({
            coin: coinName,
            szi: rawAmount,
            entryPx: rawAmount.nullable().optional(),
            marginUsed: rawAmount.optional(),
            unrealizedPnl: rawAmount.optional(),
            positionValue: rawAmount.optional(),
            liquidationPx: rawAmount.nullable().optional(),
            leverage: z
              .object({ type: z.enum(["cross", "isolated"]), value: uint, rawUsd: rawAmount.optional() })
              .optional(),
            cumFunding: z
              .object({ allTime: rawAmount, sinceOpen: rawAmount, sinceChange: rawAmount })
              .optional(),
          }),
        }),
      ),
    });
    const [state, open] = await Promise.all([
      this.post("/info", { type: "clearinghouseState", user: owner, ...(dex ? { dex } : {}) }),
      this.post("/info", { type: "openOrders", user: owner, ...(dex ? { dex } : {}) }),
    ]);
    const a = acct.parse(state),
      orders = z.array(z.object({ coin: z.string() })).parse(open);
    return {
      positions: a.assetPositions.map((p) => p.position).filter((p) => atoms(p.szi) !== 0n),
      marginSummary: a.marginSummary,
      crossMarginSummary: a.crossMarginSummary ?? null,
      withdrawable: a.withdrawable,
      equity: a.marginSummary.accountValue,
      signedPositionSize: symbol
        ? (a.assetPositions.find((p) => p.position.coin === symbol)?.position.szi ?? "0")
        : null,
      symbolOpenOrders: symbol ? orders.filter((o) => o.coin === symbol).length : null,
      occupied:
        !!symbol &&
        (orders.some((x) => x.coin === symbol) ||
          a.assetPositions.some((x) => x.position.coin === symbol && atoms(x.position.szi) !== 0n)),
    };
  }
  async takerFeeRate(owner: Address) {
    address.parse(owner);
    const v = z
      .object({ userCrossRate: rawAmount })
      .parse(await this.post("/info", { type: "userFees", user: owner.toLowerCase() }));
    if (atoms(v.userCrossRate) < 0n || atoms(v.userCrossRate) > ATOMS / 100n)
      throw Error("Unverifiable taker fee schedule");
    return v.userCrossRate;
  }
  async market(symbol: string): Promise<Perp> {
    coinName.parse(symbol);
    const dex = symbol.includes(":") ? symbol.split(":")[0] : "";
    let offset = 0;
    if (dex) {
      const dexs = z
        .array(z.object({ name: z.string() }).nullable())
        .parse(await this.post("/info", { type: "perpDexs" }));
      const dexIndex = dexs.findIndex((d) => d?.name === dex);
      if (dexIndex <= 0) throw Error("Unknown perpetual DEX");
      offset = 100000 + dexIndex * 10000;
    }
    const { universe, collateralToken } = Meta.parse(
      await this.post("/info", { type: "meta", ...(dex ? { dex } : {}) }),
    );
    // The application's margin ledger is denominated in USDC, mainnet spot token index 0.
    // The original validator-operated dex uses USDC. HIP-3 dexs may use a different collateral.
    if (this.network === "mainnet" && (collateralToken !== undefined ? collateralToken !== 0 : !!dex))
      throw Error("This perpetual does not have verified USDC collateral");
    const index = universe.findIndex((m) => m.name === symbol);
    if (index < 0 || universe[index].isDelisted || index >= 10000) throw Error("Unavailable perpetual");
    const m = universe[index];
    return {
      symbol,
      asset: offset + index,
      szDecimals: m.szDecimals,
      maxLeverage: m.maxLeverage,
      onlyIsolated: m.onlyIsolated ?? false,
    };
  }
  async midpoint(symbol: string) {
    coinName.parse(symbol);
    const lvl = z.object({ px: rawAmount, sz: rawAmount });
    const b = z
      .object({ coin: z.string(), time: uint, levels: z.tuple([z.array(lvl), z.array(lvl)]) })
      .parse(await this.post("/info", { type: "l2Book", coin: symbol }));
    const bid = b.levels[0][0],
      ask = b.levels[1][0],
      age = this.clock() - b.time;
    if (
      b.coin !== symbol ||
      age < -1000 ||
      age > 5000 ||
      !bid ||
      !ask ||
      atoms(bid.sz) <= 0n ||
      atoms(ask.sz) <= 0n ||
      atoms(bid.px) <= 0n ||
      atoms(ask.px) < atoms(bid.px)
    )
      throw Error("No current testnet book");
    return { price: Number(decimal((atoms(bid.px) + atoms(ask.px)) / 2n)), observedAt: b.time };
  }
  async bestPrice(symbol: string, isBuy: boolean, maxAgeMs = 5000): Promise<string> {
    coinName.parse(symbol);
    z.number().int().min(1).max(10_000).parse(maxAgeMs);
    const level = z.object({ px: rawAmount, sz: rawAmount });
    const book = z
      .object({ coin: z.string(), time: uint, levels: z.tuple([z.array(level), z.array(level)]) })
      .parse(await this.post("/info", { type: "l2Book", coin: symbol }));
    const top = book.levels[isBuy ? 1 : 0][0],
      age = this.clock() - book.time;
    if (
      book.coin !== symbol ||
      age < -1000 ||
      age > maxAgeMs ||
      !top ||
      atoms(top.px) <= 0n ||
      atoms(top.sz) <= 0n
    )
      throw Error("No recent executable book quote");
    return decimal(atoms(top.px));
  }
  /** Call with server-stored challenge, authenticated linked owner and its signed response. */
  async approve(grant: Grant, signature: Hex, expectedOwner: Address) {
    address.parse(expectedOwner);
    const now = this.clock(),
      { action } = approvalData(grant, this.network);
    if (
      grant.nonce > now + 2000 ||
      now - grant.nonce > 300000 ||
      grant.validUntil <= now ||
      grant.agent.toLowerCase() === expectedOwner.toLowerCase()
    )
      throw Error("Expired or invalid owner challenge");
    const owner = await recoverAddress({ hash: approvalDigest(grant, this.network), signature });
    if (owner.toLowerCase() !== expectedOwner.toLowerCase())
      throw Error("Agent grant signature does not match the linked wallet");
    this.requireDefault(
      await this.post("/exchange", { action, nonce: grant.nonce, signature: wireSignature(signature) }),
    );
  }
  /** Verify venue role before treating approval, revocation, or replacement as effective. */
  async agentBelongsTo(agent: Address, owner: Address): Promise<boolean> {
    address.parse(agent);
    address.parse(owner);
    const raw = await this.post("/info", { type: "userRole", user: agent.toLowerCase() });
    const r = z.object({ role: z.enum(["missing", "user", "agent", "vault", "subAccount"]) }).parse(raw);
    if (r.role !== "agent") return false;
    const role = z.object({ data: z.object({ user: address }) }).parse(raw);
    return role.data.user.toLowerCase() === owner.toLowerCase();
  }
  async activeGrant(grant: Grant, owner: Address): Promise<boolean> {
    const { action } = approvalData(grant, this.network);
    address.parse(owner);
    if (grant.validUntil <= this.clock()) return false;
    const [roleOk, raw] = await Promise.all([
      this.agentBelongsTo(grant.agent, owner),
      this.post("/info", { type: "extraAgents", user: owner.toLowerCase() }),
    ]);
    const agents = z.array(z.object({ address, name: z.string(), validUntil: uint.nullable() })).parse(raw);
    return (
      roleOk &&
      agents.some(
        (a) =>
          a.address.toLowerCase() === grant.agent.toLowerCase() &&
          (a.name === grant.name || a.name === action.agentName) &&
          a.validUntil === grant.validUntil,
      )
    );
  }
  /** The role and the owner's complete named-agent list must both release the old address. */
  async revocationConfirmed(grant: Grant, owner: Address) {
    address.parse(owner);
    address.parse(grant.agent);
    const [roleOk, raw] = await Promise.all([
      this.agentBelongsTo(grant.agent, owner),
      this.post("/info", { type: "extraAgents", user: owner.toLowerCase() }),
    ]);
    const agents = z.array(z.object({ address })).parse(raw);
    return !roleOk && !agents.some((a) => a.address.toLowerCase() === grant.agent.toLowerCase());
  }
  /** Persist the one-time revoke intent and disable the signer before broadcast. Reconcile an uncertain receipt by reading revocationConfirmed. */
  async revoke(grant: Grant, owner: Address, nonce: number, signature: Hex) {
    if (await this.revocationConfirmed(grant, owner)) return { status: "revoked" as const };
    if (!(await this.activeGrant(grant, owner)))
      throw new VenueFailure("unconfirmed", "The old agent is not identifiable in this named slot.");
    await this.approve(revocationReplacement(grant, owner, nonce, this.network), signature, owner);
    return {
      status: (await this.revocationConfirmed(grant, owner)) ? ("revoked" as const) : ("pending" as const),
    };
  }
  private requireDefault(raw: unknown) {
    const res = z.object({ status: z.string(), response: z.unknown() }).parse(raw);
    if (res.status === "err")
      throw new VenueFailure(
        "venue_error",
        typeof res.response === "string" ? res.response.slice(0, 240) : "Rejected by venue",
      );
    if (res.status !== "ok" || !z.object({ type: z.literal("default") }).safeParse(res.response).success)
      throw new VenueFailure("unconfirmed", "Unexpected venue acknowledgement");
  }
  async submit(signed: SignedL1, expectedAgent: Address) {
    address.parse(expectedAgent);
    if ((signed.network ?? "testnet") !== this.network)
      throw Error("Order signature belongs to a different Hyperliquid network");
    const { nonce, expiresAfter, signature } = signed,
      action = canonical(signed.action),
      now = this.clock();
    if (nonce > now + 2000 || expiresAfter <= nonce || expiresAfter - nonce > 60_000 || now >= expiresAfter)
      throw Error("Expired or invalid venue order envelope");
    if (action.type === "order" && !action.orders[0].c) throw Error("Missing durable client order id");
    const agent = await recoverTypedDataAddress({
      ...l1TypedData(action, nonce, expiresAfter, this.network),
      signature,
    });
    if (agent.toLowerCase() !== expectedAgent.toLowerCase()) throw Error("Unexpected venue agent signature");
    const raw = await this.post("/exchange", {
      action,
      nonce,
      signature: wireSignature(signature),
      expiresAfter,
    });
    if (action.type === "updateLeverage") {
      this.requireDefault(raw);
      return { kind: "acknowledged" } as const;
    }
    const envelope = z.object({ status: z.string(), response: z.unknown() }).parse(raw);
    if (envelope.status === "err")
      throw new VenueFailure(
        "venue_error",
        typeof envelope.response === "string" ? envelope.response.slice(0, 240) : "Venue returned an error",
      );
    const response = z
      .object({
        type: z.enum(["order", "cancel"]),
        data: z.object({ statuses: z.array(z.unknown()).length(1) }),
      })
      .safeParse(envelope.response);
    if (
      envelope.status !== "ok" ||
      !response.success ||
      response.data.type !== (action.type === "order" ? "order" : "cancel")
    )
      throw new VenueFailure("unconfirmed", "Unexpected venue response");
    const item = response.data.data.statuses[0];
    if (action.type === "cancelByCloid" && item === "success") return { kind: "acknowledged" } as const;
    const problem = z.object({ error: z.string() }).safeParse(item);
    if (problem.success) throw new VenueFailure("venue_error", problem.data.error.slice(0, 240));
    if (action.type === "order") {
      if ("trigger" in action.orders[0].t && (item === "waitingForTrigger" || item === "waitingForFill"))
        return { kind: "awaiting_trigger" as const };
      const rest = z.object({ resting: z.object({ oid: uint }) }).safeParse(item);
      if (rest.success) return { kind: "accepted", oid: rest.data.resting.oid } as const;
      const match = z
        .object({ filled: z.object({ oid: uint, totalSz: rawAmount, avgPx: rawAmount }) })
        .safeParse(item);
      if (match.success && atoms(match.data.filled.totalSz) > 0n && atoms(match.data.filled.avgPx) > 0n)
        return { kind: "matched", ...match.data.filled } as const;
    }
    throw new VenueFailure("unconfirmed", "Unrecognized venue order acknowledgement");
  }
  async reconcile(
    owner: Address,
    cloid: string,
    symbol: string,
    side: "A" | "B",
    intendedSize: string,
    terms?: {
      limit: string;
      reduceOnly: boolean;
      submittedAfter: number;
      submittedBefore: number;
      tif?: "Ioc" | "Gtc";
    },
  ) {
    address.parse(owner);
    cloidId.parse(cloid);
    coinName.parse(symbol);
    const status = await this.post("/info", { type: "orderStatus", user: owner.toLowerCase(), oid: cloid });
    if (z.object({ status: z.literal("unknownOid") }).safeParse(status).success)
      return { status: "unconfirmed", complete: false } as const;
    const detail = z
      .object({
        status: z.literal("order"),
        order: z.object({
          order: z.object({
            oid: uint,
            coin: z.string(),
            side: z.enum(["B", "A"]),
            cloid: z.string().nullable().optional(),
            timestamp: uint,
            origSz: rawAmount,
            limitPx: rawAmount.optional(),
            reduceOnly: z.boolean().optional(),
            tif: z.string().nullable().optional(),
            sz: rawAmount,
          }),
          status: z.string(),
        }),
      })
      .parse(status).order;
    const order = detail.order,
      target = atoms(intendedSize),
      remaining = atoms(order.sz);
    if (
      order.coin !== symbol ||
      order.side !== side ||
      order.cloid !== cloid ||
      target <= 0n ||
      atoms(order.origSz) !== target ||
      remaining < 0n ||
      remaining > target
    )
      throw Error("Venue order identity or quantity mismatch");
    if (
      terms &&
      (!order.limitPx ||
        atoms(order.limitPx) !== atoms(terms.limit) ||
        order.reduceOnly !== terms.reduceOnly ||
        order.timestamp < terms.submittedAfter ||
        order.timestamp > terms.submittedBefore ||
        (terms.tif && order.tif !== terms.tif))
    )
      throw Error("Exchange order terms differ from the bound client order ID");
    const range = {
      type: "userFillsByTime",
      user: owner.toLowerCase(),
      startTime: order.timestamp,
      aggregateByTime: false,
    };
    const raw = z.array(z.unknown()).parse(await this.post("/info", range));
    // Retention or a saturated window can omit earlier fills. Demand exact receipts before confirming a full fill.
    const F = z.object({
      oid: uint,
      coin: z.string(),
      side: z.enum(["A", "B"]),
      time: uint,
      tid: uint,
      sz: rawAmount,
      px: rawAmount,
      fee: rawAmount,
      feeToken: z.string().min(1).max(64),
      closedPnl: rawAmount.optional(),
      startPosition: rawAmount.optional(),
      dir: z.string().max(64).optional(),
      hash: z
        .string()
        .regex(/^0x[0-9a-fA-F]{64}$/)
        .optional(),
    });
    const records = new Map<string, z.infer<typeof F>>();
    const fees = new Map<string, bigint>();
    let filled = 0n,
      notional = 0n;
    for (const entry of raw) {
      const same = z.object({ oid: uint }).parse(entry);
      if (same.oid !== order.oid) continue;
      const f = F.parse(entry);
      if (
        f.coin !== symbol ||
        f.side !== side ||
        f.time < order.timestamp ||
        atoms(f.sz) <= 0n ||
        atoms(f.px) <= 0n
      )
        throw Error("Inconsistent venue fill");
      if (terms && (side === "B" ? atoms(f.px) > atoms(terms.limit) : atoms(f.px) < atoms(terms.limit)))
        throw Error("Fill price violates the signed limit");
      const key = [f.time, f.coin, f.tid].join("|"),
        prior = records.get(key);
      if (prior) {
        if (
          prior.px !== f.px ||
          prior.sz !== f.sz ||
          prior.fee !== f.fee ||
          prior.feeToken !== f.feeToken ||
          prior.closedPnl !== f.closedPnl ||
          prior.startPosition !== f.startPosition ||
          prior.dir !== f.dir ||
          prior.hash !== f.hash
        )
          throw Error("Conflicting receipts");
        continue;
      }
      records.set(key, f);
      const qty = atoms(f.sz);
      filled += qty;
      notional += qty * atoms(f.px);
      fees.set(f.feeToken, (fees.get(f.feeToken) ?? 0n) + atoms(f.fee));
    }
    if (filled > target) throw Error("Reported fills exceed the authorized size");
    const complete = detail.status === "filled" && filled === target && remaining === 0n;
    const canceled = /^(?:canceled|[A-Za-z]+Canceled|scheduledCancel)$/.test(detail.status);
    const rejected = detail.status === "rejected" || /Rejected$/.test(detail.status);
    const state = complete
      ? "filled"
      : detail.status === "filled"
        ? "reconciling"
        : canceled
          ? filled
            ? "partial_canceled"
            : "canceled"
          : rejected
            ? filled
              ? "reconciling"
              : "rejected"
            : detail.status === "open"
              ? filled
                ? "partial"
                : "open"
              : "reconciling";
    const shortReceipts = filled !== target - remaining || raw.length >= 2000;
    // The exchange sometimes acknowledges a terminal status before publishing all fills.
    return {
      status: shortReceipts && !complete ? "reconciling" : state,
      complete,
      venueStatus: detail.status,
      oid: order.oid,
      filledSize: decimal(filled),
      executedNotional: decimal(notional / ATOMS),
      realizedClosedPnl: [...records.values()].every((f) => f.closedPnl !== undefined)
        ? decimal([...records.values()].reduce((s, f) => s + atoms(f.closedPnl!), 0n))
        : null,
      requestedSize: decimal(target),
      remainingSize: decimal(target - filled),
      averagePrice: filled ? decimal(notional / filled) : null,
      fees: Object.fromEntries([...fees].map(([t, f]) => [t, decimal(f)])),
      receipts: [...records.values()],
    };
  }
}

/** Compatibility adapter for existing paper-beta routes. Its host and signatures always stay on testnet. */
export class HyperliquidTestnet extends HyperliquidVenue {
  constructor(send: Fetch = fetch, clock: () => number = Date.now) {
    super("testnet", send, clock);
  }
}
