import { marketJson } from "@/services/backend/src/compile/markets";
import {
  robinhoodIssuerCandidate,
  ROBINHOOD_ISSUER_ASSETS,
} from "@/services/backend/src/compile/robinhood-assets";
import pins from "@/services/backend/config/verified/4663-readonly.json";
import { previewJson } from "@/lib/preview/server";
export const dynamic = "force-dynamic";
const positive = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
function distance(t: number) {
  return Date.now() - t;
}
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams,
    venue = q.get("venue") ?? "hyperliquid",
    symbol = (
      q.get("symbol") ??
      (venue === "robinhood" ? "NVDA" : venue === "solana" ? "SOL" : "BTC")
    ).toUpperCase();
  try {
    if (venue === "hyperliquid") {
      if (!["BTC", "ETH", "SOL", "XMR"].includes(symbol))
        return previewJson({ message: "Unknown perpetual." }, 422);
      const b = (await marketJson(
        "https://api.hyperliquid.xyz/info",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "l2Book", coin: symbol }),
        },
        4000,
      )) as {
        coin: string;
        time: number;
        levels: { px: string; sz: string }[][];
      };
      const levels = b.levels?.slice(0, 2).map((side) =>
        side
          .slice(0, 10)
          .map((l) => ({ price: Number(l.px), size: Number(l.sz) }))
          .filter((l) => positive(l.price) && positive(l.size)),
      );
      const bid = levels?.[0]?.[0]?.price,
        ask = levels?.[1]?.[0]?.price;
      if (
        b.coin !== symbol ||
        !positive(bid) ||
        !positive(ask) ||
        ask < bid ||
        !Number.isSafeInteger(b.time) ||
        distance(b.time) > 30000 ||
        distance(b.time) < -3000
      )
        throw Error();
      return previewJson({
        venue,
        symbol,
        at: b.time,
        source: "Hyperliquid order book",
        price: (bid + ask) / 2,
        bid,
        ask,
        levels,
      });
    }
    if (venue === "solana") {
      const mint = "So11111111111111111111111111111111111111112";
      const v = await marketJson(
        "https://api.dexscreener.com/tokens/v1/solana/" + mint,
        undefined,
        12000,
      );
      if (!Array.isArray(v)) throw Error();
      const p = v
        .filter(
          (p) =>
            p?.chainId === "solana" &&
            p.baseToken?.address === mint &&
            positive(p.priceUsd),
        )
        .sort(
          (a, b) =>
            Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0),
        )[0];
      if (!p) throw Error();
      return previewJson({
        venue,
        symbol: "SOL",
        at: Date.now(),
        source: "Dexscreener pool observation",
        price: Number(p.priceUsd),
        liquidity: Number(p.liquidity?.usd) || null,
        volume: Number(p.volume?.h24) || null,
        address: mint,
      });
    }
    if (venue === "robinhood") {
      if (!["NVDA", "AAPL", "TSLA", "SPY"].includes(symbol))
        return previewJson({ message: "Unknown equity." }, 422);
      const m = robinhoodIssuerCandidate(
        await marketJson(ROBINHOOD_ISSUER_ASSETS, undefined, 60000),
        symbol,
      );
      if (!m) throw Error("unverified issuer");
      const pin = pins.feeds.find(
        (f) => f.symbol === symbol && f.chainId === 4663,
      );
      const base = {
        venue,
        symbol,
        address: m.address,
        source: "Robinhood issuer registry",
        at: Date.now(),
        price: null,
      };
      if (!pin) return previewJson(base);
      const rpc = async (method: string, params: unknown[]) => {
        const v = (await marketJson(
          "https://rpc.mainnet.chain.robinhood.com",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          },
          10000,
        )) as { result?: string };
        return v.result;
      };
      try {
        const [chain, round] = await Promise.all([
          rpc("eth_chainId", []),
          rpc("eth_call", [{ to: pin.proxy, data: "0xfeaf968c" }, "latest"]),
        ]);
        if (
          !chain ||
          BigInt(chain) !== 4663n ||
          !round ||
          !/^0x[0-9a-fA-F]{320}$/.test(round)
        )
          return previewJson(base);
        const word = (i: number) =>
            BigInt("0x" + round.slice(2 + i * 64, 66 + i * 64)),
          raw = BigInt.asIntN(256, word(1)),
          at = Number(word(3)) * 1000;
        if (
          raw <= 0n ||
          word(4) < word(0) ||
          distance(at) > pin.heartbeatSec * 1000 ||
          distance(at) < -3000
        )
          return previewJson(base);
        return previewJson({
          ...base,
          price: Number(raw) / 10 ** pin.decimals,
          at,
          source: "Chainlink underlying reference · chain 4663",
        });
      } catch {
        return previewJson(base);
      }
    }
    return previewJson({ message: "Unknown venue." }, 422);
  } catch {
    return previewJson(
      { message: "A current venue observation is unavailable." },
      503,
    );
  }
}
