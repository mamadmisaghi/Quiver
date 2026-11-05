import {
  spotObservation,
  wrappedSol,
} from "@/services/backend/src/venues/solana-price";
import { marketJson } from "@/services/backend/src/compile/markets";
import {
  robinhoodIssuerCandidate,
  ROBINHOOD_ISSUER_ASSETS,
} from "@/services/backend/src/compile/robinhood-assets";
import pins from "@/services/backend/config/verified/4663-readonly.json";
import { hyperliquidBook } from "@/lib/live-market-data";
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
      const book = hyperliquidBook(b, symbol);
      if (!book) throw Error("Invalid venue order book");
      return previewJson({ venue, ...book });
    }
    if (venue === "solana") {
      if (symbol !== "SOL")
        return previewJson({ message: "Unknown spot market." }, 422);
      const observation = await spotObservation(wrappedSol, (url, init) =>
        marketJson(url, init, 8000),
      ).catch(async () => {
        // A labeled external reference is only for the watch panel. It cannot trigger or settle a trade.
        const ticker = (await marketJson(
          "https://api.exchange.coinbase.com/products/SOL-USD/ticker",
          undefined,
          6000,
        )) as { price: string; time: string; trade_id: number };
        const at = Date.parse(ticker.time);
        if (
          !positive(ticker.price) ||
          !(ticker.trade_id > 0) ||
          !Number.isFinite(at) ||
          distance(at) > 90000 ||
          distance(at) < -3000
        )
          throw Error("Stale reference");
        return {
          price: Number(ticker.price),
          at,
          source: "Coinbase SOL/USD reference",
          referencePair: "SOL/USD",
        };
      });
      return previewJson({
        venue,
        symbol,
        address: wrappedSol,
        ...observation,
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
