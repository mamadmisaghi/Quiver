import type { Workflow } from "../../contracts/src/workflow";
import { marketJson } from "../compile/markets";
import type { PaperQuote } from "./paper";

type Asset = Workflow["assets"][number];
type Get = (url: string, init?: RequestInit) => Promise<unknown>;
const positive = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const getDefault: Get = (url, init) => marketJson(url, init, 15_000);
/** Selected identities only, fixed data hosts, read-only. No orders, wallet keys or user data. */
export async function quoteAsset(a: Asset, get: Get = getDefault, tiingoKey?: string): Promise<{ quote: PaperQuote | null; message: string }> {
  const c = a.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId);
  if (!c) return { quote: null, message: `Select the exact market for ${a.query}.` };
  try {
    let price: number, observedAt = Date.now(), source = "", fundingHourly: number | undefined;
    if (c.venue === "solana") {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(c.address ?? "") || c.id !== `sol:token:${c.address}`) throw new Error("identity");
      const raw = await get(`https://api.dexscreener.com/tokens/v1/solana/${c.address}`);
      const pairs = (Array.isArray(raw) ? raw : []).filter((p) => p.chainId === "solana" && p.baseToken?.address === c.address && positive(p.priceUsd)).sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0));
      if (!pairs.length) throw new Error("no_quote"); price = Number(pairs[0].priceUsd); source = "dexscreener · pool indicative price";
    } else if (c.venue === "hyperliquid") {
      if (!/^[A-Za-z0-9@._:-]{1,40}$/.test(c.symbol) || c.id !== `hl:perp:${c.symbol}`) throw new Error("identity");
      const raw: any = await get("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) });
      const i = raw?.[0]?.universe?.findIndex((x: any) => x.name === c.symbol && !x.isDelisted);
      if (typeof i !== "number" || i < 0) throw new Error("no_market");
      price = Number(raw[1]?.[i]?.markPx); fundingHourly = Number(raw[1]?.[i]?.funding); source = "hyperliquid · mark price";
    } else if (c.venue === "polymarket") {
      if (!/^\d{1,100}$/.test(c.address ?? "") || !/^pm:outcome:\d+:[^:]+$/.test(c.id)) throw new Error("identity");
      const raw: any = await get(`https://clob.polymarket.com/midpoint?token_id=${c.address}`); price = Number(raw.mid); if (price > 1) throw new Error("invalid_odds"); source = "polymarket · outcome midpoint";
    } else {
      if (!tiingoKey || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(c.symbol)) return { quote: null, message: "Stock quotes need configured Tiingo access." };
      const raw: any = await get(`https://api.tiingo.com/iex/${encodeURIComponent(c.symbol.toLowerCase())}`, { headers: { Authorization: `Token ${tiingoKey}`, Accept: "application/json" } });
      price = Number(raw?.[0]?.last ?? raw?.[0]?.tngoLast); observedAt = Date.parse(raw?.[0]?.lastSaleTimestamp ?? raw?.[0]?.timestamp); source = "tiingo · underlying stock (not a token execution quote)";
    }
    if (!positive(price) || !Number.isFinite(observedAt)) throw new Error("invalid_quote");
    return { quote: { assetId: a.id, price, observedAt, source, synthetic: false, ...(Number.isFinite(fundingHourly) ? { fundingHourly } : {}) }, message: Date.now() - observedAt > 120_000 ? "Latest available quote is stale; new paper fills will wait." : "Read-only quote; fills use a modeled 0.1% fee and no order-book execution." };
  } catch { return { quote: null, message: `${a.query}: data is unavailable for this selected market. No synthetic quote was substituted.` }; }
}
