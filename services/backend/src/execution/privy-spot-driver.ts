import type {
  Action,
  Driver,
  Evidence,
  LiveProgram,
  Prepared,
  WalletBudget,
} from "./live-program";
import type { PrivySpotGrant, PrivySpotSigner } from "./privy-spot-signer";
import {
  prepareDirect,
  bindSigned,
  broadcastExact,
  finalizedDirect,
  amount,
  type DirectPin,
} from "./raydium-scoped-swap";

export const SPOT_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const GAS = "SOL:lamports";
type Rpc = Parameters<typeof prepareDirect>[1];
type Options = {
  signer: PrivySpotSigner;
  grants: (owner: string) => PrivySpotGrant[];
  rpc: Rpc;
  linked: (owner: string, address: string) => boolean | Promise<boolean>;
  marks: (
    mints: string[],
  ) => Promise<Record<string, { usd: number; decimals: number }>>;
  mode: (owner: string, programId: string) => Promise<"auto" | "confirm_each">;
  now?: () => number;
};
type Payload = {
  lane: "privy-raydium-cp";
  grantId: string;
  pin: DirectPin;
  decimals: number;
  usdcUsd: number;
  owner: string;
  programId: string;
  intentId: string;
  strategyId: string;
  version: number;
  stage: string;
  mint: string;
};
const only = (v: unknown, msg: string): void => {
  if (!v) throw Error(msg);
};
function ratio6(
  n: bigint,
  usd: number,
  dec: number,
  outUsd: number,
  outDec: number,
) {
  const price = (v: number) => {
    only(
      Number.isFinite(v) && v > 0 && v < 1e12,
      "Market valuation is unavailable.",
    );
    const w = BigInt(v.toFixed(12).replace(".", ""));
    only(w > 0n, "Price below supported precision.");
    return w;
  };
  return (
    (n * price(usd) * 10n ** BigInt(outDec)) /
    (price(outUsd) * 10n ** BigInt(dec))
  );
}
export function withPrivySpot(manual: Driver, o: Options): Driver {
  const now = o.now ?? Date.now;
  const matching = (a: Action, live = true) => {
    if (
      a.network !== "solana-mainnet" ||
      a.side !== "buy" ||
      a.leg !== "entry" ||
      a.reduceOnly ||
      a.leverage !== 1 ||
      a.spendAsset !== SPOT_USDC ||
      a.instrument.venue !== "solana" ||
      a.instrument.id !== "sol:token:" + a.instrument.address
    )
      return;
    for (const g of o.grants(a.owner)) {
      const st = g.stages.find((s) => s.stageId === a.stage),
        c = st?.scope;
      if (
        g.ownerId === a.owner &&
        g.strategyId === a.strategyId &&
        g.version === a.version &&
        (!g.programId || g.programId === a.programId) &&
        c &&
        c.fundingOwner === a.wallet &&
        c.inputMint === a.spendAsset &&
        c.outputMint === a.instrument.address &&
        c.unitsPerOrder === a.spendUnits &&
        (!live || (g.status === "active" && c.expiresAt > now()))
      )
        return { g, c };
    }
  };
  const lane = (t: Prepared) =>
    (t.payload as unknown as Partial<Payload>)?.lane === "privy-raydium-cp";
  const get = (a: Action, t: Prepared) => {
    const p = t.payload as unknown as Payload;
    const c = p.pin.scope;
    only(
      lane(t) &&
        p.owner === a.owner &&
        p.programId === a.programId &&
        p.intentId === a.id &&
        p.strategyId === a.strategyId &&
        p.version === a.version &&
        p.stage === a.stage &&
        p.mint === a.instrument.address &&
        a.network === "solana-mainnet" &&
        a.wallet === c.fundingOwner &&
        a.spendAsset === c.inputMint &&
        a.spendUnits === c.unitsPerOrder &&
        c.outputMint === p.mint &&
        p.decimals >= 0 &&
        p.decimals <= 18 &&
        Number.isInteger(p.decimals) &&
        p.usdcUsd >= 0.98 &&
        p.usdcUsd <= 1.02,
      "The stored spot order does not match the strategy action.",
    );
    return p;
  };
  return {
    ...manual,
    async balance(
      b: WalletBudget,
      p: LiveProgram,
      purpose?: "start" | "risk" | "reduce",
    ) {
      const sample = await manual.balance(b, p, purpose);
      if (p.mode !== "auto") return sample;
      const active = o
        .grants(p.owner)
        .filter(
          (g) =>
            g.status === "active" &&
            g.strategyId === p.strategyId &&
            g.version === p.version &&
            (!g.programId || g.programId === p.id) &&
            g.stages[0].scope.fundingOwner === b.wallet &&
            g.stages[0].scope.expiresAt > now(),
        );
      if (!active.length) return sample;
      // The funding wallet pays manual-route gas. Each actual direct-message fee is paid by its own linked execution wallet.
      const native = sample.free.find((a) => a.asset === GAS),
        sum = (xs: bigint[]) => xs.reduce((x, y) => x + y, 0n);
      const execs = [...new Set(active.map((g) => g.stages[0].scope.executor))];
      const fees = await Promise.all(
        execs.map(async (address) => {
          const r = await o.rpc<{ value: number }>("getBalance", [
            address,
            { commitment: "confirmed" },
          ]);
          only(
            Number.isSafeInteger(r.value) && r.value >= 0,
            "Unknown gas balance.",
          );
          return BigInt(r.value);
        }),
      );
      const budget = p.ledger?.accounts.find(
          (a) => a.venue === b.network && a.asset === GAS,
        ),
        allocated = budget
          ? amount(budget.free) + amount(budget.held)
          : amount(b.allocations.find((a) => a.asset === GAS)?.units ?? "0");
      const available = sum(fees) + amount(native?.units ?? "0");
      return {
        ...sample,
        free: [
          ...sample.free.filter((x) => x.asset !== GAS),
          {
            asset: GAS,
            units: String(available < allocated ? available : allocated),
          },
        ],
      };
    },
    async delegated(a) {
      return (
        !!matching(a) &&
        (await o.linked(a.owner, a.wallet)) &&
        (await o.mode(a.owner, a.programId)) === "auto"
      );
    },
    async prepare(a) {
      const match = matching(a);
      if (!match || (await o.mode(a.owner, a.programId)) !== "auto")
        return manual.prepare(a);
      only(
        await o.linked(a.owner, a.wallet),
        "The strategy wallet is no longer linked.",
      );
      const scope = match.c;
      const prices = await o.marks([scope.inputMint, scope.outputMint]);
      const q = prices[scope.inputMint],
        v = prices[scope.outputMint];
      only(
        q?.decimals === 6 &&
          q.usd >= 0.98 &&
          q.usd <= 1.02 &&
          v &&
          v.decimals >= 0 &&
          v.decimals <= 18,
        "Verified USDC and destination valuations required.",
      );
      const marketFloor =
        (ratio6(amount(a.spendUnits), q.usd, 6, v.usd, v.decimals) *
          BigInt(10000 - a.slippageBps)) /
        10000n;
      const pin = await prepareDirect(
        scope,
        o.rpc,
        a.slippageBps,
        now(),
        String(marketFloor),
      );
      // The swap itself must encode BOTH floors; a favorable simulation alone cannot authorize a lower minimum.
      only(
        marketFloor > 0n && amount(pin.minimumOut) >= marketFloor,
        "Direct pool quote would exceed the market-price impact limit.",
      );
      const payload: Payload = {
        lane: "privy-raydium-cp",
        grantId: match.g.id,
        pin,
        decimals: v.decimals,
        usdcUsd: q.usd,
        owner: a.owner,
        programId: a.programId,
        intentId: a.id,
        strategyId: a.strategyId,
        version: a.version,
        stage: a.stage,
        mint: scope.outputMint,
      };
      const t: Prepared = {
        payload: payload as unknown as Prepared["payload"],
        expiresAt: Math.min(now() + 30000, scope.expiresAt),
        targetUnits: a.spendUnits,
        reserves: [
          { asset: a.spendAsset, units: a.spendUnits },
          { asset: GAS, units: pin.fee },
        ],
        summary:
          "Raydium · automated exact-in " +
          a.instrument.symbol +
          " · minimum " +
          pin.minimumOut +
          " base units · fee " +
          pin.fee +
          " lamports",
      };
      return t;
    },
    async seal(a, t, auth) {
      if (!lane(t)) return manual.seal(a, t, auth);
      const p = get(a, t);
      only(
        auth.kind === "delegate" &&
          t.expiresAt > now() &&
          (await o.linked(a.owner, a.wallet)) &&
          (await o.mode(a.owner, a.programId)) === "auto",
        "Delegated authorization expired.",
      );
      const signed = await o.signer.signPinned(
        a.owner,
        p.grantId,
        a.id,
        p.pin,
        {
          strategyId: a.strategyId,
          version: a.version,
          stageId: a.stage,
          programId: a.programId,
        },
      );
      only(signed.simulated.fee === p.pin.fee, "Simulated fee changed.");
      return {
        recoveryId: signed.txid,
        packet: signed.wire,
        delivery: "server",
      };
    },
    async broadcast(a, t, authorized) {
      if (!lane(t)) return manual.broadcast(a, t, authorized);
      const p = get(a, t);
      only(
        typeof authorized.packet === "string" &&
          matching(a)?.g.id === p.grantId &&
          (await o.linked(a.owner, a.wallet)) &&
          t.expiresAt >= now(),
        "Spot authority was revoked.",
      );
      only(
        bindSigned(p.pin, authorized.packet as string) ===
          authorized.recoveryId,
        "Recovery identity mismatch.",
      );
      await broadcastExact(
        o.rpc,
        authorized.packet as string,
        authorized.recoveryId,
      );
    },
    async reconcile(a, t, recoveryId, hints) {
      if (!lane(t)) return manual.reconcile(a, t, recoveryId, hints);
      const p = get(a, t),
        c = p.pin.scope,
        r = await finalizedDirect(p.pin, o.rpc, recoveryId);
      const e: Evidence = {
        network: a.network,
        wallet: a.wallet,
        recoveryId,
        fills: [],
      };
      if (r.status === "pending") return e;
      e.ref = recoveryId;
      const qty = r.status === "filled" ? r.fill.input : "0",
        fee = r.status === "filled" ? r.fill.fee : r.fee;
      const debits = [
        ...(qty === "0" ? [] : [{ asset: c.inputMint, units: qty }]),
        ...(fee === "0" ? [] : [{ asset: GAS, units: fee }]),
      ];
      const credits =
        r.status === "filled"
          ? [{ asset: c.outputMint, units: r.fill.output }]
          : [];
      if (debits.length || credits.length)
        e.fills = [
          { fillId: recoveryId, orderRef: recoveryId, qty, debits, credits },
        ];
      e.final = {
        orderRef: recoveryId,
        outcome: r.status === "filled" ? "filled" : "rejected",
        cumulativeQty: qty,
        cumulativeDebits: debits,
        cumulativeCredits: credits,
      };
      if (r.status === "filled") {
        const price =
          ((Number(r.fill.input) / 1e6) * p.usdcUsd) /
          (Number(r.fill.output) / 10 ** p.decimals);
        only(
          Number.isFinite(price) && price > 0,
          "Unusable finalized entry valuation.",
        );
        e.holding = {
          asset: c.outputMint,
          quantity: r.fill.output,
          quantityDecimals: p.decimals,
          averageEntryUsd: price,
          openedAt: r.at,
        };
      }
      return e;
    },
    async cancel(a, t, id) {
      return lane(t)
        ? "unavailable"
        : ((await manual.cancel?.(a, t, id)) ?? "unavailable");
    },
  };
}
