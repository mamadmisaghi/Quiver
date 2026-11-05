import { describeLiveStrategy, paperLivePlan } from "./live-review";
import { createHash } from "node:crypto";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { z } from "zod";
import type { MemStore, User } from "../store";
import type { Strategy } from "../../contracts/src/strategy";
import type { Workflow, MarketCandidate } from "../../contracts/src/workflow";
import { marketJson } from "../compile/markets";
import {
  robinhoodIssuerCandidate,
  ROBINHOOD_ISSUER_ASSETS,
} from "../compile/robinhood-assets";
import { quoteAsset } from "../workflows/quotes";
import { HostError } from "../workflows/host";
import { SecretVault } from "../secrets/vault";
import type { Config } from "../config";
import {
  LiveCoordinator,
  validateLiveRequest,
  type Network,
  type WalletBudget,
  type Driver,
  type LiveProgram,
  type Action,
  type AccountSample,
} from "./live-program";
import { LiveAuthority } from "./live-authority";
import { MainnetStore, liveTerminal } from "./live-storage";
import { HyperliquidVenue } from "./hyperliquid-testnet";
import { makeHyperliquidDriver } from "./hyperliquid-driver";
import { SolanaMainnet, NATIVE_FEES, USDC_MINT } from "./solana-mainnet";
import { WRAPPED_SOL } from "./solana-jupiter";
import { makeSolanaDriver } from "./solana-live-driver";
import { RobinhoodMainnet, RH_USDG } from "./robinhood-mainnet";
import { robinhoodLiveDriver } from "./robinhood-live-driver";
import { AllowanceQueue } from "./live-approvals";
import { markedProgramValue, lossSampler } from "./live-loss";
import { privySpotFeature } from "./privy-spot-routes";
import { read58 } from "./solana-wire";

export const Net = z.enum([
  "hyperliquid-mainnet",
  "solana-mainnet",
  "robinhood-mainnet",
]);
const uint = z.string().regex(/^(0|[1-9]\d{0,26})$/);
export const Funding = z
  .object({
    network: Net,
    wallet: z.string().max(80),
    usd: z.string().regex(/^(0|[1-9]\d{0,7})(\.\d{1,6})?$/),
    feePerOrder: uint,
    gasBudget: uint,
    inventory: z
      .array(z.object({ asset: z.string().max(112), units: uint }).strict())
      .max(16)
      .default([]),
  })
  .strict();
export type Funding = z.infer<typeof Funding>;
export type MainnetOptions = {
  store: MemStore;
  config: Config;
  vault: SecretVault;
  now: () => number;
  healthy: () => boolean;
  enabled: () => boolean;
  commit: () => Promise<void>;
  hl?: HyperliquidVenue;
  sol?: SolanaMainnet;
  rh?: RobinhoodMainnet;
};
type Asset = Workflow["assets"][number];
export { networkFor } from "./live-review";
const stable = (n: Network) =>
  n === "solana-mainnet"
    ? USDC_MINT
    : n === "robinhood-mainnet"
      ? RH_USDG
      : "USDC";
const feeAsset = (n: Network) =>
  n === "solana-mainnet"
    ? NATIVE_FEES
    : n === "robinhood-mainnet"
      ? "ETH"
      : "USDC";
const market = (a: Asset) =>
  a.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId);
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((v as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export function liveReviewDigest(id: string, version: number, s: Strategy) {
  return createHash("sha256")
    .update(
      canonical(["quiver-mainnet-review-v1", id, version, s.workflow, s.risk]),
    )
    .digest("hex");
}
function funding(v: Funding): WalletBudget {
  const settlement = stable(v.network),
    fee = feeAsset(v.network),
    size = parseUnits(v.usd, 6);
  if (v.network === "solana-mainnet") read58(v.wallet, 32);
  const wallet =
    v.network === "solana-mainnet" ? v.wallet : getAddress(v.wallet);
  if (
    BigInt(v.feePerOrder) <= 0n ||
    (v.network !== "hyperliquid-mainnet" &&
      BigInt(v.gasBudget) < BigInt(v.feePerOrder))
  )
    throw new HostError(
      422,
      "Allocate the network fee and set a per-order ceiling.",
    );
  const inventory = v.inventory.map((x) => ({
    ...x,
    asset: v.network === "robinhood-mainnet" ? x.asset.toLowerCase() : x.asset,
  }));
  if (
    inventory.some(
      (x) =>
        x.asset === settlement ||
        x.asset === fee ||
        v.network === "hyperliquid-mainnet" ||
        BigInt(x.units) <= 0n,
    )
  )
    throw new HostError(422, "Choose the explicit token inventory for a sale.");
  const allocations = [
    ...(size > 0n ? [{ asset: settlement, units: String(size) }] : []),
    ...inventory,
  ];
  if (v.network !== "hyperliquid-mainnet")
    allocations.push({ asset: fee, units: v.gasBudget });
  return {
    network: v.network,
    wallet,
    settlementAsset: settlement,
    decimals: 6,
    allocations,
    maxFeesPerOrder: [{ asset: fee, units: v.feePerOrder }],
  };
}
function unitFloor(s: string, d: number) {
  if (!/^-?\d+(?:\.\d+)?$/.test(s))
    throw Error("Venue balance is not a decimal.");
  const [n, f = ""] = s.replace(/^-/, "").split(".");
  return (
    (BigInt(n) * 10n ** BigInt(d) +
      BigInt(f.slice(0, d).padEnd(d, "0") || "0")) *
    (s.startsWith("-") ? -1n : 1n)
  );
}
function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  try {
    const a = JSON.parse(String(v));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
async function verifyOutcome(m: MarketCandidate) {
  const id = /^pm:outcome:(\d{1,32}):(.+)$/.exec(m.id);
  if (
    !id ||
    !m.outcome ||
    id[2] !== m.outcome.toUpperCase() ||
    !/^\d{1,100}$/.test(m.address ?? "")
  )
    throw new HostError(422, "Select the exact prediction-market outcome.");
  const raw = (await marketJson(
    "https://gamma-api.polymarket.com/markets/" + id[1],
    undefined,
    60000,
  )) as Record<string, unknown>;
  const names = list(raw.outcomes),
    ids = list(raw.version === "v2" ? raw.positionIds : raw.clobTokenIds);
  const indexes = names.flatMap((o, i) =>
      typeof o === "string" && o.toUpperCase() === id[2] ? [i] : [],
    ),
    i = indexes[0];
  if (
    String(raw.id) !== id[1] ||
    indexes.length !== 1 ||
    ids.length !== names.length ||
    String(ids[i]) !== m.address ||
    raw.closed === true ||
    raw.active === false
  )
    throw new HostError(
      422,
      "The outcome token differs from the active market.",
    );
}
export class MainnetHost {
  readonly access: LiveAuthority;
  readonly programs: MainnetStore;
  readonly coord: LiveCoordinator;
  readonly allowances: AllowanceQueue;
  readonly hl: HyperliquidVenue;
  readonly sol: SolanaMainnet;
  readonly rh: RobinhoodMainnet;
  readonly spot: ReturnType<typeof privySpotFeature>;
  readonly drivers: Record<Network, Driver>;
  private timer?: ReturnType<typeof setInterval>;
  private wave?: Promise<void>;
  private stopped = false;
  private inFlight = new Map<string, Promise<void>>();
  private last = new Map<string, number>();
  private observed = new Map<
    string,
    {
      at: number;
      value: Promise<Awaited<ReturnType<typeof quoteAsset>>["quote"]>;
    }
  >();
  lastCycle: number | null = null;
  constructor(readonly d: MainnetOptions) {
    this.hl = d.hl ?? new HyperliquidVenue("mainnet", fetch, d.now);
    this.sol =
      d.sol ??
      new SolanaMainnet({
        rpcUrl: d.config.SOLANA_READ_RPC,
        jupiterKey: d.config.JUPITER_API_KEY,
        now: d.now,
      });
    this.rh =
      d.rh ??
      new RobinhoodMainnet({
        rpcUrl: d.config.MAINNET_READONLY_RPC_URL,
        now: d.now,
      });
    const enabled = () => d.enabled() && d.healthy() && !this.stopped;
    this.access = new LiveAuthority({
      store: d.store,
      vault: d.vault,
      venue: this.hl,
      now: d.now,
      enabled,
      commit: d.commit,
      terms: d.config.TERMS_VERSION,
      blockedStocks: d.config.GEO_BLOCKED_COUNTRIES.split(","),
      blockedPerps: d.config.LIVE_PERP_BLOCKED_COUNTRIES.split(","),
      maxDailyUsd: d.config.MAINNET_USER_DAILY_CAP_USD,
    });
    this.programs = new MainnetStore(d.store, d.healthy, d.commit, this.access);
    this.allowances = new AllowanceQueue(
      d.store,
      this.rh,
      this.access,
      d.commit,
      d.now,
    );
    const refs = {
      extraFeeUnits: async (b: WalletBudget, p: LiveProgram) =>
        b.network === "robinhood-mainnet"
          ? String(this.allowances.fees(p.id).paid)
          : "0",
      observe: (a: Asset) => this.observe(a),
      decimals: async (b: WalletBudget, mint: string) =>
        b.network === "robinhood-mainnet"
          ? 18
          : (await this.sol.balances(b.wallet, [mint])).mints[0].decimals,
      feeMark: async (n: Network) =>
        (await this.hl.midpoint(n === "solana-mainnet" ? "SOL" : "ETH")).price,
    };
    const loss = lossSampler(this.access, refs);
    const hd = makeHyperliquidDriver(this.hl, this.access, {
      now: d.now,
      lossUsd6: loss,
    });
    const sd = makeSolanaDriver(this.sol, {
      linked: (uid, w) =>
        this.access.linked(uid, w, "solana-mainnet") &&
        this.access.eligible(uid, "solana-mainnet", true),
      lossUsd6: loss,
      now: d.now,
    });
    const rd = robinhoodLiveDriver(this.rh, {
      eligible: async (uid) =>
        this.access.eligible(uid, "robinhood-mainnet", true),
      linked: async (uid, w) => this.access.linked(uid, w, "robinhood-mainnet"),
      feeCap: async (a) => this.feeCap(a),
      approval: (a, t) => this.allowances.queue(a, t),
    });
    this.spot = privySpotFeature({
      appId: d.config.PRIVY_APP_ID,
      secret: d.config.PRIVY_APP_SECRET,
      vault: d.vault,
      records: d.store.privySpotGrants,
      commit: d.commit,
      healthy: d.healthy,
      enabled,
      rpcUrl: d.config.SOLANA_READ_RPC,
      now: d.now,
      linked: (uid, w) =>
        this.access.linked(uid, w, "solana-mainnet") &&
        this.access.eligible(uid, "solana-mainnet"),
      marks: (m) => this.sol.marks(m),
      strategy: (uid, id, version) => {
        const u = d.store.users.get(uid);
        if (!u)
          throw new HostError(403, "Sign in to manage wallet permissions.");
        return this.reviewed(u, id, version);
      },
      mode: async (uid, id) => {
        const p = await this.programs.read(uid, id);
        if (!p) throw new HostError(404, "Live workflow not found.");
        return p.mode;
      },
    });
    const secure = (base: Driver): Driver => ({
      ...base,
      balance: async (b, p, purpose) => {
        if (!this.access.linked(p.owner, b.wallet, b.network))
          throw new HostError(403, "Link the selected venue wallet first.");
        const result =
          purpose === "reduce"
            ? await this.reductionBalance(b, p)
            : await base.balance(b, p, purpose);
        if (b.network === "robinhood-mainnet") {
          const reserved = this.allowances.fees(p.id),
            gas = p.ledger.accounts.find(
              (a) => a.venue === b.network && a.asset === "ETH",
            );
          if (gas) {
            const available = BigInt(gas.free) - reserved.paid - reserved.held;
            result.free = result.free.map((a) =>
              a.asset === "ETH"
                ? {
                    ...a,
                    units: String(
                      available <= 0n
                        ? 0n
                        : BigInt(a.units) > available
                          ? available
                          : BigInt(a.units),
                    ),
                  }
                : a,
            );
          }
        }
        if (purpose === "reduce") return result;
        if (
          p.strategy.workflow!.stages.some(
            (s) => s.amount.unit === "pct_equity",
          )
        ) {
          const value = await markedProgramValue(b, p, refs, d.now());
          result.equityUsd6 = String(
            BigInt(Math.max(0, Math.floor(value.equity * 1e6))),
          );
        }
        if (
          p.strategy.workflow!.stages.some(
            (s) => s.amount.unit === "native" && s.side === "sell",
          )
        ) {
          const assets = b.allocations.filter(
            (x) =>
              x.asset !== b.settlementAsset && x.asset !== feeAsset(b.network),
          );
          result.assetDecimals = Object.fromEntries(
            await Promise.all(
              assets.map(async (x) => [
                x.asset,
                await refs.decimals(b, x.asset),
              ]),
            ),
          );
        }
        return result;
      },
      prepare: async (a) => {
        if (!this.access.allow(a.owner, a))
          throw new HostError(
            403,
            "The account's live limits or venue permissions block this order.",
          );
        return base.prepare(a);
      },
      delegated: (a) =>
        this.access.allow(a.owner, a)
          ? base.delegated(a)
          : Promise.resolve(false),
      seal: async (a, t, auth) => {
        if (!this.access.allow(a.owner, a))
          throw new HostError(403, "Live authorization changed.");
        return base.seal(a, t, auth);
      },
      broadcast: async (a, t, s) => {
        if (!this.access.allow(a.owner, a))
          throw new HostError(403, "Order dispatch is paused.");
        return base.broadcast(a, t, s);
      },
    });
    this.drivers = {
      "hyperliquid-mainnet": secure(hd),
      "solana-mainnet": secure(this.spot.wrap(sd)),
      "robinhood-mainnet": secure(rd),
    };
    this.coord = new LiveCoordinator({
      store: this.programs,
      drivers: this.drivers,
      observe: (a) => this.observe(a),
      now: d.now,
    });
  }
  private feeCap(a: Action) {
    const p = this.d.store.livePrograms.get(a.programId),
      b = p?.wallets.find(
        (v) => v.network === a.network && v.wallet === a.wallet,
      );
    const cap = b?.maxFeesPerOrder.find((v) => v.asset === feeAsset(a.network));
    if (!cap || p?.owner !== a.owner)
      throw new HostError(409, "Missing wallet fee budget.");
    return cap.units;
  }
  private async reductionBalance(
    b: WalletBudget,
    p: LiveProgram,
  ): Promise<AccountSample> {
    if (!this.access.eligible(p.owner, b.network, true))
      throw new HostError(403, "Verify the venue permission for this close.");
    const tracked = new Set([
      ...b.allocations.map((a) => a.asset),
      ...Object.values(p.orders)
        .filter(
          (o) => o.action.network === b.network && o.action.wallet === b.wallet,
        )
        .map((o) => o.action.instrument.address)
        .filter((s): s is string => !!s),
    ]);
    const common = {
      network: b.network,
      wallet: b.wallet,
      settlementAsset: b.settlementAsset,
      decimals: b.decimals,
      lossUsd6: null,
    };
    if (b.network === "hyperliquid-mainnet") {
      const a = await this.hl.account(getAddress(b.wallet)),
        funds = unitFloor(a.withdrawable, 6);
      return {
        ...common,
        observedAt: this.d.now(),
        free: [
          { asset: "USDC", units: String(funds > 0n ? funds : 0n) },
          ...a.positions.map((v) => ({
            asset: "hl:perp:" + v.coin,
            units: unitFloor(v.szi.replace(/^-/, ""), 18).toString(),
          })),
        ],
      };
    }
    if (b.network === "robinhood-mainnet") {
      const a = await this.rh.balances(
        b.wallet,
        [...tracked].filter((x) => isAddress(x)),
      );
      return { ...common, ...a };
    }
    tracked.delete(NATIVE_FEES);
    tracked.add(USDC_MINT);
    const a = await this.sol.balances(b.wallet, [...tracked]);
    const ring = p.ledger.accounts.find(
      (a) => a.venue === b.network && a.asset === NATIVE_FEES,
    );
    const budget = BigInt(ring?.free ?? "0") + BigInt(ring?.held ?? "0"),
      native = BigInt(a.nativeLamports),
      fees = native < budget ? native : budget;
    return {
      ...common,
      observedAt: this.d.now(),
      free: [
        { asset: NATIVE_FEES, units: String(fees) },
        ...a.mints.map((v) => ({
          asset: v.address,
          units: v.address === WRAPPED_SOL ? String(native - fees) : v.units,
        })),
      ],
    };
  }
  async observe(a: Asset) {
    const m = market(a);
    if (!m) return null;
    const key = canonical([a.id, m.id, m.address, m.symbol]);
    const old = this.observed.get(key);
    if (old && this.d.now() - old.at < 4000) return old.value;
    const value = (async () => {
      if (m.venue === "robinhood") {
        const q = await this.rh.spotPrice(m.symbol);
        if (!m.address || m.address.toLowerCase() !== q.address.toLowerCase())
          return null;
        return {
          assetId: a.id,
          price: q.price,
          observedAt: q.observedAt,
          source: q.source,
          synthetic: false,
        };
      }
      return (await quoteAsset(a, undefined, this.d.config.TIINGO_API_KEY))
        .quote;
    })().catch(() => null);
    if (this.observed.size >= 180)
      this.observed.delete(this.observed.keys().next().value!);
    this.observed.set(key, { at: this.d.now(), value });
    return value;
  }
  private sourceStrategy(u: User, id: string, version: number) {
    if (id.startsWith("srvpaper_")) {
      const hosted = this.d.store.workflowSessions.get(id);
      if (!hosted || hosted.owner !== u.id || hosted.session.provenance !== "server")
        throw new HostError(404, "Paper session not found.");
      if (version !== (hosted.session.editRevision ?? 0) + 1)
        throw new HostError(409, "The paper rules changed. Review the latest edit from the session.");
      return paperLivePlan(hosted.session, version).strategy;
    }
    const record = this.d.store.strategies.get(id), latest = record?.versions.at(-1);
    if (!record || record.ownerId !== u.id || record.archived || latest?.version !== version || !latest.strategy.workflow)
      throw new HostError(404, "Reopen the latest version of your saved workflow.");
    return structuredClone(latest.strategy);
  }
  async reviewed(u: User, id: string, version: number) {
    const strategy = this.sourceStrategy(u, id, version), w = strategy.workflow!;
    const stocks = w.assets.filter((a) => market(a)?.venue === "robinhood");
    if (stocks.length) {
      const issuer = await marketJson(
        ROBINHOOD_ISSUER_ASSETS,
        undefined,
        60000,
      );
      for (const a of stocks) {
        const current = market(a)!,
          verified = robinhoodIssuerCandidate(issuer, current.symbol);
        if (
          !verified ||
          (current.address &&
            current.address.toLowerCase() !== verified.address)
        )
          throw new HostError(
            422,
            "The selected stock token differs from the issuer registry.",
          );
        a.resolution = {
          ...a.resolution!,
          selectedId: verified.id,
          candidates: [verified],
          status: "matched",
        };
      }
    }
    await Promise.all(
      w.assets.flatMap((a) => {
        const v = market(a);
        return v?.venue === "polymarket" ? [verifyOutcome(v)] : [];
      }),
    );
    return strategy;
  }
  async review(u: User, id: string, version: number) {
    const s = await this.reviewed(u, id, version),
      w = s.workflow!;
    const sizes = new Map<string, number>();
    const native = w.stages
      .filter((t) => t.side === "sell" && t.amount.unit === "native")
      .map((t) => w.assets.find((a) => a.id === t.assetId)!)
      .filter(Boolean)
      .map((a) => market(a))
      .filter((v): v is MarketCandidate => !!v);
    const mints = [
      ...new Set(
        native
          .filter((v) => v.venue === "solana" && v.address)
          .map((v) => v.address!),
      ),
    ];
    if (mints.length)
      try {
        if (u.solanaWallets?.length) {
          const read = await this.sol.balances(u.solanaWallets[0], mints);
          for (const v of read.mints)
            if (mints.includes(v.address)) sizes.set(v.address, v.decimals);
        } else {
          const prices = await this.sol.marks(mints);
          for (const m of mints)
            if (prices[m]) sizes.set(m, prices[m].decimals);
        }
      } catch {}
    await Promise.all(
      native
        .filter((v) => v.venue === "robinhood" && v.address)
        .map(async (v) => {
          try {
            const addr = await this.rh.stockIdentity(v.symbol, "sell");
            if (addr.toLowerCase() === v.address!.toLowerCase())
              sizes.set(v.address!, 18);
          } catch {}
        }),
    );
    return {
      ...describeLiveStrategy(id, version, s, sizes),
      reviewHash: liveReviewDigest(id, version, s),
    };
  }
  async start(
    u: User,
    q: {
      strategyId: string;
      version: number;
      reviewHash: string;
      key: string;
      mode: "auto" | "confirm_each";
      slippageBps: number;
      wallets: Funding[];
    },
  ) {
    this.access.signedUser(u);
    this.access.writable();
    const strategy = await this.reviewed(u, q.strategyId, q.version),
      wallets = q.wallets.map(funding);
    if (q.reviewHash !== liveReviewDigest(q.strategyId, q.version, strategy))
      throw new HostError(
        409,
        "The resolved markets or rules changed. Review the workflow again.",
      );
    for (const b of wallets) {
      this.access.require(u.id, b.network, b.wallet);
      if (
        this.d.store.liveAccess.get(u.id)!.consent!.limits.maxSlippageBps <
        q.slippageBps
      )
        throw new HostError(422, "Run slippage exceeds your account limit.");
    }
    const id =
      "live_" +
      createHash("sha256")
        .update(u.id + "|" + q.key)
        .digest("hex")
        .slice(0, 28);
    const start = { ...q, owner: u.id, id, strategy, wallets };
    validateLiveRequest(start);
    const run = await this.coord.start(start);
    this.announceTick(u.id, id);
    return run;
  }
  list(uid: string) {
    return [...this.d.store.livePrograms.values()]
      .filter((p) => p.owner === uid)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => ({
        id: p.id,
        name: p.strategy.name,
        strategyId: p.strategyId,
        version: p.version,
        status: p.status,
        mode: p.mode,
        createdAt: p.createdAt,
        message: publicError(p.message),
        fills: p.ledger.orders.reduce((n, o) => n + o.executions.length, 0),
      }));
  }
  async account(u: User, n: Network, wallet: string) {
    if (!this.access.linked(u.id, wallet, n))
      throw new HostError(404, "Linked wallet not found.");
    if (n === "hyperliquid-mainnet") {
      const v = await this.hl.account(getAddress(wallet));
      return {
        network: n,
        wallet,
        stable: v.withdrawable,
        equity: v.equity,
        positions: v.positions,
        observedAt: this.d.now(),
        native: null,
      };
    }
    if (n === "solana-mainnet") {
      const v = await this.sol.balances(wallet, [USDC_MINT]);
      return {
        network: n,
        wallet,
        stable: formatUnits(
          BigInt(v.mints.find((x) => x.address === USDC_MINT)!.units),
          6,
        ),
        native: formatUnits(BigInt(v.nativeLamports), 9),
        observedAt: this.d.now(),
        positions: [],
      };
    }
    const v = await this.rh.balances(wallet, []);
    return {
      network: n,
      wallet,
      stable: formatUnits(
        BigInt(v.free.find((x) => x.asset === RH_USDG)?.units ?? "0"),
        6,
      ),
      native: formatUnits(
        BigInt(v.free.find((x) => x.asset === "ETH")?.units ?? "0"),
        18,
      ),
      observedAt: v.observedAt,
      positions: [],
    };
  }
  private tick(uid: string, id: string) {
    const old = this.inFlight.get(id);
    if (old) return old;
    const job = (async () => {
      try {
        const p = await this.programs.read(uid, id);
        if (!p || this.stopped) return;
        // A disarmed runtime cannot place new orders but can still reconcile already-sent ones.
        if (!this.d.enabled() && p.status === "running")
          await this.coord.control(uid, id, "pause");
        await this.coord.tick(uid, id);
      } catch (e) {
        const p = await this.programs.read(uid, id);
        if (p?.status === "running") {
          const msg = publicError(
            e instanceof Error ? e.message : "Waiting for venue evidence.",
          );
          if (
            !/workflow changed|already (in|controlled)/i.test(msg) &&
            p.message !== msg
          ) {
            const prior = p.revision;
            p.revision++;
            p.message = msg;
            await this.programs.cas(uid, id, prior, p).catch(() => {});
          }
        }
      }
    })().finally(() => {
      this.last.set(id, this.d.now());
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, job);
    return job;
  }
  announceTick(uid: string, id: string) {
    if (!this.stopped && this.d.healthy())
      void this.tick(uid, id).catch(() => {});
  }
  async cycle() {
    if (this.stopped || !this.d.healthy() || this.wave) return this.wave;
    this.wave = (async () => {
      await this.allowances.poll();
      const candidates = [...this.d.store.livePrograms.values()]
        .filter(
          (p) =>
            p.status === "running" ||
            p.ledger.orders.some(
              (o) => o.dispatched && !liveTerminal(o.status),
            ),
        )
        .sort(
          (a, b) => (this.last.get(a.id) ?? 0) - (this.last.get(b.id) ?? 0),
        );
      for (let i = 0; i < candidates.length && !this.stopped; i += 4)
        await Promise.all(
          candidates.slice(i, i + 4).map((p) => this.tick(p.owner, p.id)),
        );
      this.lastCycle = this.d.now();
    })()
      .catch(() => {})
      .finally(() => {
        this.wave = undefined;
      });
    return this.wave;
  }
  startMonitor() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.cycle(), 7000);
    this.timer.unref?.();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.wave;
    await Promise.allSettled(this.inFlight.values());
  }
}
export function publicError(input: string) {
  return input
    .replace(/https?:\/\/\S+/gi, "venue endpoint")
    .replace(/(?:Bearer|Basic)\s+[^\s'"]+/gi, "credentials")
    .replace(/[A-Za-z0-9_-]{64,}/g, "reference")
    .replace(/[\u0000-\u001f]+/g, " ")
    .slice(0, 280);
}
