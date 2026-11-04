import { createHash } from "node:crypto";
import type { Strategy } from "../../contracts/src/strategy";
import {
  canonicalizeWorkflow,
  type MarketCandidate,
  type PlanExpr,
  type PlanStage,
  type Workflow,
} from "../../contracts/src/workflow";
import {
  createPaper,
  paperProblems,
  stepPaper,
  type PaperQuote,
  type PaperState,
} from "../workflows/paper";
import {
  createLedger,
  transition,
  type Allocation,
  type Amount,
  type Execution,
  type FinalReport,
  type JournalEvent,
  type Ledger,
  type Order,
} from "./ledger";

export type Network =
  | "hyperliquid-mainnet"
  | "solana-mainnet"
  | "robinhood-mainnet";
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type CompiledMarket = Pick<
  MarketCandidate,
  "id" | "symbol" | "address" | "venue" | "kind"
>;
export type WalletBudget = {
  network: Network;
  wallet: string;
  /** The stable settlement asset in which budgetUsd is denominated. The driver verifies its exact mint/chain/precision. */
  settlementAsset: string;
  decimals: number;
  allocations: Amount[];
  maxFeesPerOrder: Amount[];
};
export type StartLive = {
  owner: string;
  id: string;
  strategyId: string;
  version: number;
  strategy: Strategy;
  mode: "confirm_each" | "auto";
  slippageBps: number;
  wallets: WalletBudget[];
};
export type Action = {
  programId: string;
  strategyId: string;
  version: number;
  owner: string;
  stage: string;
  sequence: number;
  id: string;
  network: Network;
  wallet: string;
  instrument: CompiledMarket;
  leg: "entry" | "exit";
  side: "buy" | "sell" | "long" | "short";
  leverage: number;
  slippageBps: number;
  spendAsset: string;
  spendUnits: string;
  reduceOnly: boolean;
  exitReason: string | null;
  entryAverageUsd?: number;
  priorHolding?: { quantity: string; averageEntryUsd: number };
  notionalUsd6?: string;
  review?: { condition: PlanExpr | null; observedAt: number; price: number };
};
export type Prepared = {
  /** JSON-safe, provider-pinned, unsigned order/transaction or reference to it; never secret material. */
  payload: Json;
  expiresAt: number;
  targetUnits: string;
  reserves: Amount[];
  summary: string;
};
export type Signed = {
  recoveryId: string;
  packet: Json;
  delivery?: "server" | "wallet";
};
/** Quantity attributable to THIS order's cumulatively verified fills, not the whole pre-existing wallet position. */
export type Holding = {
  asset: string;
  quantity: string;
  quantityDecimals?: number;
  averageEntryUsd: number;
  openedAt: number;
};
export type PerpetualEconomics = {
  averagePrice: string | null;
  executedNotional: string;
  realizedClosedPnl: string | null;
  fees: Record<string, string>;
  filledSize: string;
  requestedSize: string;
  status: string;
};
export type Evidence = {
  perpetual?: PerpetualEconomics;
  network: Network;
  wallet: string;
  recoveryId: string;
  ref?: string;
  fills: Execution[];
  final?: FinalReport;
  /** Established only from the reconciled account, executed movements and venue receipts, not quotes. */
  holding?: Holding;
};
export type AccountSample = {
  network: Network;
  wallet: string;
  settlementAsset: string;
  decimals: number;
  observedAt: number;
  free: Amount[];
  /** Verified current-day loss attributable to this wallet/program in millionths of USD, including open positions and fees. */
  lossUsd6: string | null;
  /** The strategy's marked net equity on this lane, including inventoried tokens, net of costs and excluding outside funds. */
  equityUsd6?: string;
  /** Actual RPC/issuer-verified precision of pre-funded mints. */
  assetDecimals?: Record<string, number>;
};
export type Driver = {
  /** Performs no signing or writes. An unsupported deployment, asset, side, leverage or protection returns a reason. */
  readiness(
    binding: WalletBudget,
    market: CompiledMarket,
    stage: PlanStage,
  ): Promise<string | null>;
  balance(
    binding: WalletBudget,
    p: LiveProgram,
    purpose?: "start" | "risk" | "reduce",
  ): Promise<AccountSample>;
  prepare(action: Action): Promise<Prepared>;
  /** Validate signature or active owner-authorized delegated policy against action+terms. Never broadcast here. */
  seal(
    action: Action,
    terms: Prepared,
    auth: { kind: "wallet"; value: Json } | { kind: "delegate" },
  ): Promise<Signed>;
  /** Public chain txid or exchange client order ID must be known before transmission. */
  broadcast(action: Action, terms: Prepared, authorized: Signed): Promise<void>;
  reconcile(
    action: Action,
    terms: Prepared,
    recoveryId: string,
    candidateHashes?: readonly string[],
  ): Promise<Evidence>;
  /** Unsupported cancellation (for example an already submitted Solana swap) returns "unavailable". An acknowledgement is not final. */
  cancel?(
    action: Action,
    terms: Prepared,
    recoveryId: string,
  ): Promise<"requested" | "unavailable">;
  /** True only for an unexpired venue grant that permits this specific wallet/action. Wallet-only providers return false. */
  delegated(action: Action): Promise<boolean>;
};
export type LiveOrder = {
  action: Action;
  terms: Prepared;
  digest: string;
  recoveryId?: string;
  holding?: Holding;
  perpetual?: PerpetualEconomics;
  holdingForFilledUnits?: string;
  cancelRequested?: boolean;
  cancelAttemptAt?: number;
  cancelState?: "requested" | "unavailable" | "awaiting";
  dispatchedAt?: number;
  delivery?: "server" | "wallet";
  candidateHashes?: string[];
};
type StageState = {
  entries: string[];
  exits: string[];
  peakPct: number;
  lastFilledAt?: number;
};
export type LiveProgram = {
  schema: 1;
  revision: number;
  controlEpoch?: number;
  id: string;
  owner: string;
  strategyId: string;
  version: number;
  strategy: Strategy;
  mode: StartLive["mode"];
  slippageBps: number;
  wallets: WalletBudget[];
  status: "running" | "paused" | "stopped" | "complete";
  createdAt: number;
  message: string;
  stages: Record<string, StageState>;
  orders: Record<string, LiveOrder>;
  ledger: Ledger;
  observations: PaperState;
};
export type LiveStore = {
  /** Detached copies. The durable CAS must be atomic across workers, BEFORE resolving true. */
  read(owner: string, id: string): Promise<LiveProgram | null>;
  /** prior=null creates once and ensures no concurrent active workflow can claim the same owner's wallets. */
  cas(
    owner: string,
    id: string,
    prior: number | null,
    next: LiveProgram,
  ): Promise<boolean>;
};
export type LiveDeps = {
  store: LiveStore;
  drivers: Partial<Record<Network, Driver>>;
  observe: (asset: Workflow["assets"][number]) => Promise<PaperQuote | null>;
  now: () => number;
};

const timeDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const amount = (v: string, positive = false) => {
  if (!/^(0|[1-9]\d{0,77})$/.test(v) || (positive && v === "0"))
    throw Error("Invalid base units");
  return BigInt(v);
};
const distinct = (a: Amount[]) => {
  if (
    !Array.isArray(a) ||
    a.length > 32 ||
    new Set(a.map((v) => v.asset)).size !== a.length
  )
    throw Error("Invalid asset vector");
  for (const v of a) {
    if (!/^[\w:.-]{1,150}$/.test(v.asset))
      throw Error("Invalid settlement asset");
    amount(v.units);
  }
  return a;
};
const qty = (a: readonly Amount[], id: string) =>
  BigInt(a.find((v) => v.asset === id)?.units ?? "0");
const settled = (o: Order) =>
  ["filled", "rejected", "revoked", "cancelled"].includes(o.status);
const digest = (v: unknown): string => {
  const canonical = (x: unknown): string => {
    if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
    if (x !== null && typeof x === "object")
      return (
        "{" +
        Object.keys(x)
          .sort()
          .map(
            (k) =>
              JSON.stringify(k) +
              ":" +
              canonical((x as Record<string, unknown>)[k]),
          )
          .join(",") +
        "}"
      );
    if (x === undefined || (typeof x === "number" && !Number.isFinite(x)))
      throw Error("Invalid execution payload");
    return JSON.stringify(x);
  };
  return createHash("sha256").update(canonical(v)).digest("hex");
};
const marketFor = (w: Workflow, s: PlanStage) => {
  const a = w.assets.find((a) => a.id === s.assetId);
  const c = a?.resolution?.candidates.find(
    (c) => c.id === a.resolution?.selectedId,
  );
  if (!c) throw Error("Select the exact execution market for " + s.id);
  return {
    id: c.id,
    symbol: c.symbol,
    address: c.address,
    venue: c.venue,
    kind: c.kind,
  } satisfies CompiledMarket;
};
const networkOf = (m: CompiledMarket): Network => {
  if (
    m.venue === "hyperliquid" &&
    m.kind === "perp" &&
    m.id === "hl:perp:" + m.symbol
  )
    return "hyperliquid-mainnet";
  if (
    m.venue === "solana" &&
    (m.kind === "token" || m.kind === "spot") &&
    m.address &&
    m.id === "sol:token:" + m.address
  )
    return "solana-mainnet";
  if (m.venue === "robinhood" && m.kind === "token") return "robinhood-mainnet";
  throw Error("This market is supported for observations only: " + m.id);
};
const toUnits = (
  v: number,
  decimals: number,
  round: "exact" | "up" | "down" = "exact",
) => {
  if (
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    !Number.isFinite(v) ||
    v <= 0
  )
    throw Error("Invalid currency precision or amount");
  const p = String(v).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!p) throw Error("Invalid number");
  const digits = BigInt(p[1] + (p[2] ?? "")),
    power = decimals + Number(p[3] ?? 0) - (p[2]?.length ?? 0);
  if (Math.abs(power) > 100) throw Error("Unsupported currency magnitude");
  if (power >= 0) return digits * 10n ** BigInt(power);
  const div = 10n ** BigInt(-power),
    rem = digits % div;
  if (rem && round === "exact")
    throw Error("Amount is smaller than the settlement precision");
  return digits / div + (rem && round === "up" ? 1n : 0n);
};
const roundedUp = (n: bigint, d: bigint) => (n + d - 1n) / d;
const valuedUsd6 = (units: bigint, decimals: number, price: number) =>
  roundedUp(units * toUnits(price, 18, "up"), 10n ** BigInt(decimals + 12));
const refs = (p: LiveProgram, id: string) =>
  p.ledger.orders.find((o) => o.spec.id === id)!;
function add(p: LiveProgram, e: JournalEvent) {
  p.ledger = transition(p.ledger, e).next;
}
function trustedSample(
  s: AccountSample,
  b: WalletBudget,
  at: number,
  requireRisk = true,
) {
  if (
    s.network !== b.network ||
    s.wallet !== b.wallet ||
    s.settlementAsset !== b.settlementAsset ||
    s.decimals !== b.decimals ||
    !Number.isSafeInteger(s.observedAt) ||
    s.observedAt > at + 1000 ||
    at - s.observedAt > 20000
  )
    throw Error("Fresh balance for the bound wallet and network required");
  distinct(s.free);
  if (s.lossUsd6 !== null) amount(s.lossUsd6);
  else if (requireRisk)
    throw Error("Verified current-day risk valuation is unavailable");
  if (s.equityUsd6 !== undefined) amount(s.equityUsd6);
  if (
    s.assetDecimals &&
    Object.values(s.assetDecimals).some(
      (x) => !Number.isInteger(x) || x < 0 || x > 18,
    )
  )
    throw Error("Invalid settlement asset precision");
  return s;
}
function sanity(o: LiveOrder) {
  if (digest({ action: o.action, terms: o.terms }) !== o.digest)
    throw Error("Stored execution terms failed integrity verification");
}
const binding = (p: LiveProgram, network: Network) => {
  const b = p.wallets.find((v) => v.network === network);
  if (!b) throw Error("Missing venue allocation");
  return b;
};
const localId = (
  p: LiveProgram,
  id: string,
  leg: "entry" | "exit",
  seq: number,
) =>
  "intent_" +
  digest([p.owner, p.id, p.strategyId, p.version, id, leg, seq]).slice(0, 48);

type Readings = Record<string, number | boolean | null>;
type Truth = boolean | null;
function truth(e: PlanExpr, v: Readings, old: Readings): Truth {
  if ("args" in e) {
    const results = e.args.map((x) => truth(x, v, old));
    return e.op === "and"
      ? results.includes(false)
        ? false
        : results.includes(null)
          ? null
          : true
      : results.includes(true)
        ? true
        : results.includes(null)
          ? null
          : false;
  }
  if ("arg" in e) {
    const t = truth(e.arg, v, old);
    return t === null ? null : !t;
  }
  const value = (
    o: typeof e.left,
    m: Readings,
  ): number | string | boolean | null =>
    "lit" in o ? o.lit : (m[o.ref] ?? null);
  const l = value(e.left, v),
    r = value(e.right, v);
  if (l === null || r === null) return null;
  if (e.op === "eq") return l === r;
  if (e.op === "neq") return l !== r;
  if (typeof l !== "number" || typeof r !== "number") return null;
  if (e.op === "lt") return l < r;
  if (e.op === "lte") return l <= r;
  if (e.op === "gt") return l > r;
  if (e.op === "gte") return l >= r;
  const pl = value(e.left, old),
    pr = value(e.right, old);
  if (typeof pl !== "number" || typeof pr !== "number") return false;
  return e.op === "crosses_above" ? pl <= pr && l > r : pl >= pr && l < r;
}
/** Keep only the branches that established the trigger. A crossing stays actionable only while on the triggered side of its boundary. */
function witness(
  e: PlanExpr,
  want: boolean,
  v: Readings,
  old: Readings,
): PlanExpr {
  if (truth(e, v, old) !== want)
    throw Error("The signal that qualified the order is no longer current");
  if ("arg" in e) return witness(e.arg, !want, v, old);
  if ("args" in e) {
    const all = (e.op === "and" && want) || (e.op === "or" && !want);
    const children = (
      all ? e.args : e.args.filter((x) => truth(x, v, old) === want)
    ).map((x) => witness(x, want, v, old));
    if (!children.length)
      throw Error("The strategy condition is no longer established");
    return children.length === 1
      ? children[0]
      : { op: all ? "and" : "or", args: children };
  }
  if (want && e.op === "crosses_above") return { ...e, op: "gt" };
  if (want && e.op === "crosses_below") return { ...e, op: "lt" };
  return want ? e : { op: "not", arg: e };
}
const manual = (a: Action) =>
  a.leg === "exit" && a.reduceOnly && a.exitReason === "Manual close";
const canConfirm = (p: LiveProgram, o: LiveOrder) =>
  p.status === "running" || manual(o.action);

export function validateLiveRequest(input: StartLive) {
  const w = input.strategy.workflow;
  if (!w) throw Error("Select a saved reviewed workflow");
  if (
    !input.owner ||
    !input.strategyId ||
    !/^[A-Za-z0-9][\w:.-]{0,79}$/.test(input.id) ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1
  )
    throw Error("Invalid owned workflow revision");
  if (
    !["auto", "confirm_each"].includes(input.mode) ||
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 1 ||
    input.slippageBps > 500
  )
    throw Error("Review the live mode and slippage limit");
  const problems = paperProblems(w, true);
  if (problems.length) throw Error(problems.join(" "));
  if (
    w.signals.some(
      (s) => s.kind === "position" || s.drawdown?.reference === "last_fill",
    )
  )
    throw Error(
      "This signal requires a stage-specific wallet position or confirmed fill anchor",
    );
  const seen = new Set<string>();
  if (!input.wallets.length || input.wallets.length > 3)
    throw Error("Select each required venue wallet");
  for (const b of input.wallets) {
    if (
      seen.has(b.network) ||
      !b.wallet ||
      !Number.isInteger(b.decimals) ||
      b.decimals < 0 ||
      b.decimals > 18
    )
      throw Error("Invalid or repeated venue binding");
    seen.add(b.network);
    distinct(b.allocations);
    distinct(b.maxFeesPerOrder);
    if (
      !b.allocations.length ||
      b.allocations.some((a) => amount(a.units) === 0n)
    )
      throw Error("Select a positive allocation for each venue");
  }
  const budget18 = toUnits(w.budgetUsd!, 18);
  const allocated18 = input.wallets.reduce(
    (sum, b) =>
      sum +
      qty(b.allocations, b.settlementAsset) * 10n ** BigInt(18 - b.decimals),
    0n,
  );
  if (allocated18 > budget18)
    throw Error("Total venue allocations exceed the reviewed strategy budget");
  const used = new Set<Network>(),
    markets = new Set<string>();
  for (const s of w.stages) {
    const m = marketFor(w, s),
      n = networkOf(m);
    used.add(n);
    if (markets.has(m.id))
      throw Error(
        "One live entry rule per distinct execution market is required for position attribution",
      );
    markets.add(m.id);
    if (!seen.has(n)) throw Error("Allocate capital on " + n);
    const sale = s.side === "sell" && n !== "hyperliquid-mainnet";
    if (
      s.amount.value === null ||
      s.funding.kind !== "budget" ||
      (sale
        ? s.amount.unit !== "native" || s.leverage !== 1
        : !["usd", "pct_equity"].includes(s.amount.unit) ||
          (n === "hyperliquid-mainnet"
            ? !["long", "short"].includes(s.side)
            : s.side !== "buy" || s.leverage !== 1))
    )
      throw Error(
        "Choose a fixed USD or percentage-of-equity entry, or a funded spot sale with an exact native-unit size, for " +
          s.id,
      );
    if (
      sale &&
      (!m.address ||
        qty(
          binding({ wallets: input.wallets } as LiveProgram, n).allocations,
          m.address,
        ) <= 0n)
    )
      throw Error(
        "Allocate this exact mint on its execution network before an inventory sale",
      );
    if (
      sale &&
      (s.exits.stopLossPct ||
        s.exits.takeProfitPct ||
        s.exits.trailingStopPct ||
        s.exits.timeExitHours ||
        s.exits.ladder.length ||
        w.stages.some((x) =>
          x.after.some((d) => d.stageId === s.id && d.event === "closed"),
        ))
    )
      throw Error(
        "An inventory sale can release a full-fill dependency. It does not create a new position to close.",
      );
    if (!Number.isInteger(s.leverage) || s.leverage < 1)
      throw Error("Invalid leverage");
    if (
      s.repeat &&
      (!s.repeat.intervalMinutes ||
        s.after.length ||
        s.repeat.conditionMode === "needs_choice")
    )
      throw Error(
        "Live repeats require an explicit interval and an independent entry",
      );
    if (
      s.exits.ladder.length ||
      s.exits.description ||
      (s.repeat &&
        (s.exits.stopLossPct ||
          s.exits.takeProfitPct ||
          s.exits.timeExitHours ||
          s.exits.trailingStopPct))
    )
      throw Error("This staged exit needs a verified lot allocation adapter");
    if (s.after.some((d) => d.event !== "filled" && d.event !== "closed"))
      throw Error(
        "Profit-funded or resolution-dependent execution requires realized settlement evidence",
      );
    if (s.after.some((d) => w.stages.find((x) => x.id === d.stageId)?.repeat))
      throw Error(
        "Choose an unambiguous one-off predecessor for a dependent order",
      );
    if (s.amount.unit === "usd")
      toUnits(
        s.amount.value,
        binding({ wallets: input.wallets } as LiveProgram, n).decimals,
      );
    if (s.amount.unit === "pct_equity") toUnits(s.amount.value, 6);
  }
  if (used.size !== input.wallets.length)
    throw Error("Only allocate wallets that execute this workflow");
  for (const b of input.wallets) {
    const funded = new Set([
      b.settlementAsset,
      ...b.maxFeesPerOrder.map((a) => a.asset),
    ]);
    for (const s of w.stages.filter((s) => s.side === "sell")) {
      const m = marketFor(w, s);
      if (networkOf(m) === b.network && m.address) funded.add(m.address);
    }
    if (b.allocations.some((a) => !funded.has(a.asset)))
      throw Error(
        "Allocation includes an asset outside the reviewed wallet actions",
      );
  }
  return canonicalizeWorkflow(w);
}

export class LiveCoordinator {
  constructor(private readonly d: LiveDeps) {}
  private driver(n: Network) {
    const v = this.d.drivers[n];
    if (!v) throw Error("Execution unavailable on " + n);
    return v;
  }
  private async read(owner: string, id: string) {
    const p = await this.d.store.read(owner, id);
    if (!p || p.owner !== owner || p.id !== id)
      throw Error("Live workflow not found");
    return p;
  }
  private async save(p: LiveProgram) {
    const prior = p.revision;
    p.revision++;
    if (!(await this.d.store.cas(p.owner, p.id, prior, p)))
      throw Error("This workflow changed; refresh and retry");
  }
  async start(input: StartLive) {
    const w = validateLiveRequest(input),
      at = this.d.now(),
      strategy = structuredClone(input.strategy);
    strategy.workflow = w;
    const wallets = structuredClone(input.wallets),
      allocations: Allocation[] = wallets.flatMap((b) =>
        b.allocations.map((a) => ({ ...a, venue: b.network })),
      );
    const p: LiveProgram = {
      schema: 1,
      id: input.id,
      owner: input.owner,
      strategyId: input.strategyId,
      version: input.version,
      strategy,
      mode: input.mode,
      slippageBps: input.slippageBps,
      wallets,
      status: "running",
      message: "Waiting for observed market conditions.",
      createdAt: at,
      revision: 0,
      orders: {},
      stages: Object.fromEntries(
        w.stages.map((s) => [s.id, { entries: [], exits: [], peakPct: 0 }]),
      ),
      ledger: createLedger(input.id, allocations),
      observations: createPaper(w, at),
      controlEpoch: 0,
    };
    const prior = await this.d.store.read(p.owner, p.id);
    if (prior) {
      const signature = (v: LiveProgram) =>
        digest([
          v.owner,
          v.strategyId,
          v.version,
          v.mode,
          v.slippageBps,
          v.wallets,
          v.strategy,
        ]);
      if (prior.owner !== p.owner || signature(prior) !== signature(p))
        throw Error("Start request reused with different terms");
      return this.public(prior);
    }
    const reasons = await Promise.all(
      w.stages.map(async (s) => {
        const m = marketFor(w, s),
          net = networkOf(m);
        return this.driver(net).readiness(binding(p, net), m, s);
      }),
    );
    if (reasons.some(Boolean)) throw Error(reasons.filter(Boolean).join(" "));
    let initialUsd6 = 0n;
    for (const b of p.wallets) {
      const sellsOnly = w.stages
        .filter((s) => networkOf(marketFor(w, s)) === b.network)
        .every((s) => s.side === "sell");
      const sample = trustedSample(
        await this.driver(b.network).balance(
          b,
          p,
          sellsOnly ? "reduce" : "start",
        ),
        b,
        this.d.now(),
        !sellsOnly,
      );
      if (
        w.stages.some((s) => s.amount.unit === "pct_equity") &&
        sample.equityUsd6 === undefined
      )
        throw Error(
          "Percentage sizing requires verified equity on each connected execution wallet",
        );
      initialUsd6 += roundedUp(
        qty(b.allocations, b.settlementAsset) * 1000000n,
        10n ** BigInt(b.decimals),
      );
      for (const s of w.stages) {
        const m = marketFor(w, s);
        if (networkOf(m) !== b.network) continue;
        if (s.amount.unit === "pct_equity" && sample.equityUsd6 === undefined)
          throw Error(
            "Percentage sizing requires verified marked strategy equity.",
          );
        if (s.side !== "sell") continue;
        const precision = sample.assetDecimals?.[m.address!];
        if (precision === undefined)
          throw Error("Verify the allocated token's precision before selling");
        const units = qty(b.allocations, m.address!);
        if (units < toUnits(s.amount.value!, precision))
          throw Error(
            "The native sale exceeds the explicitly allocated inventory",
          );
        const q = await this.exitQuote(p, s);
        initialUsd6 += valuedUsd6(units, precision, q.price);
      }
      if (
        b.allocations.some((a) => qty(sample.free, a.asset) < amount(a.units))
      )
        throw Error("The allocated balance is unavailable on " + b.network);
    }
    if (initialUsd6 > toUnits(w.budgetUsd!, 6))
      throw Error(
        "Cash plus the marked pre-funded inventory exceeds the reviewed strategy budget",
      );
    if (!(await this.d.store.cas(p.owner, p.id, null, p)))
      throw Error("A live workflow already controls this wallet");
    return this.public(p);
  }
  async view(owner: string, id: string) {
    return this.public(await this.read(owner, id));
  }
  private public(p: LiveProgram) {
    const w = p.strategy.workflow!;
    return {
      id: p.id,
      strategyId: p.strategyId,
      version: p.version,
      revision: p.revision,
      status: p.status,
      message: p.message,
      mode: p.mode,
      createdAt: p.createdAt,
      allocations: p.ledger.accounts,
      issues: p.ledger.issues,
      stages: w.stages.map((s) => {
        const st = p.stages[s.id];
        let holding: null | {
          asset: string;
          quantity: string;
          averageEntryUsd: number;
        } = null;
        try {
          const h = this.remaining(p, s);
          if (h.units > 0n)
            holding = {
              asset: h.asset,
              quantity: h.units.toString(),
              averageEntryUsd: h.averageEntryUsd,
            };
        } catch {
          /* Incomplete or contradictory evidence is never presented as a closeable holding. */
        }
        const canClose =
          !!holding &&
          !p.ledger.issues.length &&
          ![...st.entries, ...st.exits].some((id) => {
            const l = refs(p, id);
            return l.dispatched && !settled(l);
          });
        return {
          id: s.id,
          assetId: s.assetId,
          side: s.side,
          after: s.after,
          entryOrders: st.entries,
          exitOrders: st.exits,
          holding,
          canClose,
        };
      }),
      orders: Object.values(p.orders).map((o) => {
        const l = refs(p, o.action.id);
        return {
          id: o.action.id,
          stage: o.action.stage,
          leg: o.action.leg,
          sequence: o.action.sequence,
          network: o.action.network,
          wallet: o.action.wallet,
          market: o.action.instrument,
          side: o.action.side,
          leverage: o.action.leverage,
          spendAsset: o.action.spendAsset,
          spendUnits: o.action.spendUnits,
          slippageBps: o.action.slippageBps,
          notionalUsd6: o.action.notionalUsd6 ?? null,
          perpetual: o.perpetual ?? null,
          digest: o.digest,
          summary: o.terms.summary,
          expiresAt: o.terms.expiresAt,
          targetUnits: o.terms.targetUnits,
          reserves: o.terms.reserves,
          quote:
            o.action.network === "robinhood-mainnet" &&
            o.terms.payload &&
            typeof o.terms.payload === "object" &&
            !Array.isArray(o.terms.payload)
              ? Object.fromEntries(
                  [
                    "chainId",
                    "symbol",
                    "side",
                    "inputToken",
                    "outputToken",
                    "inputUnits",
                    "minimumOutputUnits",
                    "expectedOutputUnits",
                    "maxFeeWei",
                    "expiresAt",
                    "slippageBps",
                  ].map((k) => [
                    k,
                    (o.terms.payload as Record<string, unknown>)[k],
                  ]),
                )
              : null,
          /* Unsigned review payload only. Drivers must use public DTOs and never embed signing material in prepare(). */
          unsigned:
            l.status === "planned" &&
            canConfirm(p, o) &&
            o.action.network !== "robinhood-mainnet"
              ? o.terms.payload
              : null,
          delivery: o.delivery ?? null,
          cancellation: o.cancelState ?? null,
          status: l.status,
          filledUnits: l.filledQty,
          orderRef: l.orderRef,
          recoveryId: o.recoveryId ?? null,
        };
      }),
    };
  }
  async control(
    owner: string,
    id: string,
    command: "pause" | "resume" | "stop",
  ) {
    const p = await this.read(owner, id);
    if (
      !["pause", "resume", "stop"].includes(command) ||
      p.status === "complete" ||
      p.status === "stopped"
    )
      throw Error("This workflow is terminal");
    p.controlEpoch = (p.controlEpoch ?? 0) + 1;
    p.status =
      command === "pause"
        ? "paused"
        : command === "resume"
          ? "running"
          : "stopped";
    if (command !== "resume") {
      for (const o of Object.values(p.orders))
        if (!refs(p, o.action.id).dispatched)
          add(p, { kind: "revoke", id: o.action.id });
      p.message =
        command === "pause"
          ? "New orders paused. Reconciling submitted orders."
          : "Stopped. Submitted orders remain under reconciliation.";
    } else p.message = "Resumed. Waiting for a fresh observation.";
    await this.save(p);
    return this.public(p);
  }
  private async reconcile(p: LiveProgram, order: LiveOrder) {
    const a = order.action,
      prior = refs(p, a.id);
    if (!prior.dispatched || settled(prior) || !order.recoveryId) return;
    sanity(order);
    const e = await this.driver(a.network).reconcile(
      a,
      order.terms,
      order.recoveryId,
      order.candidateHashes ?? [],
    );
    if (
      e.wallet !== a.wallet ||
      e.network !== a.network ||
      e.recoveryId !== order.recoveryId
    )
      throw Error("Receipt belongs to another execution");
    // Validate and apply an entire evidence bundle atomically. A bad holding cannot release a dependent leg.
    let next = p.ledger;
    const apply = (e: JournalEvent) => {
      next = transition(next, e).next;
    };
    if (e.ref) apply({ kind: "accepted", id: a.id, orderRef: e.ref });
    const before = prior.filledQty;
    for (const f of e.fills) apply({ kind: "execution", id: a.id, fill: f });
    if (e.final) apply({ kind: "final", id: a.id, report: e.final });
    const state = next.orders.find((o) => o.spec.id === a.id)!,
      gotFill = BigInt(state.filledQty) > 0n;
    if (e.perpetual) {
      const x = e.perpetual,
        decimal = (v: string) =>
          typeof v === "string" &&
          /^-?(?:0|[1-9]\d{0,39})(?:\.\d{1,30})?$/.test(v);
      if (
        a.network !== "hyperliquid-mainnet" ||
        !decimal(x.executedNotional) ||
        !decimal(x.filledSize) ||
        !decimal(x.requestedSize) ||
        (x.averagePrice !== null && !decimal(x.averagePrice)) ||
        (x.realizedClosedPnl !== null && !decimal(x.realizedClosedPnl)) ||
        Object.keys(x.fees).length > 16 ||
        Object.entries(x.fees).some(
          ([asset, v]) => !/^[-A-Za-z0-9.:_]{1,70}$/.test(asset) || !decimal(v),
        ) ||
        typeof x.status !== "string" ||
        x.status.length > 100
      )
        throw Error("Invalid verified perpetual economics");
    }
    if (gotFill && e.holding && a.leg === "entry" && a.side !== "sell") {
      const h = e.holding;
      if (
        !/^[\w:.-]{1,150}$/.test(h.asset) ||
        amount(h.quantity, true) <= 0n ||
        !Number.isFinite(h.averageEntryUsd) ||
        h.averageEntryUsd <= 0 ||
        !Number.isSafeInteger(h.openedAt) ||
        h.openedAt < p.createdAt - 5000 ||
        h.openedAt > this.d.now() + 1000
      )
        throw Error("Invalid settled position proof");
      if (a.network === "solana-mainnet" && h.asset !== a.instrument.address)
        throw Error("Settled token differs from the approved mint");
      if (a.network === "hyperliquid-mainnet" && h.asset !== a.instrument.id)
        throw Error("Settled perpetual differs from the approved instrument");
      if (
        h.quantityDecimals !== undefined &&
        (!Number.isInteger(h.quantityDecimals) ||
          h.quantityDecimals < 0 ||
          h.quantityDecimals > 18)
      )
        throw Error("Invalid position unit precision");
      if (qty(state.credits, h.asset) !== amount(h.quantity, true))
        throw Error(
          "The reported holding does not match confirmed credited movements",
        );
      if (
        before === state.filledQty &&
        order.holding &&
        digest(order.holding) !== digest(h)
      )
        throw Error("Conflicting holding for the same filled quantity");
      order.holding = structuredClone(h);
      order.holdingForFilledUnits = state.filledQty;
    }
    if (
      settled(state) &&
      gotFill &&
      a.leg === "entry" &&
      a.side !== "sell" &&
      (!order.holding || order.holdingForFilledUnits !== state.filledQty)
    )
      throw Error(
        "The venue has not established the position quantity for these fills",
      );
    p.ledger = next;
    if (e.perpetual) order.perpetual = structuredClone(e.perpetual);
    if (state.status === "filled" && a.leg === "entry")
      p.stages[a.stage].lastFilledAt = this.d.now();
    if (p.ledger.issues.length) {
      if (p.status === "running") p.status = "paused";
      p.message =
        "Venue evidence conflicts with the approved order. Review its receipts.";
    } else if (
      (state.status === "cancelled" && gotFill) ||
      state.status === "rejected"
    ) {
      if (p.status === "running") p.status = "paused";
      p.message = gotFill
        ? "Partial terminal fill. Remaining stages require review."
        : "The venue rejected an entry. Review the order before resuming.";
    } else if (state.status === "cancelled" && p.status === "running") {
      p.status = "paused";
      p.message = "Order cancelled. Review the workflow before continuing.";
    }
    if (state.status === "filled" || before !== state.filledQty)
      p.message =
        state.status === "filled"
          ? "Verified full venue receipt."
          : "Partial venue fill. Dependents are waiting.";
  }
  private async sample(
    p: LiveProgram,
    review?: { stage: string; when: PlanExpr | null },
  ) {
    const w = p.strategy.workflow!,
      rows = await Promise.all(
        w.assets.map(async (asset) => {
          try {
            return await this.d.observe(asset);
          } catch {
            return null;
          }
        }),
      );
    const at = this.d.now(),
      quotes: PaperQuote[] = [],
      missing = new Set<string>();
    for (const [index, q] of rows.entries()) {
      const id = w.assets[index].id,
        previous = p.observations.quotes[id];
      if (
        !q ||
        q.assetId !== id ||
        q.synthetic ||
        !Number.isFinite(q.price) ||
        q.price <= 0 ||
        !Number.isSafeInteger(q.observedAt) ||
        q.observedAt > at + 1000 ||
        at - q.observedAt > 20000 ||
        (previous && q.observedAt < previous.observedAt)
      )
        missing.add(id);
      else quotes.push(q);
    }
    const signalPlan = {
      ...w,
      stages: w.stages.map((s) => ({
        ...s,
        // Reuse only signal and trading-hour checks. Live balances/order sizes and inventories are checked separately.
        side: s.side === "sell" ? ("buy" as const) : s.side,
        amount: { unit: "usd" as const, value: w.budgetUsd! * 0.000001 },
        when: s.id === review?.stage ? review.when : s.when,
        repeat: s.id === review?.stage ? null : s.repeat,
        after: [],
      })),
    };
    const previous = p.observations.previous;
    const eligible = new Set<string>();
    const atStep = review ? Math.max(at, p.observations.lastAt + 1) : at;
    if (atStep > at + 1000) throw Error("Observation clock moved backward");
    const checkpoint = stepPaper(
      signalPlan,
      p.observations,
      quotes,
      atStep,
      p.strategy.risk,
      [],
      [],
      (x) => {
        eligible.add(x.stageId);
        return false;
      },
      missing,
    );
    if (!review) p.observations = checkpoint;
    return {
      eligible,
      quotes,
      at,
      previous,
      readings: checkpoint.readings ?? {},
    };
  }
  private last(p: LiveProgram, ids: string[]) {
    const id = ids.at(-1);
    return id ? p.orders[id] : undefined;
  }
  private remaining(p: LiveProgram, s: PlanStage) {
    let acquired = 0n,
      outstanding = 0n,
      asset = "",
      averageEntryUsd = 0;
    // Ledger order follows intent creation; a stage cannot submit another financial effect before the prior receipt settles.
    for (const l of p.ledger.orders) {
      const o = p.orders[l.spec.id];
      if (o.action.stage !== s.id || BigInt(l.filledQty) === 0n) continue;
      if (o.action.leg === "exit") {
        outstanding -= BigInt(l.filledQty);
        if (outstanding < 0n)
          throw Error("Exit quantity exceeds the verified position");
        continue;
      }
      if (o.action.side === "sell") continue;
      const h = o.holding;
      if (
        !h ||
        o.holdingForFilledUnits !== l.filledQty ||
        (asset && h.asset !== asset)
      )
        throw Error("Awaiting verified lot identity and quantity");
      const units = amount(h.quantity, true),
        sum = outstanding + units;
      averageEntryUsd =
        outstanding === 0n
          ? h.averageEntryUsd
          : averageEntryUsd +
            (h.averageEntryUsd - averageEntryUsd) *
              (Number(units) / Number(sum));
      outstanding = sum;
      acquired += units;
      asset = h.asset;
    }
    return { asset, acquired, units: outstanding, averageEntryUsd };
  }
  private complete(p: LiveProgram, s: PlanStage, leg: "entry" | "exit") {
    const st = p.stages[s.id];
    if (leg === "entry")
      return st.entries.some((id) => refs(p, id).status === "filled");
    if (
      !st.exits.some((id) => refs(p, id).status === "filled") ||
      !st.entries.some((id) => refs(p, id).status === "filled")
    )
      return false;
    const h = this.remaining(p, s);
    return h.acquired > 0n && h.units === 0n;
  }
  private entryReady(p: LiveProgram, s: PlanStage, at: number) {
    const state = p.stages[s.id],
      last = this.last(p, state.entries);
    // Expired unsigned quotes and paused unsigned orders are replaceable. Any dispatched attempt requires a terminal full receipt before a repeat.
    if (last) {
      const l = refs(p, last.action.id);
      if (
        (l.dispatched && l.status !== "filled") ||
        (!l.dispatched && l.status !== "revoked")
      )
        return false;
    }
    const n = state.entries.filter(
      (i) => refs(p, i).status === "filled",
    ).length;
    if (
      n &&
      (!s.repeat ||
        (s.repeat.maxTimes && n >= s.repeat.maxTimes) ||
        state.lastFilledAt === undefined ||
        at - state.lastFilledAt < (s.repeat.intervalMinutes ?? 0) * 60000)
    )
      return false;
    return s.after.every((dep) => {
      const source = p.strategy.workflow!.stages.find(
        (st) => st.id === dep.stageId,
      )!;
      return this.complete(
        p,
        source,
        dep.event === "filled" ? "entry" : "exit",
      );
    });
  }
  private exitReady(
    p: LiveProgram,
    s: PlanStage,
    quote: PaperQuote,
    at: number,
    existing?: string,
  ) {
    const st = p.stages[s.id],
      last = this.last(p, st.entries),
      closing = this.last(p, st.exits);
    if (
      !last ||
      refs(p, last.action.id).status !== "filled" ||
      !last.holding ||
      (closing &&
        closing.action.id !== existing &&
        refs(p, closing.action.id).status !== "revoked")
    )
      return null;
    const h = last.holding,
      x = s.exits,
      move =
        (quote.price / h.averageEntryUsd - 1) *
        (s.side === "short" ? -100 : 100);
    st.peakPct = Math.max(st.peakPct, move);
    const reason =
      x.stopLossPct && move <= -x.stopLossPct
        ? "Stop loss"
        : x.takeProfitPct && move >= x.takeProfitPct
          ? "Take profit"
          : x.trailingStopPct && st.peakPct - move >= x.trailingStopPct
            ? "Trailing stop"
            : x.timeExitHours && at - h.openedAt >= x.timeExitHours * 3600000
              ? "Time exit"
              : null;
    return reason ? { h, reason } : null;
  }
  private async balances(p: LiveProgram, b: WalletBudget, reduce: boolean) {
    return Promise.all(
      (reduce ? [b] : p.wallets).map(async (v) =>
        trustedSample(
          await this.driver(v.network).balance(
            v,
            p,
            reduce ? "reduce" : "risk",
          ),
          v,
          this.d.now(),
          !reduce,
        ),
      ),
    );
  }
  private async risk(
    p: LiveProgram,
    a: Action,
    stage: PlanStage,
    quotes: PaperQuote[],
    excluding?: string,
    prechecked?: AccountSample[],
  ) {
    const w = p.strategy.workflow!,
      risk = { ...p.strategy.risk, ...w.risk },
      b = binding(p, a.network),
      at = this.d.now();
    const samples = prechecked ?? (await this.balances(p, b, a.reduceOnly));
    const own = samples.find((s) => s.network === a.network)!;
    if (a.leg === "entry") {
      const count = Object.values(p.orders).filter(
        (o) =>
          o.dispatchedAt !== undefined &&
          timeDay(o.dispatchedAt) === timeDay(at),
      ).length;
      if (count >= risk.maxOrdersPerDay)
        throw Error("Daily strategy order limit reached");
    }
    if (a.leg === "entry" && !a.reduceOnly) {
      const daily = samples.reduce((sum, s) => sum + amount(s.lossUsd6!), 0n);
      const lossPct = (Number(daily) / 1e6 / w.budgetUsd!) * 100;
      if (lossPct >= risk.maxDailyLossPct)
        throw Error("Daily strategy risk limit reached");
      let gross = 0,
        assetGross = 0;
      for (const o of Object.values(p.orders)) {
        const l = refs(p, o.action.id);
        if (
          o.action.id === excluding ||
          o.action.leg !== "entry" ||
          o.action.side === "sell" ||
          (!l.dispatched && l.status === "revoked") ||
          l.status === "rejected" ||
          (l.status === "cancelled" && l.filledQty === "0")
        )
          continue;
        const st = w.stages.find((s) => s.id === o.action.stage)!;
        if (this.complete(p, st, "exit")) continue;
        let positionNotional = o.action.notionalUsd6
          ? Number(o.action.notionalUsd6) / 1e6
          : st.amount.value! * st.leverage;
        if (l.dispatched && o.holding) {
          const mark = quotes.find((q) => q.assetId === st.assetId)?.price;
          if (!mark)
            throw Error(
              "A fresh mark is required for existing workflow exposure",
            );
          const h = o.holding;
          const marked =
            h.quantityDecimals !== undefined
              ? (Number(h.quantity) / 10 ** h.quantityDecimals) * mark
              : (positionNotional * mark) / h.averageEntryUsd;
          positionNotional = Math.max(positionNotional, marked);
        }
        gross += positionNotional;
        if (st.assetId === stage.assetId) assetGross += positionNotional;
      }
      const requested =
        Number(
          a.notionalUsd6 ?? toUnits(stage.amount.value! * stage.leverage, 6),
        ) / 1e6;
      const equity = samples.every((v) => v.equityUsd6 !== undefined)
        ? samples.reduce((sum, v) => sum + amount(v.equityUsd6!), 0n)
        : null;
      const basis =
        equity === null
          ? w.budgetUsd!
          : Math.min(w.budgetUsd!, Number(equity) / 1e6);
      if (stage.amount.unit === "pct_equity") {
        if (equity === null)
          throw Error(
            "Percentage sizing requires verified equity on each execution wallet",
          );
        const cap = (equity * toUnits(stage.amount.value!, 6)) / 100000000n,
          principal = roundedUp(
            amount(a.spendUnits) * 1000000n,
            10n ** BigInt(b.decimals),
          );
        if (principal > cap)
          throw Error("Equity changed. Review a fresh order size.");
      }
      if (
        basis <= 0 ||
        ((gross + requested) / basis) * 100 > risk.maxTotalExposurePct + 1e-9 ||
        ((assetGross + requested) / basis) * 100 > risk.maxPositionPct + 1e-9
      )
        throw Error("The entry exceeds the strategy exposure limit");
    }
    return own;
  }
  private assertTerms(
    p: LiveProgram,
    a: Action,
    t: Prepared,
    sample: AccountSample,
  ) {
    const b = binding(p, a.network),
      at = this.d.now();
    distinct(t.reserves);
    if (
      !Number.isSafeInteger(t.expiresAt) ||
      t.expiresAt <= at ||
      t.expiresAt - at > 120000 ||
      !t.summary ||
      t.summary.length > 1200 ||
      !t.targetUnits ||
      amount(t.targetUnits, true) <= 0n ||
      JSON.stringify(t.payload).length > 150000
    )
      throw Error("Invalid or expired executable terms");
    const input = amount(a.spendUnits, true);
    if (
      (a.leg === "exit" || a.network !== "hyperliquid-mainnet") &&
      amount(t.targetUnits) !== input
    )
      throw Error("Exit size differs from the settled quantity");
    if (
      qty(t.reserves, a.spendAsset) < input &&
      !(a.leg === "exit" && a.network === "hyperliquid-mainnet")
    )
      throw Error("The quote omits the authorized principal");
    for (const item of t.reserves) {
      const cap =
        (item.asset === a.spendAsset ? input : 0n) +
        qty(b.maxFeesPerOrder, item.asset);
      if (
        amount(item.units) > cap ||
        qty(sample.free, item.asset) < amount(item.units)
      )
        throw Error("Venue funds or signed fee cap exceeded");
      const allocated = p.ledger.accounts.find(
        (v) => v.venue === b.network && v.asset === item.asset,
      );
      if (!allocated || BigInt(allocated.free) < amount(item.units))
        throw Error(
          "Insufficient allocated " + item.asset + " on " + b.network,
        );
    }
    if (!t.reserves.length)
      throw Error("The live order has no verified reservation");
  }
  private async prepare(
    p: LiveProgram,
    s: PlanStage,
    closing: {
      h: Pick<Holding, "quantity" | "asset"> & { averageEntryUsd: number };
      reason: string;
    } | null,
    frame: { quotes: PaperQuote[]; previous: Readings; readings: Readings },
  ) {
    const w = p.strategy.workflow!,
      m = marketFor(w, s),
      network = networkOf(m),
      b = binding(p, network);
    const leg = closing ? "exit" : "entry",
      stage = p.stages[s.id],
      list = closing ? stage.exits : stage.entries,
      sequence = list.length + 1,
      id = localId(p, s.id, leg, sequence);
    if (Object.keys(p.orders).length >= 500)
      throw Error("Live order retention limit reached");
    const quote = frame.quotes.find((q) => q.assetId === s.assetId);
    if (!quote) throw Error("A fresh quote is required");
    const latched =
      !!s.repeat &&
      s.repeat.conditionMode === "once_then_repeat" &&
      this.complete(p, s, "entry");
    const guard =
      !closing && s.when && !latched
        ? witness(s.when, true, frame.readings, frame.previous)
        : null;
    const sale = !closing && s.side === "sell",
      reduce = !!closing || sale,
      samples = await this.balances(p, b, reduce),
      own = samples.find((v) => v.network === network)!;
    let spendAsset = b.settlementAsset,
      spend = 0n,
      notionalUsd6 = 0n;
    if (closing) {
      spendAsset = closing.h.asset;
      spend = amount(closing.h.quantity, true);
      const dec =
        own.assetDecimals?.[spendAsset] ??
        (network === "hyperliquid-mainnet" ? 18 : undefined);
      if (dec !== undefined) notionalUsd6 = valuedUsd6(spend, dec, quote.price);
    } else if (sale) {
      const precision = own.assetDecimals?.[m.address!];
      if (precision === undefined)
        throw Error("Current, verified mint precision required");
      spendAsset = m.address!;
      spend = toUnits(s.amount.value!, precision);
      notionalUsd6 = valuedUsd6(spend, precision, quote.price);
    } else if (s.amount.unit === "pct_equity") {
      if (samples.some((x) => x.equityUsd6 === undefined))
        throw Error(
          "Percentage sizing requires verified equity on every execution wallet",
        );
      const equity = samples.reduce(
        (sum, v) => sum + amount(v.equityUsd6!),
        0n,
      );
      const cap = (equity * toUnits(s.amount.value!, 6)) / 100000000n;
      spend = (cap * 10n ** BigInt(b.decimals)) / 1000000n;
      notionalUsd6 = roundedUp(
        spend * BigInt(s.leverage) * 1000000n,
        10n ** BigInt(b.decimals),
      );
    } else {
      spend = toUnits(s.amount.value!, b.decimals);
      notionalUsd6 = valuedUsd6(spend, b.decimals, s.leverage);
    }
    if (spend <= 0n)
      throw Error("The live order size is below the asset's minimum unit");
    const prior =
      network === "hyperliquid-mainnet" ? this.remaining(p, s) : null;
    const action: Action = {
      ...(prior && prior.units > 0n
        ? {
            priorHolding: {
              quantity: prior.units.toString(),
              averageEntryUsd: prior.averageEntryUsd,
            },
          }
        : {}),
      review: {
        condition: guard,
        price: quote.price,
        observedAt: quote.observedAt,
      },
      programId: p.id,
      strategyId: p.strategyId,
      version: p.version,
      owner: p.owner,
      id,
      stage: s.id,
      sequence,
      network,
      wallet: b.wallet,
      instrument: m,
      leg,
      side: closing
        ? m.kind === "perp"
          ? s.side === "short"
            ? "long"
            : "short"
          : "sell"
        : s.side,
      leverage: s.leverage,
      slippageBps: p.slippageBps,
      reduceOnly: reduce,
      spendAsset,
      spendUnits: spend.toString(),
      ...(notionalUsd6 > 0n ? { notionalUsd6: notionalUsd6.toString() } : {}),
      ...(closing ? { entryAverageUsd: closing.h.averageEntryUsd } : {}),
      exitReason: closing?.reason ?? null,
    };
    const sample = await this.risk(
        p,
        action,
        s,
        frame.quotes,
        undefined,
        samples,
      ),
      t = await this.driver(network).prepare(action);
    this.assertTerms(p, action, t, sample);
    const after = closing
      ? stage.entries.filter((id) => refs(p, id).status === "filled")
      : s.after.map(
          (d) =>
            this.last(
              p,
              d.event === "filled"
                ? p.stages[d.stageId].entries
                : p.stages[d.stageId].exits,
            )!.action.id,
        );
    const order = { action, terms: t, digest: digest({ action, terms: t }) };
    add(p, {
      kind: "plan",
      spec: {
        id,
        venue: network,
        instrument: m.id,
        side: action.side,
        targetQty: t.targetUnits,
        termsHash: order.digest,
        reserve: t.reserves,
        after,
      },
    });
    p.orders[id] = order;
    list.push(id);
    p.message = "Order ready for authorization.";
    return order;
  }
  async tick(owner: string, id: string) {
    const p = await this.read(owner, id);
    for (const o of Object.values(p.orders)) {
      const l = refs(p, o.action.id);
      if (!l.dispatched) {
        if (l.status === "planned" && o.terms.expiresAt <= this.d.now())
          add(p, { kind: "revoke", id: o.action.id });
      } else if (!settled(l)) {
        try {
          await this.reconcile(p, o);
        } catch {
          p.message = "Waiting for verified venue receipts.";
        }
      }
    }
    if (p.status !== "running" || p.ledger.issues.length) {
      await this.save(p);
      return this.public(p);
    }
    const w = p.strategy.workflow!,
      frame = await this.sample(p),
      { eligible, quotes, at } = frame;
    for (const s of w.stages) {
      const q = quotes.find((x) => x.assetId === s.assetId);
      if (!q) continue;
      const closing = this.exitReady(p, s, q, at);
      if (!closing && (!eligible.has(s.id) || !this.entryReady(p, s, at)))
        continue;
      try {
        await this.prepare(p, s, closing, frame);
      } catch (e) {
        p.message =
          e instanceof Error ? e.message : "Waiting for an executable quote.";
      }
    }
    const terminal = w.stages.every((s) => {
      const state = p.stages[s.id],
        num = state.entries.filter(
          (i) => refs(p, i).status === "filled",
        ).length;
      const needsExit = !!(
        s.exits.stopLossPct ||
        s.exits.takeProfitPct ||
        s.exits.trailingStopPct ||
        s.exits.timeExitHours
      );
      return (
        num > 0 &&
        (!s.repeat ||
          (s.repeat.maxTimes !== null && num >= s.repeat.maxTimes)) &&
        (!needsExit || this.complete(p, s, "exit"))
      );
    });
    if (terminal) {
      p.status = "complete";
      p.message = "All required venue receipts are confirmed.";
    }
    await this.save(p);
    if (p.mode === "auto" && p.status === "running") {
      const pending = Object.values(p.orders).find(
        (o) =>
          refs(p, o.action.id).status === "planned" &&
          o.terms.expiresAt > this.d.now(),
      );
      // A wallet-only leg remains actionable while independent delegated legs may proceed.
      for (const o of pending ? Object.values(p.orders) : []) {
        if (
          manual(o.action) ||
          (o.action.leg === "entry" && o.action.side === "sell") ||
          refs(p, o.action.id).status !== "planned" ||
          o.terms.expiresAt <= this.d.now()
        )
          continue;
        if (await this.driver(o.action.network).delegated(o.action))
          return this.confirm(owner, id, o.action.id, o.digest, {
            kind: "delegate",
          });
      }
    }
    return this.public(p);
  }
  async confirm(
    owner: string,
    id: string,
    orderId: string,
    reviewedDigest: string,
    auth: { kind: "wallet"; value: Json } | { kind: "delegate" },
  ) {
    const p = await this.read(owner, id),
      o = p.orders[orderId];
    if (!o || o.action.owner !== owner || o.digest !== reviewedDigest)
      throw Error("Reviewed terms do not match this order");
    sanity(o);
    const l = refs(p, orderId);
    if (l.dispatched) return this.public(p);
    if (
      !canConfirm(p, o) ||
      p.ledger.issues.length ||
      l.status !== "planned" ||
      o.terms.expiresAt <= this.d.now()
    )
      throw Error("The reviewed order is no longer actionable");
    const d = this.driver(o.action.network),
      s = p.strategy.workflow!.stages.find((v) => v.id === o.action.stage)!;
    const frame =
      o.action.leg === "entry"
        ? await this.sample(p, {
            stage: s.id,
            when: o.action.review ? o.action.review.condition : s.when,
          })
        : {
            eligible: new Set<string>(),
            quotes: [await this.exitQuote(p, s)],
            at: this.d.now(),
          };

    if (!frame.quotes.some((x) => x.assetId === s.assetId))
      throw Error("A fresh execution-market observation is required");
    if (o.action.leg === "entry" && !frame.eligible.has(s.id))
      throw Error("The trigger for this order is no longer satisfied");
    if (o.action.leg === "exit") {
      if (
        !manual(o.action) &&
        this.exitReady(p, s, frame.quotes[0], this.d.now(), orderId)?.reason !==
          o.action.exitReason
      )
        throw Error("The exit condition is no longer satisfied");
      const left = this.remaining(p, s);
      if (
        left.units !== amount(o.action.spendUnits) ||
        left.asset !== o.action.spendAsset
      )
        throw Error("The verified position changed before approval");
    }
    const sample = await this.risk(p, o.action, s, frame.quotes, orderId);
    this.assertTerms(p, o.action, o.terms, sample);
    if (auth.kind === "delegate" && !(await d.delegated(o.action)))
      throw Error("A current wallet signature is required for this order");
    const signed = await d.seal(o.action, o.terms, auth);
    if (
      signed?.delivery === "wallet" &&
      (auth.kind !== "wallet" ||
        o.action.network !== "robinhood-mainnet" ||
        !auth.value ||
        typeof auth.value !== "object" ||
        Array.isArray(auth.value) ||
        auth.value.authorizeWalletSubmission !== true)
    )
      throw Error("Explicit wallet submission authorization required");
    if (
      o.action.network === "robinhood-mainnet" &&
      signed?.delivery !== "wallet"
    )
      throw Error("The network requires an explicit wallet handoff");
    if (
      !signed ||
      typeof signed.recoveryId !== "string" ||
      !/^[A-Za-z0-9:._-]{1,160}$/.test(signed.recoveryId)
    )
      throw Error(
        "A durable recovery identifier is required before submission",
      );
    if (
      Object.values(p.orders).some(
        (x) =>
          x.action.id !== orderId &&
          x.action.network === o.action.network &&
          x.recoveryId === signed.recoveryId,
      )
    )
      throw Error("The transaction is already assigned to another order");
    const now = this.d.now();
    if (now - frame.at > 15000)
      throw Error("Market observation expired during authorization");
    if (now >= o.terms.expiresAt) throw Error("The reviewed order expired");
    add(p, {
      kind: "approve",
      id: orderId,
      approvalRef: reviewedDigest,
      expiresAt: o.terms.expiresAt,
      now,
    });
    const submission = transition(p.ledger, {
      kind: "submit",
      id: orderId,
      now,
    });
    if (!submission.send) throw Error("Order already submitted");
    p.ledger = submission.next;
    o.recoveryId = signed.recoveryId;
    o.dispatchedAt = now;
    o.delivery = signed.delivery ?? "server";
    p.message = "Committed order. Waiting for a venue receipt.";
    await this.save(p);
    // The attempt is now consumed. Any crash/lost reply must reconcile this very ID. An unsubmitted expired envelope needs conclusive expiry evidence.
    const permit = await this.read(owner, id),
      current = permit.orders[orderId];
    if (
      current &&
      (permit.controlEpoch ?? 0) === (p.controlEpoch ?? 0) &&
      canConfirm(permit, current) &&
      current.recoveryId === signed.recoveryId &&
      !current.cancelRequested &&
      refs(permit, orderId).status === "dispatching" &&
      this.d.now() < o.terms.expiresAt
    ) {
      if (signed.delivery === "wallet")
        return {
          ...this.public(permit),
          walletSubmission: {
            orderId,
            network: o.action.network,
            wallet: o.action.wallet,
            digest: o.digest,
            recoveryId: signed.recoveryId,
            expiresAt: o.terms.expiresAt,
            packet: signed.packet,
          },
        };
      try {
        await d.broadcast(o.action, o.terms, signed);
      } catch {
        /* Ambiguous network or overload; never auto-resubmit. */
      }
    }
    return this.view(owner, id);
  }
  private async exitQuote(p: LiveProgram, s: PlanStage) {
    const asset = p.strategy.workflow!.assets.find((a) => a.id === s.assetId)!;
    const q = await this.d.observe(asset),
      at = this.d.now();
    if (
      !q ||
      q.assetId !== asset.id ||
      q.synthetic ||
      !Number.isFinite(q.price) ||
      q.price <= 0 ||
      !Number.isSafeInteger(q.observedAt) ||
      at - q.observedAt > 20000 ||
      q.observedAt > at + 1000
    )
      throw Error("A fresh execution-market observation is required");
    return q;
  }
  async close(owner: string, id: string, stageId: string) {
    const p = await this.read(owner, id),
      s = p.strategy.workflow!.stages.find((s) => s.id === stageId);
    if (!s || p.ledger.issues.length)
      throw Error(
        "An identified stage without unresolved ledger issues is required",
      );
    const state = p.stages[s.id],
      existing = this.last(p, state.exits),
      at = this.d.now();
    if (
      existing &&
      manual(existing.action) &&
      refs(p, existing.action.id).status === "planned" &&
      existing.terms.expiresAt > at
    )
      return this.public(p);
    for (const oid of [...state.entries, ...state.exits]) {
      const l = refs(p, oid);
      if (l.dispatched && !settled(l))
        throw Error("Wait for the final receipt before sizing a close");
    }
    const left = this.remaining(p, s);
    if (!left.asset || left.units <= 0n)
      throw Error("No confirmed strategy-owned quantity remains to close");
    const quote = await this.exitQuote(p, s);
    for (const o of Object.values(p.orders)) {
      const l = refs(p, o.action.id);
      if (!l.dispatched && !settled(l))
        add(p, { kind: "revoke", id: o.action.id });
    }
    p.controlEpoch = (p.controlEpoch ?? 0) + 1;
    if (p.status === "running") p.status = "paused";
    await this.prepare(
      p,
      s,
      {
        h: {
          asset: left.asset,
          quantity: left.units.toString(),
          averageEntryUsd: left.averageEntryUsd,
        },
        reason: "Manual close",
      },
      { quotes: [quote], previous: {}, readings: {} },
    );
    p.message =
      "Review the reduce-only close for confirmed workflow-owned quantity.";
    await this.save(p);
    return this.public(p);
  }
  async walletReceipt(
    owner: string,
    id: string,
    orderId: string,
    reviewedDigest: string,
    hash: string,
  ) {
    const p = await this.read(owner, id),
      o = p.orders[orderId];
    if (
      !o ||
      o.delivery !== "wallet" ||
      !o.recoveryId ||
      o.digest !== reviewedDigest ||
      !/^0x[\da-fA-F]{64}$/.test(hash)
    )
      throw Error("Invalid wallet submission hint");
    const hints = (o.candidateHashes ??= []);
    if (!hints.includes(hash.toLowerCase()) && hints.length < 4) {
      hints.push(hash.toLowerCase());
      await this.save(p);
    }
    return this.public(p);
  }
  async cancel(owner: string, id: string, orderId: string) {
    const p = await this.read(owner, id),
      o = p.orders[orderId];
    if (!o) throw Error("Live order not found");
    sanity(o);
    const l = refs(p, orderId);
    if (
      settled(l) ||
      o.cancelState === "unavailable" ||
      (o.cancelAttemptAt !== undefined &&
        this.d.now() - o.cancelAttemptAt < 10000)
    )
      return this.public(p);
    p.controlEpoch = (p.controlEpoch ?? 0) + 1;
    p.status =
      p.status === "stopped"
        ? "stopped"
        : p.status === "complete"
          ? "complete"
          : "paused";
    o.cancelRequested = true;
    o.cancelAttemptAt = this.d.now();
    o.cancelState = "awaiting";
    add(p, { kind: "revoke", id: orderId });
    p.message =
      "Paused and cancellation requested. Final venue evidence controls settlement.";
    await this.save(p);
    if (l.dispatched && o.recoveryId) {
      let answer: "requested" | "unavailable" | "awaiting" = "awaiting";
      try {
        answer =
          (await this.driver(o.action.network).cancel?.(
            o.action,
            o.terms,
            o.recoveryId,
          )) ?? "unavailable";
      } catch {
        /* Retry only the same idempotent cancellation. */
      }
      const next = await this.read(owner, id);
      next.orders[orderId].cancelState = answer;
      if (answer === "unavailable")
        next.message =
          "The network cannot cancel this submitted transaction. Awaiting its final receipt.";
      await this.save(next);
    }
    return this.view(owner, id);
  }
}
