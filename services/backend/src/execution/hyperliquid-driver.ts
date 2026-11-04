import { createHash } from "node:crypto";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type {
  Driver,
  WalletBudget,
  Action,
  LiveProgram,
  CompiledMarket,
  Prepared,
  Evidence,
  Signed,
} from "./live-program";
import type { Amount, Execution, FinalReport } from "./ledger";
import {
  HyperliquidVenue,
  cancelByCloid,
  iocLimit,
  l1TypedData,
  perpOrder,
  reduceOnlyClose,
  sizeFromNotional,
  updateLeverage,
  walletL1Payload,
  type Perp,
  type L1Action,
  type SignedL1,
} from "./hyperliquid-testnet";

const NET = "hyperliquid-mainnet",
  USD = "USDC",
  Q = 10n ** 18n,
  TO_MICRO = 10n ** 12n;
const evm = z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  sig = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
type LiveAuthSignature = { signed: SignedL1; agent: Address };
export type HyperliquidAuthority = {
  active(owner: string, wallet: Address): Promise<boolean>;
  sign(
    owner: string,
    wallet: Address,
    action: L1Action,
    expiresAt: number,
  ): Promise<LiveAuthSignature>;
  allow(owner: string, action: Action): boolean;
  isCurrentAgent?(
    owner: string,
    wallet: Address,
    agent: Address,
  ): boolean | Promise<boolean>;
  cancelAllowed?(owner: string, wallet: Address): boolean;
  reserveOwnerNonces?(
    owner: string,
    wallet: Address,
    count: number,
  ): Promise<number>;
};
type Options = {
  now?: () => number;
  lossUsd6: (wallet: WalletBudget, program: LiveProgram) => Promise<string>;
  equityUsd6?: (
    wallet: WalletBudget,
    program: LiveProgram,
  ) => Promise<string | undefined>;
};
type Packet = { owner: boolean; agent: Address; actions: SignedL1[] };
type OwnerOp = {
  op: "leverage" | "order";
  action: L1Action;
  nonce: number;
  expiresAfter: number;
  typedData: ReturnType<typeof walletL1Payload>;
};
type Payload = {
  kind: "hyperliquid-perp-v1";
  network: typeof NET;
  wallet: string;
  instrument: string;
  market: Perp;
  leg: "entry" | "exit";
  side: "A" | "B";
  leverage: number;
  quantity: string;
  limit: string;
  cloid: string;
  marginUsd6: string;
  feeCapUsd6: string;
  entryBasis: string | null;
  priorHolding?: { quantity: string; averageEntryUsd: number };
  ownerSignatures: OwnerOp[];
  reference: string;
};
const asJson = (v: unknown): Prepared["payload"] =>
  JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object"
  ) {
    const keys = Object.keys(a).sort(),
      right = Object.keys(b).sort();
    return (
      keys.length === right.length &&
      keys.every(
        (k, i) =>
          k === right[i] &&
          same(
            (a as Record<string, unknown>)[k],
            (b as Record<string, unknown>)[k],
          ),
      )
    );
  }
  return a === b;
};
function must(cond: unknown, message: string): asserts cond {
  if (!cond) throw Error(message);
}
function integer(s: string) {
  must(/^(0|[1-9]\d{0,60})$/.test(s), "Invalid raw venue units");
  return BigInt(s);
}
function fixed(s: string) {
  must(
    typeof s === "string" && /^-?(0|[1-9]\d{0,24})(\.\d{1,18})?$/.test(s),
    "Invalid exchange decimal",
  );
  const neg = s[0] === "-",
    [whole, fraction = ""] = (neg ? s.slice(1) : s).split(".");
  const n = BigInt(whole) * Q + BigInt(fraction.padEnd(18, "0"));
  return neg ? -n : n;
}
function decimal(n: bigint): string {
  if (n < 0n) return "-" + decimal(-n);
  const f = (n % Q).toString().padStart(18, "0").replace(/0+$/, "");
  return (n / Q).toString() + (f ? "." + f : "");
}
const ceil = (n: bigint, k: bigint) => (n + k - 1n) / k;
function amounts(map: Map<string, bigint>): Amount[] {
  return [...map]
    .filter(([, v]) => v > 0n)
    .map(([asset, n]) => ({ asset, units: n.toString() }))
    .sort((a, b) => a.asset.localeCompare(b.asset));
}
function total(fills: Execution[], key: "debits" | "credits") {
  const out = new Map<string, bigint>();
  for (const f of fills)
    for (const a of f[key])
      out.set(a.asset, (out.get(a.asset) ?? 0n) + integer(a.units));
  return amounts(out);
}
function cloid(a: Action) {
  return (
    "0x" +
    createHash("sha256")
      .update(
        JSON.stringify([
          NET,
          a.wallet.toLowerCase(),
          a.owner,
          a.programId,
          a.strategyId,
          a.version,
          a.stage,
          a.sequence,
          a.leg,
          a.id,
        ]),
      )
      .digest("hex")
      .slice(0, 32)
  );
}
function assertMarket(m: CompiledMarket) {
  must(
    m.venue === "hyperliquid" &&
      m.kind === "perp" &&
      m.id === "hl:perp:" + m.symbol,
    "Choose the exact resolved Hyperliquid perpetual",
  );
}
function assertBinding(b: WalletBudget) {
  must(
    b.network === NET &&
      evm.safeParse(b.wallet).success &&
      b.settlementAsset === USD &&
      b.decimals === 6,
    "Bind the Hyperliquid mainnet owner and six-decimal USDC allocation",
  );
}
function assertAction(a: Action) {
  assertMarket(a.instrument);
  must(
    a.network === NET &&
      evm.safeParse(a.wallet).success &&
      !!a.owner &&
      !!a.programId &&
      !!a.id,
    "Invalid Hyperliquid owner or network",
  );
  must(
    Number.isSafeInteger(a.leverage) &&
      a.leverage >= 1 &&
      Number.isSafeInteger(a.slippageBps) &&
      a.slippageBps >= 1 &&
      a.slippageBps <= 500 &&
      integer(a.spendUnits) > 0n,
    "Invalid leverage, slippage or size",
  );
  must(
    (a.side === "long" || a.side === "short") &&
      (a.leg === "entry"
        ? !a.reduceOnly && a.spendAsset === USD
        : a.leg === "exit" && a.reduceOnly && a.spendAsset === a.instrument.id),
    "Invalid perpetual entry or reduction",
  );
}
/** Account entryPx can be reported at venue tick precision; fill-weighted averages can sit between two ticks. */
function sameEntryBasis(a: string, b: string, szDecimals: number) {
  const x = fixed(a),
    y = fixed(b);
  if (x <= 0n || y <= 0n) return false;
  const places = Math.max(
    0,
    Math.min(6 - szDecimals, 5 - (x.toString().length - 18)),
  );
  const tick = 10n ** BigInt(18 - places),
    difference = x > y ? x - y : y - x;
  return 2n * difference <= tick;
}
function entryLineage(
  fills: { startPosition?: string; sz: string; dir?: string }[],
  side: "A" | "B",
  prior: bigint,
) {
  if (
    !fills.length ||
    fills.some(
      (f) =>
        f.startPosition === undefined ||
        f.dir !== (side === "B" ? "Open Long" : "Open Short"),
    )
  )
    return false;
  const direction = side === "B" ? 1n : -1n;
  const sequence = fills
    .map((f) => ({
      before: direction * fixed(f.startPosition!),
      qty: fixed(f.sz),
    }))
    .sort((a, b) => (a.before < b.before ? -1 : a.before > b.before ? 1 : 0));
  let last = prior;
  for (const f of sequence) {
    if (f.before !== last) return false;
    last += f.qty;
  }
  return true;
}
function prior(a: Action) {
  const h = (
    a as Action & {
      priorHolding?: { quantity: string; averageEntryUsd: number };
    }
  ).priorHolding;
  if (h) {
    must(
      integer(h.quantity) > 0n &&
        Number.isFinite(h.averageEntryUsd) &&
        h.averageEntryUsd > 0,
      "Invalid previous position proof",
    );
  }
  return h;
}
function numberPrice(n: number) {
  return n.toFixed(18).replace(/\.?0+$/, "");
}
type VenueAccount = Awaited<ReturnType<HyperliquidVenue["account"]>>;
function prePosition(a: Action, market: Perp, account: VenueAccount) {
  const b = prior(a),
    pos = account.positions.find((x) => x.coin === market.symbol);
  if (a.leg === "entry" && !b) {
    must(
      !account.occupied,
      "A position or order already exists on this market",
    );
    return null;
  }
  const expected = b ? integer(b.quantity) : integer(a.spendUnits);
  const sign = (a.side === "long") === (a.leg === "entry") ? 1n : -1n;
  must(
    pos?.entryPx &&
      pos.leverage?.type === "isolated" &&
      pos.leverage.value === a.leverage &&
      account.symbolOpenOrders === 0 &&
      fixed(pos.szi) === sign * expected,
    "Position size, direction, leverage or competing orders changed",
  );
  const anchor =
    b?.averageEntryUsd ??
    (a as Action & { entryAverageUsd?: number }).entryAverageUsd;
  if (anchor !== undefined)
    must(
      sameEntryBasis(pos.entryPx, numberPrice(anchor), market.szDecimals),
      "Wallet entry basis differs from the receipt-confirmed lot",
    );
  if (a.leg === "exit")
    must(
      integer(a.spendUnits) <= expected,
      "Cannot reduce more than the verified lot",
    );
  return pos;
}
/** Rebuild action fields independently of PostgreSQL JSONB key order. */
function actions(p: Payload) {
  const trade = perpOrder(
    p.market,
    p.side === "B",
    p.limit,
    p.quantity,
    p.leg === "exit",
    p.cloid,
  );
  return p.leg === "exit" || p.priorHolding
    ? [trade]
    : [updateLeverage(p.market, p.leverage, false), trade];
}
function requiredFee(quantity: string, upperPx: string, rate: string) {
  const notional = ceil(fixed(quantity) * fixed(upperPx), Q),
    fee = ceil(notional * fixed(rate) * 11n, 10n * Q * TO_MICRO);
  // The exact fill fee is reconciled. One extra USDC micro-unit covers provider rounding.
  return fee + 1n;
}
function assertPayload(a: Action, t: Prepared): Payload {
  assertAction(a);
  const p = t.payload as unknown as Payload;
  must(
    p &&
      p.kind === "hyperliquid-perp-v1" &&
      p.network === NET &&
      p.wallet === a.wallet &&
      p.instrument === a.instrument.id &&
      p.market.symbol === a.instrument.symbol &&
      p.leg === a.leg &&
      p.leverage === a.leverage &&
      p.cloid === cloid(a) &&
      same(p.priorHolding, prior(a)) &&
      p.side === (a.side === "long" ? "B" : "A"),
    "Pinned perpetual terms mismatch",
  );
  must(
    fixed(p.quantity) === integer(t.targetUnits) &&
      fixed(p.limit) > 0n &&
      fixed(p.reference) > 0n &&
      (a.leg === "entry"
        ? p.marginUsd6 === a.spendUnits && p.entryBasis === null
        : p.marginUsd6 === "0" &&
          t.targetUnits === a.spendUnits &&
          p.entryBasis !== null &&
          fixed(p.entryBasis) > 0n),
    "Pinned perpetual size or basis mismatch",
  );
  must(
    p.limit ===
      iocLimit(p.reference, p.side === "B", a.slippageBps, p.market.szDecimals),
    "Pinned order price does not match slippage",
  );
  if (a.leg === "entry") {
    const upper = decimal(
      ceil(fixed(p.reference) * BigInt(10000 + a.slippageBps), 10000n),
    );
    must(
      p.quantity ===
        sizeFromNotional(
          decimal(integer(a.spendUnits) * TO_MICRO * BigInt(a.leverage)),
          upper,
          p.market.szDecimals,
        ),
      "Size differs from the authorized margin, reference and lot precision",
    );
  }
  const fee = integer(p.feeCapUsd6);
  must(fee > 0n, "An explicit exchange fee cap is required");
  const reserve =
    a.leg === "entry"
      ? [{ asset: USD, units: (integer(a.spendUnits) + fee).toString() }]
      : [
          { asset: a.instrument.id, units: a.spendUnits },
          { asset: USD, units: p.feeCapUsd6 },
        ];
  must(
    same(t.reserves, reserve),
    "Pinned fees or collateral differ from the reservation",
  );
  const raw = actions(p);
  must(
    Array.isArray(p.ownerSignatures) &&
      (p.ownerSignatures.length === 0 ||
        p.ownerSignatures.length === raw.length),
    "Invalid owner signing packet",
  );
  for (const [i, op] of p.ownerSignatures.entries()) {
    must(
      same(op.action, raw[i]) &&
        op.op === (raw[i].type === "order" ? "order" : "leverage") &&
        op.expiresAfter === t.expiresAt &&
        same(
          op.typedData,
          walletL1Payload(raw[i], op.nonce, op.expiresAfter, "mainnet"),
        ),
      "Owner signing challenge changed",
    );
  }
  return p;
}
async function verifyPacket(p: Payload, t: Prepared, v: Packet, at: number) {
  const expected = actions(p);
  must(
    evm.safeParse(v.agent).success &&
      (v.owner
        ? v.agent.toLowerCase() === p.wallet.toLowerCase()
        : v.agent.toLowerCase() !== p.wallet.toLowerCase()) &&
      v.actions.length === expected.length,
    "Unexpected Hyperliquid signer or action count",
  );
  for (const [i, s] of v.actions.entries()) {
    must(
      s.network === "mainnet" &&
        s.expiresAfter === t.expiresAt &&
        s.nonce <= at + 2000 &&
        s.expiresAfter > s.nonce &&
        s.expiresAfter - s.nonce <= 60000 &&
        at < s.expiresAfter &&
        same(s.action, expected[i]) &&
        sig.safeParse(s.signature).success &&
        (!i || v.actions[i - 1].nonce < s.nonce),
      "Invalid signed order lifetime, nonce, domain or terms",
    );
    if (v.owner)
      must(
        p.ownerSignatures[i]?.nonce === s.nonce,
        "Missing pinned owner nonce",
      );
    const signer = await recoverTypedDataAddress({
      ...l1TypedData(expected[i], s.nonce, s.expiresAfter, "mainnet"),
      signature: s.signature,
    });
    must(
      signer.toLowerCase() === v.agent.toLowerCase(),
      "The wallet signature belongs to a different account",
    );
  }
}

/** USDC is counted in micro-units, lots in 18-decimal integer units. The public venue determines marks, fees and account balances. */
export function makeHyperliquidDriver(
  venue: HyperliquidVenue,
  authority: HyperliquidAuthority,
  options: Options,
): Driver {
  must(
    venue.network === "mainnet",
    "A fixed Hyperliquid mainnet transport is required",
  );
  const now = options.now ?? Date.now;
  async function activeAgent(a: Action, agent: Address) {
    const wallet = a.wallet as Address;
    return (
      (await authority.active(a.owner, wallet)) &&
      (await (authority.isCurrentAgent?.(a.owner, wallet, agent) ?? true)) &&
      (await venue.agentBelongsTo(agent, wallet))
    );
  }
  async function validateLive(a: Action, t: Prepared, p: Payload) {
    must(
      authority.allow(a.owner, a) && now() < t.expiresAt,
      "Execution permission or order terms expired",
    );
    const [market, bal, fee, book] = await Promise.all([
      venue.market(p.market.symbol),
      venue.account(a.wallet as Address, p.market.symbol),
      venue.takerFeeRate(a.wallet as Address),
      venue.bestPrice(p.market.symbol, p.side === "B"),
    ]);
    must(
      same(market, p.market) && a.leverage <= market.maxLeverage,
      "The selected market or leverage limit changed",
    );
    must(
      fixed(bal.withdrawable) >=
        integer(t.reserves.find((r) => r.asset === USD)!.units) * TO_MICRO,
      "Available collateral or fees changed",
    );
    const pos = prePosition(a, market, bal);
    if (a.leg === "exit")
      must(
        pos?.entryPx && fixed(pos.entryPx) === fixed(p.entryBasis!),
        "Position entry basis changed",
      );
    const upper = decimal(
      ceil(fixed(p.reference) * BigInt(10000 + a.slippageBps), 10000n),
    );
    const best = fixed(book),
      limit = fixed(p.limit);
    must(
      (p.side === "B" ? best <= limit : best >= limit) &&
        (p.leg === "exit" || best <= fixed(upper)),
      "The available book moved outside the authorized quote range",
    );
    must(
      requiredFee(p.quantity, upper, fee) <= integer(p.feeCapUsd6),
      "The exchange fee schedule changed",
    );
  }
  return {
    async readiness(b, m, s) {
      try {
        assertBinding(b);
        assertMarket(m);
        const market = await venue.market(m.symbol);
        must(
          !m.symbol.includes(":"),
          "This workflow wallet requires the native USDC perpetual DEX; builder DEX balances and fees are separate",
        );
        must(
          s.side === "long" || s.side === "short",
          "A perpetual entry must be long or short",
        );
        updateLeverage(market, s.leverage, false);
        return null;
      } catch (e) {
        return e instanceof Error
          ? e.message
          : "The perpetual cannot be verified";
      }
    },
    async balance(
      b: WalletBudget,
      p: LiveProgram,
      purpose?: "start" | "risk" | "reduce",
    ) {
      assertBinding(b);
      const [v, loss, equity] = await Promise.all([
        venue.account(b.wallet as Address),
        purpose === "reduce" ? Promise.resolve("0") : options.lossUsd6(b, p),
        purpose === "reduce" ? undefined : options.equityUsd6?.(b, p),
      ]);
      if (equity !== undefined) integer(equity);
      integer(loss);
      const cash = fixed(v.withdrawable);
      must(cash >= 0n, "Unverifiable available collateral");
      const free = [
        { asset: USD, units: (cash / TO_MICRO).toString() },
        ...v.positions.map((x) => ({
          asset: "hl:perp:" + x.coin,
          units: (fixed(x.szi) < 0n ? -fixed(x.szi) : fixed(x.szi)).toString(),
        })),
      ];
      return {
        network: NET,
        wallet: b.wallet,
        settlementAsset: USD,
        decimals: 6,
        observedAt: now(),
        free,
        lossUsd6: loss,
        ...(equity === undefined ? {} : { equityUsd6: equity }),
      };
    },
    async prepare(a) {
      assertAction(a);
      must(
        authority.allow(a.owner, a),
        "Wallet policy does not permit this action",
      );
      const symbol = a.instrument.symbol;
      must(!symbol.includes(":"), "Native USDC perpetuals required");
      const long = a.side === "long",
        entry = a.leg === "entry",
        owner = a.wallet as Address;
      const [market, reference, bal, feeRate] = await Promise.all([
        venue.market(symbol),
        venue.bestPrice(symbol, long),
        venue.account(owner, symbol),
        venue.takerFeeRate(owner),
      ]);
      updateLeverage(market, a.leverage, false);
      const upper = decimal(
          ceil(fixed(reference) * BigInt(10000 + a.slippageBps), 10000n),
        ),
        contract = cloid(a);
      const limit = iocLimit(reference, long, a.slippageBps, market.szDecimals);
      const cash = integer(a.spendUnits),
        quantity = entry
          ? sizeFromNotional(
              decimal(cash * TO_MICRO * BigInt(a.leverage)),
              upper,
              market.szDecimals,
            )
          : decimal(cash);
      const gross = (fixed(quantity) * fixed(reference)) / Q;
      let entryBasis: string | null = null;
      const pos = prePosition(a, market, bal);
      if (entry)
        must(
          gross >= 10n * Q,
          "Size falls below the minimum perpetual order value",
        );
      else {
        must(pos?.entryPx, "Receipt-confirmed position unavailable");
        const close = reduceOnlyClose(
          market,
          long ? "short" : "long",
          pos.szi,
          quantity,
          reference,
          a.slippageBps,
          contract,
        );
        must(
          close.quantity === quantity,
          "The owned position is no longer available",
        );
        entryBasis = pos.entryPx;
      }
      const fee = requiredFee(quantity, upper, feeRate),
        reserve = (entry ? cash : 0n) + fee;
      must(
        fixed(bal.withdrawable) >= reserve * TO_MICRO,
        "Insufficient free USDC for the bounded margin and fee reserve",
      );
      const expiresAt = now() + 30000;
      const p: Payload = {
        kind: "hyperliquid-perp-v1",
        network: NET,
        wallet: a.wallet,
        instrument: a.instrument.id,
        market,
        leg: a.leg,
        side: long ? "B" : "A",
        leverage: a.leverage,
        quantity,
        limit,
        cloid: contract,
        marginUsd6: entry ? a.spendUnits : "0",
        feeCapUsd6: fee.toString(),
        entryBasis,
        ...(prior(a) ? { priorHolding: prior(a) } : {}),
        reference,
        ownerSignatures: [],
      };
      if (authority.reserveOwnerNonces) {
        const ops = actions(p),
          first = await authority.reserveOwnerNonces(
            a.owner,
            owner,
            ops.length,
          );
        for (const [i, op] of ops.entries()) {
          const nonce = first + i;
          must(
            Number.isSafeInteger(nonce) &&
              nonce <= now() + 2000 &&
              expiresAt > nonce &&
              expiresAt - nonce <= 60000,
            "Unusable owner nonce",
          );
          p.ownerSignatures.push({
            op: op.type === "order" ? "order" : "leverage",
            action: op,
            nonce,
            expiresAfter: expiresAt,
            typedData: walletL1Payload(op, nonce, expiresAt, "mainnet"),
          });
        }
      }
      const reserves: Amount[] = entry
        ? [{ asset: USD, units: reserve.toString() }]
        : [
            { asset: a.instrument.id, units: a.spendUnits },
            { asset: USD, units: fee.toString() },
          ];
      const terms = {
        payload: asJson(p),
        expiresAt,
        targetUnits: fixed(quantity).toString(),
        reserves,
        summary:
          (entry ? (long ? "Open long " : "Open short ") : "Reduce only ") +
          quantity +
          " " +
          symbol +
          " · isolated " +
          a.leverage +
          "× · IOC limit " +
          limit +
          " USDC",
      };
      assertPayload(a, terms);
      return terms;
    },
    async delegated(a) {
      return (
        authority.allow(a.owner, a) &&
        (await authority.active(a.owner, a.wallet as Address))
      );
    },
    async seal(a, t, auth) {
      const p = assertPayload(a, t);
      await validateLive(a, t, p);
      const wallet = a.wallet as Address,
        ops = actions(p);
      const manual =
        auth.kind === "wallet"
          ? z
              .object({ signatures: z.array(sig).min(1).max(2) })
              .strict()
              .safeParse(auth.value)
          : null;
      let packet: Packet;
      if (manual?.success) {
        must(
          p.ownerSignatures.length === ops.length &&
            manual.data.signatures.length === ops.length,
          "Sign each exact order challenge",
        );
        packet = {
          owner: true,
          agent: wallet,
          actions: ops.map((action, i) => ({
            network: "mainnet",
            action,
            nonce: p.ownerSignatures[i].nonce,
            expiresAfter: t.expiresAt,
            signature: manual.data.signatures[i] as Hex,
          })),
        };
      } else {
        must(
          (auth.kind === "delegate" ||
            (auth.kind === "wallet" &&
              z
                .object({ reviewed: z.literal(true) })
                .strict()
                .safeParse(auth.value).success)) &&
            (await authority.active(a.owner, wallet)),
          "A valid owner signature or verified trading grant is required",
        );
        const authorized: LiveAuthSignature[] = [];
        for (const op of ops)
          authorized.push(
            await authority.sign(a.owner, wallet, op, t.expiresAt),
          );
        const agent = authorized[0].agent;
        must(
          authorized.every(
            (s) => s.agent.toLowerCase() === agent.toLowerCase(),
          ),
          "The exchange grant changed during signing",
        );
        must(
          await activeAgent(a, agent),
          "The signer is not an active exchange agent of this wallet",
        );
        packet = {
          owner: false,
          agent,
          actions: authorized.map((s) => s.signed),
        };
      }
      await verifyPacket(p, t, packet, now());
      return { recoveryId: p.cloid, packet: asJson(packet) };
    },
    async broadcast(a, t, s) {
      const p = assertPayload(a, t),
        v = s.packet as unknown as Packet;
      must(s.recoveryId === p.cloid, "Unexpected exchange client order ID");
      await validateLive(a, t, p);
      await verifyPacket(p, t, v, now());
      for (const [index, op] of v.actions.entries()) {
        if (index > 0) await validateLive(a, t, p);
        must(
          authority.allow(a.owner, a) &&
            now() < t.expiresAt &&
            (v.owner || (await activeAgent(a, v.agent))),
          "Execution authority changed",
        );
        // updateLeverage is intentionally independent of the IOC. Only submit the order after explicit leverage acknowledgement.
        const result = await venue.submit(op, v.agent);
        if (op.action.type === "updateLeverage")
          must(
            result.kind === "acknowledged",
            "Leverage update was not acknowledged",
          );
      }
    },
    async reconcile(a, t, id) {
      const p = assertPayload(a, t);
      must(id === p.cloid, "Unexpected exchange order reference");
      const r = await venue.reconcile(
        a.wallet as Address,
        id,
        p.market.symbol,
        p.side,
        p.quantity,
        {
          limit: p.limit,
          reduceOnly: p.leg === "exit",
          submittedAfter: t.expiresAt - 35000,
          submittedBefore: t.expiresAt + 5000,
          tif: "Ioc",
        },
      );
      const e: Evidence & {
        perpetual?: {
          averagePrice: string | null;
          executedNotional: string;
          realizedClosedPnl: string | null;
          fees: Record<string, string>;
          filledSize: string;
          requestedSize: string;
          status: string;
        };
      } = { network: NET, wallet: a.wallet, recoveryId: id, fills: [] };
      if (!("receipts" in r) || !r.receipts) return e;
      e.perpetual = {
        averagePrice: r.averagePrice,
        executedNotional: r.executedNotional,
        realizedClosedPnl: r.realizedClosedPnl,
        fees: r.fees,
        filledSize: r.filledSize,
        requestedSize: r.requestedSize,
        status: r.status,
      };
      const orderRef = "hl:" + r.oid;
      e.ref = orderRef;
      for (const f of r.receipts) {
        must(f.feeToken === USD, "Unexpected fee settlement asset");
        const qty = fixed(f.sz),
          fee = fixed(f.fee);
        must(
          fee % TO_MICRO === 0n,
          "Fee does not fit the settlement precision",
        );
        const fees = fee / TO_MICRO,
          credits = new Map<string, bigint>(),
          debits = new Map<string, bigint>();
        if (p.leg === "entry") {
          const margin = ceil(
            qty * fixed(f.px),
            Q * TO_MICRO * BigInt(p.leverage),
          );
          debits.set(USD, margin + (fees > 0n ? fees : 0n));
          credits.set(a.instrument.id, qty);
          if (fees < 0n) credits.set(USD, -fees);
        } else {
          must(
            f.closedPnl !== undefined,
            "Confirmed realized PnL is required for a close receipt",
          );
          const realized = fixed(f.closedPnl);
          must(
            realized % TO_MICRO === 0n,
            "Realized PnL does not fit settlement precision",
          );
          const released =
              (qty * fixed(p.entryBasis!)) /
              (Q * TO_MICRO * BigInt(p.leverage)),
            restored = released + realized / TO_MICRO;
          debits.set(a.instrument.id, qty);
          debits.set(
            USD,
            (fees > 0n ? fees : 0n) + (restored < 0n ? -restored : 0n),
          );
          credits.set(
            USD,
            (restored > 0n ? restored : 0n) + (fees < 0n ? -fees : 0n),
          );
        }
        e.fills.push({
          fillId: "hl:" + f.time + ":" + f.tid,
          orderRef,
          qty: qty.toString(),
          debits: amounts(debits),
          credits: amounts(credits),
        });
      }
      const status = r.complete
        ? "filled"
        : r.status === "rejected"
          ? "rejected"
          : r.status === "canceled" || r.status === "partial_canceled"
            ? "cancelled"
            : null;
      if (status)
        e.final = {
          orderRef,
          outcome: status,
          cumulativeQty: fixed(r.filledSize!).toString(),
          cumulativeDebits: total(e.fills, "debits"),
          cumulativeCredits: total(e.fills, "credits"),
        } satisfies FinalReport;
      if (p.leg === "entry" && e.fills.length && r.averagePrice) {
        const v = await venue.account(a.wallet as Address, p.market.symbol),
          pos = v.positions.find((x) => x.coin === p.market.symbol);
        // Do not convert a wallet's unrelated/externally resized position into a strategy-owned exit.
        const start = p.priorHolding ? integer(p.priorHolding.quantity) : 0n,
          filled = fixed(r.filledSize!),
          end = start + filled;
        const aggregate = decimal(
          ((p.priorHolding
            ? fixed(numberPrice(p.priorHolding.averageEntryUsd)) * start
            : 0n) +
            fixed(r.averagePrice) * filled) /
            end,
        );
        if (
          pos?.entryPx &&
          sameEntryBasis(pos.entryPx, aggregate, p.market.szDecimals) &&
          entryLineage(r.receipts, p.side, start) &&
          pos.leverage?.type === "isolated" &&
          pos.leverage.value === p.leverage &&
          fixed(pos.szi) === (p.side === "B" ? 1n : -1n) * end
        ) {
          e.holding = {
            asset: a.instrument.id,
            quantity: fixed(r.filledSize!).toString(),
            averageEntryUsd: Number(r.averagePrice),
            openedAt: Math.min(...r.receipts.map((f) => f.time)),
            quantityDecimals: 18,
          } as NonNullable<Evidence["holding"]> & { quantityDecimals: number };
        }
      }
      // A fill can arrive before the account update. Keep polling for verified lot ownership before releasing dependent orders.
      if (p.leg === "entry" && r.complete && !e.holding) {
        delete e.final;
        e.perpetual.status = "reconciling_position";
      }
      return e;
    },
    async cancel(a, t, id) {
      const p = assertPayload(a, t),
        wallet = a.wallet as Address;
      must(p.cloid === id, "Unexpected cancellation ID");
      if (
        !(
          authority.cancelAllowed?.(a.owner, wallet) ??
          authority.allow(a.owner, a)
        ) ||
        !(await authority.active(a.owner, wallet))
      )
        return "unavailable";
      const end = now() + 15000,
        { signed, agent } = await authority.sign(
          a.owner,
          wallet,
          cancelByCloid(p.market, id),
          end,
        );
      must(
        same(signed.action, cancelByCloid(p.market, id)) &&
          signed.network === "mainnet" &&
          signed.expiresAfter === end,
        "Unexpected cancellation signature",
      );
      must(
        (await (authority.isCurrentAgent?.(a.owner, wallet, agent) ?? true)) &&
          (await venue.agentBelongsTo(agent, wallet)),
        "Cancel signer does not belong to this wallet",
      );
      await venue.submit(signed, agent);
      return "requested";
    },
  };
}
