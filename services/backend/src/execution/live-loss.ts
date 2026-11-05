import type { Workflow } from "../../contracts/src/workflow";
import type { PaperQuote } from "../workflows/paper";
import type { LiveProgram, WalletBudget } from "./live-program";

export type LiveValuationRefs = {
  observe: (a: Workflow["assets"][number]) => Promise<PaperQuote | null>;
  decimals: (wallet: WalletBudget, asset: string) => Promise<number>;
  /** Current USD per native SOL or ETH, from an independently verified market. */
  feeMark: (network: WalletBudget["network"]) => Promise<number>;
  /** Confirmed gas charged by separately prepared program allowances, in lamports/wei. */
  extraFeeUnits?: (wallet: WalletBudget, p: LiveProgram) => Promise<string>;
  perpInfo?: (body: Record<string, unknown>) => Promise<unknown>;
};
const MICRO = 1000000n;
const unsigned = (v: string) => {
  if (!/^(0|[1-9]\d{0,77})$/.test(v)) throw Error("Invalid base units");
  return BigInt(v);
};
const ratio = (v: string | number) => {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(v).trim());
  if (
    !m ||
    (m[2] + (m[3] ?? "")).length > 90 ||
    Math.abs(Number(m[4] ?? 0)) > 90
  )
    throw Error("Unverifiable decimal value");
  const decimals = (m[3]?.length ?? 0) - Number(m[4] ?? 0),
    atoms = BigInt((m[1] ?? "") + m[2] + (m[3] ?? ""));
  return {
    num: atoms * (decimals < 0 ? 10n ** BigInt(-decimals) : 1n),
    den: decimals < 0 ? 1n : 10n ** BigInt(decimals),
  };
};
const floor = (n: bigint, d: bigint) => (n < 0n ? -((-n + d - 1n) / d) : n / d);
function exact(v: string, places: number) {
  const { num, den } = ratio(v),
    n = num * 10n ** BigInt(places);
  if (n % den !== 0n) throw Error("Amount exceeds venue precision");
  return n / den;
}
function valueUsd6(n: bigint, decimals: number, price: string | number) {
  const { num, den } = ratio(price);
  if (num <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw Error("Unavailable verified price or token denomination");
  return floor(n * num * MICRO, 10n ** BigInt(decimals) * den);
}
function dollars(n: bigint) {
  if (
    n > BigInt(Number.MAX_SAFE_INTEGER) ||
    n < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw Error("Equity exceeds supported USD precision");
  return Number(n) / 1e6;
}
function fields(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Unexpected venue evidence");
  return v as Record<string, unknown>;
}
async function publicPerpInfo(body: Record<string, unknown>) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!r.ok) throw Error("Hyperliquid account evidence unavailable");
  return r.json();
}
type PerpLot = {
  symbol: string;
  netQty: bigint;
  leverage: number;
  basisUsd6: bigint;
  stepDecimals: number;
  timeline: { at: number; delta: bigint }[];
};
/** Every signed funding entry belongs to a particular wallet, timestamp, market and funded position size. */
async function perpAdjustments(
  b: WalletBudget,
  at: number,
  lots: PerpLot[],
  info: NonNullable<LiveValuationRefs["perpInfo"]>,
) {
  const curves = lots.filter((l) => l.timeline.length);
  if (!curves.length) return 0n;
  const from = Math.min(...curves.flatMap((l) => l.timeline.map((t) => t.at)));
  const state = fields(
    await info({ type: "clearinghouseState", user: b.wallet }),
  );
  if (!Array.isArray(state.assetPositions))
    throw Error("Hyperliquid position evidence is unavailable");
  for (const lot of curves.filter((l) => l.netQty !== 0n)) {
    const positions = state.assetPositions
      .map((s) => fields(fields(s).position))
      .filter((s) => s.coin === lot.symbol);
    const pos = positions[0],
      lev = pos ? fields(pos.leverage) : {};
    if (
      positions.length !== 1 ||
      typeof pos.szi !== "string" ||
      exact(pos.szi, 18) !== lot.netQty ||
      lev.type !== "isolated" ||
      lev.value !== lot.leverage ||
      typeof pos.entryPx !== "string"
    )
      throw Error(
        "The live venue position no longer matches the verified strategy lots.",
      );
    const qty = lot.netQty > 0n ? lot.netQty : -lot.netQty,
      venuePx = exact(pos.entryPx, 18);
    const venueNotional = valueUsd6(qty, 18, pos.entryPx),
      diff =
        venueNotional > lot.basisUsd6
          ? venueNotional - lot.basisUsd6
          : lot.basisUsd6 - venueNotional;
    const places = Math.max(
      0,
      Math.min(6 - lot.stepDecimals, 5 - (venuePx.toString().length - 18)),
    );
    const tick = 10n ** BigInt(18 - places); // Venue rounds its average to the permissible price tick.
    if (diff > 1n + (qty * tick * MICRO) / (2n * 10n ** 36n))
      throw Error(
        "The venue basis differs from receipt-attributed strategy inventory.",
      );
  }
  let cursor = from,
    net = 0n;
  const events = new Map<string, string>();
  for (let pages = 0; pages < 12; pages++) {
    const raw = await info({
      type: "userFunding",
      user: b.wallet,
      startTime: cursor,
      endTime: at,
    });
    if (!Array.isArray(raw) || raw.length > 2000)
      throw Error("Hyperliquid funding history is unavailable");
    let end = cursor;
    for (const rawRow of raw) {
      const r = fields(rawRow),
        d = fields(r.delta);
      if (
        !Number.isSafeInteger(r.time) ||
        typeof r.time !== "number" ||
        r.time < cursor ||
        r.time > at ||
        typeof r.hash !== "string" ||
        d.type !== "funding" ||
        typeof d.coin !== "string"
      )
        throw Error("Unexpected funding history");
      end = Math.max(end, r.time);
      const lot = curves.find((l) => l.symbol === d.coin);
      if (!lot) continue;
      const before = lot.timeline.reduce(
        (n, t) => (t.at < (r.time as number) ? n + t.delta : n),
        0n,
      );
      const after = lot.timeline.reduce(
        (n, t) => (t.at === (r.time as number) ? n + t.delta : n),
        before,
      );
      if (before === 0n && after === 0n) continue;
      if (typeof d.szi !== "string" || typeof d.usdc !== "string")
        throw Error("Incomplete funding receipt");
      const qty = exact(d.szi, 18);
      if (qty !== before && qty !== after)
        throw Error("Funding includes an unverified external position.");
      const amount = exact(d.usdc, 6),
        key = r.hash + ":" + r.time + ":" + d.coin;
      const fingerprint = qty + ":" + amount;
      const prior = events.get(key);
      if (prior && prior !== fingerprint)
        throw Error("Conflicting funding receipts");
      if (!prior) {
        events.set(key, fingerprint);
        net += amount;
      }
    }
    if (raw.length < 500) return net;
    if (end === cursor) break;
    cursor = end; // Inclusive paging; deduplicate the shared boundary.
  }
  throw Error("Funding history exceeds the verified window.");
}
export async function markedProgramValue(
  b: WalletBudget,
  p: LiveProgram,
  refs: LiveValuationRefs,
  now: number,
) {
  if (b.decimals !== 6) throw Error("Missing six-decimal settlement identity");
  const w = p.strategy.workflow;
  if (!w) throw Error("Missing workflow");
  const rows = p.ledger.accounts.filter((a) => a.venue === b.network),
    stable = rows.find((a) => a.asset === b.settlementAsset);
  let equity = BigInt(stable?.free ?? "0") + BigInt(stable?.held ?? "0"),
    initial = BigInt(stable?.funded ?? "0");
  const marks = new Map<string, Promise<number>>();
  function mark(a: Workflow["assets"][number]) {
    let v = marks.get(a.id);
    if (!v) {
      v = refs.observe(a).then((q) => {
        if (
          !q ||
          q.assetId !== a.id ||
          q.synthetic ||
          !Number.isFinite(q.price) ||
          q.price <= 0 ||
          !Number.isSafeInteger(q.observedAt) ||
          q.observedAt > now + 1500 ||
          now - q.observedAt > 30000
        )
          throw Error("A fresh venue mark is required for this position.");
        return q.price;
      });
      marks.set(a.id, v);
    }
    return v;
  }
  if (b.network === "hyperliquid-mainnet") {
    const lots: PerpLot[] = [];
    for (const stage of w.stages) {
      const orders = Object.values(p.orders).filter(
        (o) => o.action.stage === stage.id && o.action.network === b.network,
      );
      if (!orders.length) continue;
      const signed = stage.side === "short" ? -1n : 1n,
        lot: PerpLot = {
          symbol: orders[0].action.instrument.symbol,
          netQty: 0n,
          leverage: stage.leverage,
          basisUsd6: 0n,
          stepDecimals: 0,
          timeline: [],
        };
      let remainingBasis = 0n;
      for (const order of orders) {
        const l = p.ledger.orders.find(
          (row) => row.spec.id === order.action.id,
        );
        if (!l || l.filledQty === "0") continue;
        const qty = unsigned(l.filledQty),
          entry = order.action.leg === "entry";
        const basis = entry ? order.perpetual?.executedNotional : undefined;
        if (entry) {
          const raw = order.terms.payload,
            market =
              raw && typeof raw === "object" && !Array.isArray(raw)
                ? raw.market
                : null;
          const places =
            market && typeof market === "object" && !Array.isArray(market)
              ? market.szDecimals
              : undefined;
          if (
            typeof places === "number" &&
            Number.isInteger(places) &&
            places >= 0 &&
            places <= 6
          )
            lot.stepDecimals = places;
        }
        if (
          entry &&
          (!order.holding || unsigned(order.holding.quantity) !== qty)
        )
          throw Error("Awaiting complete venue position evidence.");
        if (!entry && !order.action.entryAverageUsd)
          throw Error("Missing verified close cost basis.");
        const n =
          basis !== undefined
            ? floor(ratio(basis).num * MICRO, ratio(basis).den)
            : valueUsd6(
                qty,
                18,
                entry
                  ? order.holding!.averageEntryUsd
                  : order.action.entryAverageUsd!,
              );
        remainingBasis += entry ? n : -n;
        lot.netQty += signed * (entry ? qty : -qty);
        for (const f of l.executions) {
          if (f.qty === "0") continue;
          const m = /^hl:(\d{1,16}):\d+$/.exec(f.fillId),
            ts = Number(m?.[1]);
          if (
            !m ||
            !Number.isSafeInteger(ts) ||
            ts < p.createdAt - 5000 ||
            ts > now + 1000
          )
            throw Error("Position receipt chronology is unavailable.");
          lot.timeline.push({
            at: ts,
            delta: signed * (entry ? unsigned(f.qty) : -unsigned(f.qty)),
          });
        }
      }
      if (
        lot.timeline.reduce((n, t) => n + t.delta, 0n) !== lot.netQty ||
        lot.netQty * signed < 0n
      )
        throw Error("Conflicting live position attribution.");
      const journalLots = rows.find(
        (row) => row.asset === orders[0].action.instrument.id,
      );
      if (
        BigInt(journalLots?.free ?? "0") + BigInt(journalLots?.held ?? "0") !==
        lot.netQty * signed
      )
        throw Error("Unreconciled perpetual inventory.");
      if (lot.netQty) {
        const asset = w.assets.find((a) => a.id === stage.assetId);
        if (!asset) throw Error("Position market missing.");
        const notional = valueUsd6(lot.netQty * signed, 18, await mark(asset));
        lot.basisUsd6 = remainingBasis;
        if (remainingBasis <= 0n)
          throw Error("Unverified perpetual cost basis.");
        equity +=
          floor(remainingBasis, BigInt(stage.leverage)) +
          signed * (notional - remainingBasis);
      }
      lots.push(lot);
    }
    equity += await perpAdjustments(
      b,
      now,
      lots,
      refs.perpInfo ?? publicPerpInfo,
    );
  } else {
    const feeAsset = b.network === "robinhood-mainnet" ? "ETH" : "SOL:lamports",
      feePlace = b.network === "robinhood-mainnet" ? 18 : 9;
    const native = rows.find((a) => a.asset === feeAsset);
    // Native reserves are separately budgeted for transactions. Only verified fees and rent changes enter trading NAV.
    const feeUnits =
      BigInt(native?.debited ?? "0") -
      BigInt(native?.credited ?? "0") +
      unsigned((await refs.extraFeeUnits?.(b, p)) ?? "0");
    if (feeUnits !== 0n)
      equity += valueUsd6(-feeUnits, feePlace, await refs.feeMark(b.network));
    for (const row of rows) {
      if (row.asset === b.settlementAsset || row.asset === feeAsset) continue;
      const n = BigInt(row.free) + BigInt(row.held),
        funded = BigInt(row.funded);
      if (n === 0n && funded === 0n) continue;
      const asset = w.assets.find((a) => {
        const c = a.resolution?.candidates.find(
          (x) => x.id === a.resolution?.selectedId,
        );
        return b.network === "solana-mainnet"
          ? c?.venue === "solana" && c.address === row.asset
          : c?.venue === "robinhood" &&
              c.address?.toLowerCase() === row.asset.toLowerCase();
      });
      if (!asset)
        throw Error("Wallet inventory has no selected execution market.");
      const [price, places] = await Promise.all([
        mark(asset),
        refs.decimals(b, row.asset),
      ]);
      equity += valueUsd6(n, places, price);
      initial += valueUsd6(funded, places, price);
    }
  }
  return {
    equity: dollars(equity),
    initial: dollars(initial),
    equityUsd6: equity.toString(),
    initialUsd6: initial.toString(),
  };
}
type Baseline = {
  day: string;
  opening: number;
  latest: number;
  high: number;
  at?: number;
};
type RiskGuard = {
  d: { now: () => number; commit: () => Promise<void> };
  record: (uid: string) => { baselines?: Record<string, Baseline> };
};
/** The daily risk fence counts drawdown from observed NAV, including fees. A missing mark holds new risk. */
export function lossSampler(authority: RiskGuard, refs: LiveValuationRefs) {
  return async (b: WalletBudget, p: LiveProgram) => {
    const now = authority.d.now(),
      day = new Date(now).toISOString().slice(0, 10);
    const value = await markedProgramValue(b, p, refs, now),
      a = authority.record(p.owner),
      all = (a.baselines ??= {});
    const key = p.id + "|" + b.network,
      prev = all[key];
    if (prev?.at !== undefined && prev.at > now)
      throw Error("A newer risk observation already exists.");
    const midnight = Date.parse(day + "T00:00:00Z");
    // A restart across an unobserved midnight conservatively carries the last known peak.
    const opening =
      prev?.day === day
        ? prev.opening
        : prev
          ? Math.max(
              value.equity,
              prev.at !== undefined && Math.abs(prev.at - midnight) <= 60000
                ? prev.latest
                : prev.high,
            )
          : value.initial;
    const high = Math.max(
      opening,
      prev?.day === day ? prev.high : opening,
      value.equity,
    );
    if (
      !prev ||
      prev.day !== day ||
      prev.high !== high ||
      prev.latest !== value.equity
    ) {
      all[key] = { day, opening, latest: value.equity, high, at: now };
      await authority.d.commit();
    } else prev.at = now;
    return (
      BigInt(Math.round(high * 1e6)) - BigInt(value.equityUsd6)
    ).toString();
  };
}
