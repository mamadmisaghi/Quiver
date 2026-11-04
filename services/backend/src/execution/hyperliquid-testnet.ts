/** Narrow Hyperliquid testnet perp wire primitives. All amounts are decimal strings. */
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

const ENDPOINT = "https://api.hyperliquid-testnet.xyz";
const CHAIN_ID = 421614; // Arbitrum Sepolia, as used by the official Python SDK for user-signed actions.
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
    t: z.object({ limit: z.object({ tif: z.enum(["Ioc", "Gtc"]) }).strict() }).strict(),
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
          t: { limit: { tif: o.t.limit.tif } },
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
export function l1TypedData(action: L1Action, nonce: number, expiresAfter?: number) {
  return {
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: zeroAddress },
    primaryType: "Agent",
    types: {
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    message: { source: "b", connectionId: l1ActionHash(action, nonce, expiresAfter) },
  } as const;
}
export type Grant = { agent: Address; name: string; nonce: number; validUntil: number };
const GrantSchema = z
  .object({ agent: address, name: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/), nonce: uint, validUntil: uint })
  .strict();
export function approvalData(grant: Grant) {
  GrantSchema.parse(grant);
  if (
    grant.agent.toLowerCase() === zeroAddress ||
    grant.validUntil <= grant.nonce ||
    grant.validUntil - grant.nonce > 180 * 86400000
  )
    throw Error("Invalid named agent or expiry");
  const agentName = grant.name + " valid_until " + grant.validUntil;
  const message = {
    hyperliquidChain: "Testnet",
    agentAddress: grant.agent.toLowerCase() as Address,
    agentName,
    nonce: BigInt(grant.nonce),
  } as const;
  const action = {
    type: "approveAgent",
    hyperliquidChain: message.hyperliquidChain,
    signatureChainId: "0x66eee",
    agentAddress: message.agentAddress,
    agentName,
    nonce: grant.nonce,
  } as const;
  const typedData = {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: CHAIN_ID,
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
export function approvalDigest(grant: Grant): Hex {
  const {
    typedData: { domain, message },
  } = approvalData(grant);
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
export function walletApprovalPayload(grant: Grant) {
  const { typedData } = approvalData(grant);
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
export type SignedL1 = { action: L1Action; nonce: number; expiresAfter: number; signature: Hex };
export type TestnetSigner = (data: ReturnType<typeof l1TypedData>) => Promise<Hex>;
export async function signTestnet(
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
    signature: await sign(l1TypedData(checked, nonce, expiresAfter)),
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
export class HyperliquidTestnet {
  constructor(
    private readonly send: Fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}
  private async post(path: "/info" | "/exchange", body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.send(ENDPOINT + path, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error();
      return await response.json();
    } catch {
      throw new VenueFailure("unconfirmed", "No conclusive testnet response; reconcile before retrying.");
    }
  }
  async account(owner: Address, symbol?: string) {
    address.parse(owner);
    const dex = symbol?.includes(":") ? symbol.split(":")[0] : "";
    const acct = z.object({
      withdrawable: rawAmount,
      marginSummary: z.object({ accountValue: rawAmount }),
      assetPositions: z.array(z.object({ position: z.object({ coin: z.string(), szi: rawAmount }) })),
    });
    const [state, open] = await Promise.all([
      this.post("/info", { type: "clearinghouseState", user: owner, ...(dex ? { dex } : {}) }),
      this.post("/info", { type: "openOrders", user: owner, ...(dex ? { dex } : {}) }),
    ]);
    const a = acct.parse(state),
      orders = z.array(z.object({ coin: z.string() })).parse(open);
    return {
      withdrawable: a.withdrawable,
      equity: a.marginSummary.accountValue,
      occupied:
        !!symbol &&
        (orders.some((x) => x.coin === symbol) ||
          a.assetPositions.some((x) => x.position.coin === symbol && atoms(x.position.szi) !== 0n)),
    };
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
      if (dexIndex <= 0) throw Error("Unknown testnet perp DEX");
      offset = 100000 + dexIndex * 10000;
    }
    const { universe } = Meta.parse(await this.post("/info", { type: "meta", ...(dex ? { dex } : {}) }));
    const index = universe.findIndex((m) => m.name === symbol);
    if (index < 0 || universe[index].isDelisted || index >= 10000)
      throw Error("Unavailable testnet perpetual");
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
      { action, typedData } = approvalData(grant);
    if (
      grant.nonce > now + 2000 ||
      now - grant.nonce > 300000 ||
      grant.validUntil <= now ||
      grant.agent.toLowerCase() === expectedOwner.toLowerCase()
    )
      throw Error("Expired or invalid owner challenge");
    const owner = await recoverAddress({ hash: approvalDigest(grant), signature });
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
    const role = z
      .object({ role: z.string(), data: z.object({ user: address }).optional() })
      .parse(await this.post("/info", { type: "userRole", user: agent.toLowerCase() }));
    return role.role === "agent" && role.data?.user.toLowerCase() === owner.toLowerCase();
  }
  async activeGrant(grant: Grant, owner: Address): Promise<boolean> {
    const { action } = approvalData(grant);
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
  private requireDefault(raw: unknown) {
    const res = z.object({ status: z.string(), response: z.unknown() }).parse(raw);
    if (res.status === "err")
      throw new VenueFailure(
        "venue_error",
        typeof res.response === "string" ? res.response.slice(0, 240) : "Rejected by venue",
      );
    if (res.status !== "ok" || !z.object({ type: z.literal("default") }).safeParse(res.response).success)
      throw new VenueFailure("unconfirmed", "Unexpected testnet acknowledgement");
  }
  async submit(signed: SignedL1, expectedAgent: Address) {
    address.parse(expectedAgent);
    const { nonce, expiresAfter, signature } = signed,
      action = canonical(signed.action),
      now = this.clock();
    if (nonce > now + 2000 || expiresAfter <= nonce || expiresAfter - nonce > 60_000 || now >= expiresAfter)
      throw Error("Expired or invalid testnet order envelope");
    if (action.type === "order" && !action.orders[0].c) throw Error("Missing durable client order id");
    const agent = await recoverTypedDataAddress({ ...l1TypedData(action, nonce, expiresAfter), signature });
    if (agent.toLowerCase() !== expectedAgent.toLowerCase())
      throw Error("Unexpected testnet agent signature");
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
      throw new VenueFailure("unconfirmed", "Unexpected testnet response");
    const item = response.data.data.statuses[0];
    if (action.type === "cancelByCloid" && item === "success") return { kind: "acknowledged" } as const;
    const problem = z.object({ error: z.string() }).safeParse(item);
    if (problem.success) throw new VenueFailure("venue_error", problem.data.error.slice(0, 240));
    if (action.type === "order") {
      const rest = z.object({ resting: z.object({ oid: uint }) }).safeParse(item);
      if (rest.success) return { kind: "accepted", oid: rest.data.resting.oid } as const;
      const match = z
        .object({ filled: z.object({ oid: uint, totalSz: rawAmount, avgPx: rawAmount }) })
        .safeParse(item);
      if (match.success && atoms(match.data.filled.totalSz) > 0n && atoms(match.data.filled.avgPx) > 0n)
        return { kind: "matched", ...match.data.filled } as const;
    }
    throw new VenueFailure("unconfirmed", "Unrecognized testnet order acknowledgement");
  }
  async reconcile(owner: Address, cloid: string, symbol: string, side: "A" | "B", intendedSize: string) {
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
        throw Error("Inconsistent testnet fill");
      const key = [f.time, f.coin, f.tid].join("|"),
        prior = records.get(key);
      if (prior) {
        if (prior.px !== f.px || prior.sz !== f.sz || prior.fee !== f.fee || prior.feeToken !== f.feeToken)
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
      requestedSize: decimal(target),
      remainingSize: decimal(target - filled),
      averagePrice: filled ? decimal(notional / filled) : null,
      fees: Object.fromEntries([...fees].map(([t, f]) => [t, decimal(f)])),
      receipts: [...records.values()],
    };
  }
}
