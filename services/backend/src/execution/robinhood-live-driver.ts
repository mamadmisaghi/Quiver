import type {
  Action,
  Driver,
  LiveProgram,
  Prepared,
  WalletBudget,
  Evidence,
} from "./live-program";
import {
  RH_USDG,
  RobinhoodMainnet,
  type RhIntent,
  type RhPrepared,
  type RhResult,
} from "./robinhood-mainnet";
import { isAddress } from "viem";
type Callbacks = {
  eligible: (owner: string) => Promise<boolean>;
  /** Verifies the wallet is still linked to the authenticated user at execution time. */
  linked: (owner: string, wallet: string) => Promise<boolean>;
  /** Actual wallet or program loss incl. fees and marked positions in micro USD. Return null until proven. */
  dailyLoss?: (
    binding: WalletBudget,
    program: Pick<LiveProgram, "id" | "owner" | "orders">,
  ) => Promise<string | null>;
  /** Retrieves the persisted fee ceiling authorized in this program's wallet budget. */
  feeCap: (action: Action) => Promise<string>;
  /** A separate wallet approval must finish before preparing an actual swap; the coordinator holds the stage and retries. */
  approval?: (action: Action, terms: RhPrepared) => Promise<void>;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const reid = (p: RhPrepared) => "rh:4663:" + p.owner + ":" + p.nonce;
function pinned(action: Action, t: Prepared) {
  const p = t.payload as unknown as RhPrepared;
  if (
    p?.kind !== "swap" ||
    !same(p.owner, action.wallet) ||
    action.network !== "robinhood-mainnet" ||
    p.inputUnits !== action.spendUnits ||
    !same(p.inputToken, action.spendAsset) ||
    p.symbol !== action.instrument.symbol ||
    p.slippageBps !== action.slippageBps ||
    !action.instrument.address ||
    !same(
      action.instrument.address,
      p.side === "buy" ? p.outputToken : p.inputToken,
    )
  )
    throw Error("Robinhood transaction does not match this stage");
  return p;
}
export function robinhoodLiveDriver(
  rh: RobinhoodMainnet,
  d: Callbacks,
): Driver {
  const authorized = async (owner: string, wallet: string) =>
    (await d.eligible(owner)) && (await d.linked(owner, wallet));
  const cache = new Map<string, RhResult>(),
    boundary = new Map<number, { hash: `0x${string}`; at: number }>();
  async function programLoss(
    b: WalletBudget,
    p: Pick<LiveProgram, "id" | "owner" | "orders">,
  ): Promise<string | null> {
    const today = Math.floor(rh.now() / 86400000) * 86400000,
      opening = new Map<string, bigint>(),
      current = new Map<string, bigint>(),
      symbols = new Map<string, string>();
    let cash = 0n;
    const orders = Object.values(p.orders).filter(
      (o) =>
        o.action.network === "robinhood-mainnet" &&
        same(o.action.wallet, b.wallet) &&
        o.recoveryId,
    );
    for (const o of orders) {
      const t = pinned(o.action, o.terms),
        key = p.id + ":" + o.action.id + ":" + t.termsHash;
      let r = cache.get(key);
      if (!r) {
        r = await rh.reconcile(t, o.candidateHashes?.[0]);
        if (!["filled", "failed", "replaced"].includes(r.status)) return null;
        if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
        cache.set(key, r);
      }
      if (r.status === "replaced") continue;
      if (r.blockTime === undefined || !r.blockHash || !r.feeWei) return null;
      if (r.blockTime >= today && BigInt(r.feeWei) > 0n)
        cash -= await rh.gasUsd6(r.feeWei, r.blockHash, r.blockTime);
      if (r.status === "failed") continue;
      if (!r.amountIn || !r.amountOut || !r.notionalUsd6) return null;
      const buy = t.side === "buy",
        asset = buy ? t.outputToken : t.inputToken,
        change = buy ? BigInt(r.amountOut) : -BigInt(r.amountIn);
      symbols.set(asset, t.symbol);
      current.set(asset, (current.get(asset) ?? 0n) + change);
      if (r.blockTime < today)
        opening.set(asset, (opening.get(asset) ?? 0n) + change);
      else cash += buy ? -BigInt(r.notionalUsd6) : BigInt(r.notionalUsd6);
    }
    if ([...opening.values(), ...current.values()].some((n) => n < 0n))
      return null;
    if (current.size) {
      const verified = await rh.balances(b.wallet, [...current.keys()]);
      if (
        [...current].some(
          ([asset, expected]) =>
            BigInt(verified.free.find((f) => f.asset === asset)?.units ?? "0") <
            expected,
        )
      )
        return null;
    }
    let pnl = cash;
    for (const [asset, symbol] of symbols) {
      const then = opening.get(asset) ?? 0n,
        now = current.get(asset) ?? 0n;
      if (then > 0n) {
        let start = boundary.get(today);
        if (!start) {
          start = await rh.blockAt(today);
          boundary.clear();
          boundary.set(today, start);
        }
        pnl -= await rh.stockValueUsd6(symbol, asset, then, start);
      }
      if (now > 0n) pnl += await rh.stockValueUsd6(symbol, asset, now);
    }
    return String(pnl < 0n ? -pnl : 0n);
  }
  return {
    readiness: async (b, m, s) => {
      try {
        if (
          b.network !== "robinhood-mainnet" ||
          !isAddress(b.wallet) ||
          b.settlementAsset !== RH_USDG ||
          b.decimals !== 6 ||
          !b.maxFeesPerOrder.some(
            (x) => x.asset === "ETH" && BigInt(x.units) > 0n,
          )
        )
          return "Allocate canonical USDG on chain 4663 and a maximum ETH network fee.";
        if (
          m.venue !== "robinhood" ||
          m.kind !== "token" ||
          !m.address ||
          m.id.toLowerCase() !== "robinhood:token:" + m.address.toLowerCase() ||
          s.leverage !== 1 ||
          (s.side !== "buy" && s.side !== "sell")
        )
          return "Choose a canonical cash stock token with 1× leverage.";
        const stock = await rh.stockIdentity(m.symbol, s.side);
        return same(m.address, stock)
          ? null
          : "The selected stock address differs from the issuer registry.";
      } catch (e) {
        return e instanceof Error
          ? e.message
          : "Robinhood deployment unavailable";
      }
    },
    balance: async (b, p) => {
      if (!(await authorized(p.owner, b.wallet)))
        throw Error(
          "A verified eligible owner and linked stock wallet are required.",
        );
      const assets = [
        ...new Set(
          [
            ...b.allocations.map((a) => a.asset),
            ...Object.values(p.orders)
              .filter(
                (o) =>
                  o.action.network === b.network &&
                  same(o.action.wallet, b.wallet),
              )
              .map((o) => o.action.instrument.address ?? ""),
          ].filter((a) => isAddress(a)),
        ),
      ];
      const [v, loss] = await Promise.all([
        rh.balances(b.wallet, assets),
        (d.dailyLoss ?? programLoss)(b, p),
      ]);
      if (loss === null || !/^\d+$/.test(loss))
        throw Error(
          "Robinhood daily loss and marked exposure have not been verified.",
        );
      return {
        network: "robinhood-mainnet",
        wallet: b.wallet,
        settlementAsset: RH_USDG,
        decimals: 6,
        observedAt: v.observedAt,
        free: v.free,
        lossUsd6: loss,
      };
    },
    prepare: async (a) => {
      if (
        a.network !== "robinhood-mainnet" ||
        !a.instrument.address ||
        a.leverage !== 1 ||
        (a.side !== "buy" && a.side !== "sell") ||
        !(await authorized(a.owner, a.wallet))
      )
        throw Error("Unsupported or unauthorized stock-token action");
      const cap = await d.feeCap(a),
        intent: RhIntent = {
          owner: a.wallet,
          symbol: a.instrument.symbol,
          side: a.side,
          amountIn: a.spendUnits,
          minOutput: "1",
          maxFeeWei: cap,
          slippageBps: a.slippageBps,
          maxImpactBps: Math.min(500, a.slippageBps + 100),
          eligible: true,
        };
      const p = await rh.prepare(intent);
      if (
        !same(a.spendAsset, p.inputToken) ||
        !same(
          a.instrument.address,
          p.side === "buy" ? p.outputToken : p.inputToken,
        )
      )
        throw Error(
          "The prepared route does not use the selected stock and spend asset.",
        );
      if (p.kind !== "swap") {
        await d.approval?.(a, p);
        throw Error(
          "Approve the exact token allowance in the linked wallet before the stock swap.",
        );
      }
      return {
        payload: p as unknown as Prepared["payload"],
        expiresAt: p.expiresAt,
        targetUnits: p.inputUnits,
        reserves: [
          { asset: p.inputToken, units: p.inputUnits },
          { asset: "ETH", units: p.maxFeeWei },
        ],
        summary:
          (p.side === "buy" ? "Buy " : "Sell ") +
          p.symbol +
          " on Robinhood Chain. Minimum output " +
          p.minimumOutputUnits +
          " base units; exact bounded input and ETH fee.",
      };
    },
    seal: async (a, t, auth) => {
      const p = pinned(a, t),
        v = auth.kind === "wallet" ? auth.value : null;
      if (
        !v ||
        typeof v !== "object" ||
        Array.isArray(v) ||
        v.authorizeWalletSubmission !== true
      )
        throw Error("Explicit owner-wallet submission is required.");
      await rh.validate(p, await authorized(a.owner, a.wallet));
      return { recoveryId: reid(p), packet: p.tx, delivery: "wallet" };
    },
    broadcast: async () => {
      throw Error(
        "This order is sent by the linked EVM wallet after its persistent dispatch claim.",
      );
    },
    reconcile: async (a, t, id, candidates = []) => {
      const p = pinned(a, t);
      if (id !== reid(p)) throw Error("Mismatched Robinhood recovery ID");
      const r = await rh.reconcile(p, candidates[0]);
      const base: Evidence = {
        network: "robinhood-mainnet",
        wallet: a.wallet,
        recoveryId: id,
        fills: [],
      };
      if (!r.txHash || !["filled", "failed", "replaced"].includes(r.status))
        return base;
      const fee =
        r.feeWei && BigInt(r.feeWei) > 0n
          ? [{ asset: "ETH", units: r.feeWei }]
          : [];
      if (r.status !== "filled") {
        const fills = fee.length
          ? [
              {
                orderRef: r.txHash,
                fillId: r.txHash + ":gas",
                qty: "0",
                debits: fee,
                credits: [],
              },
            ]
          : [];
        return {
          ...base,
          ref: r.txHash,
          fills,
          final: {
            orderRef: r.txHash,
            outcome: r.status === "failed" ? "rejected" : "cancelled",
            cumulativeQty: "0",
            cumulativeDebits: fee,
            cumulativeCredits: [],
          },
        };
      }
      if (!r.amountOut || !r.amountIn || !r.fillId) return base;
      const debits = [{ asset: p.inputToken, units: r.amountIn }, ...fee],
        credits = [{ asset: p.outputToken, units: r.amountOut }];
      const evidence: Evidence = {
        ...base,
        ref: r.txHash,
        fills: [
          {
            fillId: r.fillId,
            orderRef: r.txHash,
            qty: r.amountIn,
            debits,
            credits,
          },
        ],
        final: {
          orderRef: r.txHash,
          outcome: "filled",
          cumulativeQty: r.amountIn,
          cumulativeDebits: debits,
          cumulativeCredits: credits,
        },
      };
      if (
        a.leg === "entry" &&
        p.side === "buy" &&
        r.blockTime !== undefined &&
        r.notionalUsd6
      ) {
        const avg = (Number(r.notionalUsd6) / Number(r.amountOut)) * 1e12;
        if (Number.isFinite(avg) && avg > 0)
          evidence.holding = {
            asset: p.outputToken,
            quantity: r.amountOut,
            averageEntryUsd: avg,
            openedAt: r.blockTime,
          };
      }
      return evidence;
    },
    cancel: async () => "unavailable",
    delegated: async () => false,
  };
}
