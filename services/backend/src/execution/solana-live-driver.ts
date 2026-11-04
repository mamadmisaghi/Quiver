import type {
  Action,
  Driver,
  Evidence,
  LiveProgram,
  Prepared,
  WalletBudget,
} from "./live-program";
import type { Amount } from "./ledger";
import { SolanaMainnet, USDC_MINT, NATIVE_FEES } from "./solana-mainnet";
import { bindSignature, WRAPPED_SOL, type PinnedOrder } from "./solana-jupiter";
import { read58 } from "./solana-wire";

export type SolanaDriverOptions = {
  linked: (owner: string, wallet: string) => boolean | Promise<boolean>;
  lossUsd6: (binding: WalletBudget, program: LiveProgram) => Promise<string>;
  now?: () => number;
  maxFeesLamports?: string;
};
type Payload = { pin: PinnedOrder; assetDecimals: number; usdcUsd: number };
function check(v: unknown, message: string): asserts v {
  if (!v) throw Error(message);
}
function units(v: string) {
  check(
    typeof v === "string" && /^(0|[1-9]\d{0,77})$/.test(v),
    "Invalid integer amount",
  );
  return BigInt(v);
}
function amounts(entries: [string, bigint][]) {
  const map = new Map<string, bigint>();
  for (const [asset, n] of entries) {
    check(n >= 0n, "Invalid debit or credit");
    if (n > 0n) map.set(asset, (map.get(asset) ?? 0n) + n);
  }
  return [...map]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asset, n]) => ({ asset, units: String(n) }));
}
function bindingCheck(b: WalletBudget) {
  check(
    b.network === "solana-mainnet" &&
      b.settlementAsset === USDC_MINT &&
      b.decimals === 6,
    "Use Solana mainnet native USDC with six decimals.",
  );
  read58(b.wallet, 32);
}
function verifiedAmount(price: number) {
  check(
    Number.isFinite(price) && price > 0 && price < 1e12,
    "Unsupported USD mark",
  );
  const n = BigInt(price.toFixed(12).replace(".", ""));
  check(n > 0n, "USD mark below supported precision");
  return n;
}
export function makeSolanaDriver(
  venue: SolanaMainnet,
  d: SolanaDriverOptions,
): Driver {
  const now = d.now ?? Date.now,
    maxFee = d.maxFeesLamports ?? "10000000";
  check(
    units(maxFee) > 0n && units(maxFee) <= 10000000n,
    "Native fee ceiling exceeds the execution desk cap",
  );
  const bound = (a: Action) => {
    const mint = a.instrument.address;
    check(
      mint &&
        a.network === "solana-mainnet" &&
        a.instrument.venue === "solana" &&
        a.instrument.id === "sol:token:" + mint &&
        ["token", "spot"].includes(a.instrument.kind!) &&
        a.leverage === 1 &&
        a.slippageBps >= 1 &&
        a.slippageBps <= 500,
      "Unsupported Solana asset or execution terms",
    );
    read58(mint, 32);
    read58(a.wallet, 32);
    check(mint !== USDC_MINT, "Select a market distinct from settlement USDC.");
    const buy = a.leg === "entry" && a.side === "buy" && !a.reduceOnly;
    const sale =
      (a.leg === "entry" || a.leg === "exit") &&
      a.side === "sell" &&
      a.reduceOnly;
    check(
      (buy || sale) &&
        a.spendAsset === (buy ? USDC_MINT : mint) &&
        units(a.spendUnits) > 0n,
      "Only exact USDC buys, funded token sales and receipt-bound reductions are supported",
    );
    return {
      mint,
      input: buy ? USDC_MINT : mint,
      output: buy ? mint : USDC_MINT,
    };
  };
  const loadTerms = (a: Action, t: Prepared) => {
    const p = t.payload as unknown as Payload,
      leg = bound(a);
    check(
      p?.pin?.intent &&
        p.pin.intent.ownerId === a.owner &&
        p.pin.intent.intentId === a.id &&
        p.pin.intent.taker === a.wallet &&
        p.pin.intent.inputMint === leg.input &&
        p.pin.intent.outputMint === leg.output &&
        p.pin.intent.inputAmount === a.spendUnits &&
        p.pin.intent.maxSlippageBps === a.slippageBps &&
        p.pin.expiresAt === t.expiresAt &&
        Number.isInteger(p.assetDecimals) &&
        p.assetDecimals >= 0 &&
        p.assetDecimals <= 18 &&
        p.usdcUsd >= 0.98 &&
        p.usdcUsd <= 1.02,
      "Persisted Solana action identity or valuation changed",
    );
    return p;
  };
  return {
    async readiness(b, market, stage) {
      try {
        bindingCheck(b);
        check(
          market.address &&
            market.id === "sol:token:" + market.address &&
            market.venue === "solana" &&
            ["token", "spot"].includes(market.kind!) &&
            (stage.side === "buy" ||
              (stage.side === "sell" &&
                stage.amount?.unit === "native" &&
                b.allocations.some(
                  (a) => a.asset === market.address && units(a.units) > 0n,
                ))) &&
            stage.leverage === 1,
          "Choose an unleveraged Solana buy or explicitly allocate native units for a sale",
        );
        check(market.address !== USDC_MINT, "Choose a mint distinct from USDC");
        check(
          b.maxFeesPerOrder.some(
            (v) => v.asset === NATIVE_FEES && units(v.units) > 0n,
          ),
          "Allocate native SOL for network fees and token-account rent",
        );
        await venue.balances(b.wallet, [USDC_MINT, market.address]);
        return null;
      } catch (e) {
        return e instanceof Error
          ? e.message
          : "Unable to verify the Solana wallet and mint";
      }
    },
    async balance(b, program, purpose) {
      bindingCheck(b);
      check(
        await d.linked(program.owner, b.wallet),
        "Link and verify the program’s Solana wallet first",
      );
      const p = program as LiveProgram,
        tracked = new Set([
          USDC_MINT,
          ...b.allocations
            .filter((a) => a.asset !== NATIVE_FEES)
            .map((a) => a.asset),
        ]);
      for (const o of Object.values(p.orders))
        if (
          o.action.network === b.network &&
          o.action.wallet === b.wallet &&
          o.action.instrument.address
        )
          tracked.add(o.action.instrument.address);
      const [wallet, loss] = await Promise.all([
        venue.balances(b.wallet, [...tracked]),
        purpose === "reduce" ? Promise.resolve(null) : d.lossUsd6(b, p),
      ]);
      const native = units(wallet.nativeLamports),
        reserve = p.ledger?.accounts.find(
          (a) => a.venue === b.network && a.asset === NATIVE_FEES,
        );
      const envelope = reserve
          ? units(reserve.free) + units(reserve.held)
          : units(
              b.allocations.find((a) => a.asset === NATIVE_FEES)?.units ?? "0",
            ),
        feeRing = native < envelope ? native : envelope;
      const free: Amount[] = [
        { asset: NATIVE_FEES, units: String(feeRing) },
        ...wallet.mints.map((m) => ({
          asset: m.address,
          units: m.address === WRAPPED_SOL ? String(native - feeRing) : m.units,
        })),
      ];
      return {
        network: b.network,
        wallet: b.wallet,
        settlementAsset: USDC_MINT,
        decimals: 6,
        free,
        assetDecimals: Object.fromEntries(
          wallet.mints.map((m) => [m.address, m.decimals]),
        ),
        lossUsd6: loss === null ? null : String(units(loss)),
        observedAt: now(),
      };
    },
    async prepare(a) {
      const m = bound(a);
      check(
        await d.linked(a.owner, a.wallet),
        "The strategy wallet is no longer linked",
      );
      const [wallet, prices] = await Promise.all([
        venue.balances(a.wallet, [USDC_MINT, m.mint]),
        venue.marks([USDC_MINT, m.mint]),
      ]);
      const dec = (k: string) =>
        wallet.mints.find((m) => m.address === k)!.decimals;
      check(
        prices[USDC_MINT].decimals === 6 &&
          dec(m.mint) === prices[m.mint].decimals &&
          prices[USDC_MINT].usd >= 0.98 &&
          prices[USDC_MINT].usd <= 1.02,
        "USD marks do not match the selected mainnet mints and settlement assumptions",
      );
      const min =
        (units(a.spendUnits) *
          verifiedAmount(prices[m.input].usd) *
          10n ** BigInt(dec(m.output)) *
          BigInt(10000 - a.slippageBps)) /
        (verifiedAmount(prices[m.output].usd) *
          10n ** BigInt(dec(m.input)) *
          10000n);
      check(min > 0n, "Order below the price precision");
      const q = await venue.quote({
        ownerId: a.owner,
        intentId: a.id,
        taker: a.wallet,
        inputMint: m.input,
        outputMint: m.output,
        inputAmount: a.spendUnits,
        minOutput: String(min),
        maxSlippageBps: a.slippageBps,
        maxSwapFeeBps: 0,
        maxImpactBps: a.slippageBps,
        maxNetworkAndRentLamports: maxFee,
        expiresAt: now() + 60000,
      });
      const charges =
        units(q.expected.networkFeeLamports) +
        units(q.expected.otherNativeCostLamports) +
        (BigInt(q.expected.rentDeltaLamports) > 0n
          ? BigInt(q.expected.rentDeltaLamports)
          : 0n);
      check(charges <= units(maxFee), "This swap exceeds the native fee limit");
      const pin = {
        ...q.pin,
        intent: { ...q.pin.intent, maxNetworkAndRentLamports: String(charges) },
      };
      return {
        payload: {
          pin,
          assetDecimals: dec(m.mint),
          usdcUsd: prices[USDC_MINT].usd,
        },
        targetUnits: a.spendUnits,
        reserves: amounts([
          [m.input, units(a.spendUnits)],
          [NATIVE_FEES, charges],
        ]),
        expiresAt: pin.expiresAt,
        summary:
          "Solana mainnet · " +
          a.side +
          " " +
          a.instrument.symbol +
          " · spend " +
          a.spendUnits +
          " base units · minimum " +
          pin.requiredOutput +
          " output units · fee and rent ≤ " +
          charges +
          " lamports",
      };
    },
    async seal(a, t, auth) {
      const p = loadTerms(a, t);
      check(
        (await d.linked(a.owner, a.wallet)) && auth.kind === "wallet",
        "This swap requires the linked wallet's signature",
      );
      const s =
        typeof auth.value === "string"
          ? auth.value
          : auth.value &&
              typeof auth.value === "object" &&
              !Array.isArray(auth.value)
            ? auth.value.signed
            : null;
      check(
        typeof s === "string" && s.length <= 1644,
        "Supply the signed versioned transaction from the linked wallet",
      );
      const v = await venue.simulate(p.pin, s),
        identity = bindSignature(p.pin, s);
      check(v.txid === identity.txid, "The signed swap identity changed");
      return { recoveryId: identity.txid, packet: { signed: s } };
    },
    async broadcast(a, t, s) {
      const p = loadTerms(a, t);
      check(
        await d.linked(a.owner, a.wallet),
        "Wallet authorization was removed before dispatch",
      );
      const packet = s.packet as { signed?: string };
      check(typeof packet.signed === "string", "Signed Solana packet missing");
      await venue.broadcast(p.pin, packet.signed, s.recoveryId);
    },
    async reconcile(a, t, id) {
      const p = loadTerms(a, t),
        proof = await venue.proof(p.pin, id),
        res = proof.settlement;
      const e: Evidence = {
        network: a.network,
        wallet: a.wallet,
        recoveryId: id,
        fills: [],
      };
      if (res.status === "awaiting_finality" || res.status === "review")
        return e;
      check(
        proof.txid === id && proof.feeLamports !== null,
        "Receipt fee evidence required",
      );
      e.ref = id;
      const input = p.pin.intent.inputMint,
        output = p.pin.intent.outputMint;
      let qty = "0",
        debits: Amount[] = [],
        credits: Amount[] = [];
      if (res.status === "filled") {
        check(
          res.txid === id &&
            res.slot === proof.slot &&
            units(res.fill.input) === units(a.spendUnits) &&
            units(res.fill.output) >= units(p.pin.requiredOutput) &&
            units(res.fill.networkFeeLamports) === units(proof.feeLamports),
          "Incomplete settlement evidence",
        );
        qty = res.fill.input;
        const rent = BigInt(res.fill.rentDeltaLamports);
        debits = amounts([
          [input, units(qty)],
          [
            NATIVE_FEES,
            units(res.fill.networkFeeLamports) +
              units(res.fill.otherNativeCostLamports) +
              (rent > 0n ? rent : 0n),
          ],
        ]);
        credits = amounts([
          [output, units(res.fill.output)],
          [NATIVE_FEES, rent < 0n ? -rent : 0n],
        ]);
        if (a.leg === "entry" && a.side === "buy") {
          check(
            proof.at !== null && proof.at > 0,
            "Finalized block timestamp is required to establish an entry",
          );
          const fillPrice =
            ((Number(qty) / 1e6) * p.usdcUsd) /
            (Number(res.fill.output) / 10 ** p.assetDecimals);
          check(
            Number.isFinite(fillPrice) && fillPrice > 0,
            "Unrepresentable entry price",
          );
          e.holding = {
            asset: a.instrument.address!,
            quantity: res.fill.output,
            quantityDecimals: p.assetDecimals,
            averageEntryUsd: fillPrice,
            openedAt: proof.at,
          };
        }
      } else debits = amounts([[NATIVE_FEES, units(proof.feeLamports)]]);
      if (qty !== "0" || debits.length)
        e.fills.push({ fillId: id, orderRef: id, qty, debits, credits });
      e.final = {
        orderRef: id,
        outcome: res.status === "filled" ? "filled" : "rejected",
        cumulativeQty: qty,
        cumulativeDebits: debits,
        cumulativeCredits: credits,
      };
      return e;
    },
    async delegated() {
      return false;
    },
    async cancel() {
      return "unavailable";
    },
  };
}
