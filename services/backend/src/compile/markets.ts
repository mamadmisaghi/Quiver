import { robinhoodIssuerCandidate, ROBINHOOD_ISSUER_ASSETS } from "./robinhood-assets";
import type { Workflow, MarketCandidate } from "../../contracts/src/workflow";
import { MOCK_INSTRUMENTS, isEquitySymbol } from "../venues/registry";

type Asset = Workflow["assets"][number];
const ALIASES: Record<string, string> = { "نیت": "NEET", "نییت": "NEET", "بیتکوین": "BTC", "سولانا": "SOL", "نویدیا": "NVDA", nvidia: "NVDA", "انویدیا": "NVDA", "انودیا": "NVDA", solana: "SOL", monero: "XMR", bitcoin: "BTC", "بیت کوین": "BTC", "بیت‌کوین": "BTC", ethereum: "ETH", ether: "ETH", "اتریوم": "ETH", tesla: "TSLA", apple: "AAPL", microsoft: "MSFT", "pump.fun": "PUMP", pumpfun: "PUMP", "pump fun": "PUMP", "پامپ فان": "PUMP", "neet": "NEET" };
export function canonicalSymbol(q: string) {
  const value = q.trim().replace(/^\$/, ""), key = value.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : value.toUpperCase();
}
type JsonFetch = (url: string, init?: RequestInit) => Promise<unknown>;
const cache = new Map<string, { at: number; value: unknown }>();
/** Only fixed public market-data hosts. No account keys, balances, user identity or prompts are sent. */
export async function marketJson(url: string, init?: RequestInit, ttlMs = 120_000): Promise<unknown> {
  const key = url + (init?.body ?? ""), old = cache.get(key);
  if (old && Date.now() - old.at < ttlMs) return old.value;
  // Workers support manual/follow only. A manual 3xx fails the res.ok check below;
  // redirects are never followed to an unverified host.
  const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`market_lookup_http_${res.status}`);
  const reader = res.body?.getReader(); if (!reader) throw new Error("empty_market_response");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength; if (size > 2_000_000) { await reader.cancel(); throw new Error("market_response_too_large"); } chunks.push(r.value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (ttlMs > 0) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), value });
  }
  return value;
};
const nullable = (v: unknown, max = 100): string | null => typeof v === "string" ? v.slice(0, max) : null;
const list = (v: unknown): any[] => Array.isArray(v) ? v : typeof v === "string" ? (() => { try { const r = JSON.parse(v); return Array.isArray(r) ? r : []; } catch { return []; } })() : [];

/** HIP-3 uses a case-sensitive "dex:COIN" identity. The main DEX has no prefix. */
export function perpetualInfo(type: "meta" | "metaAndAssetCtxs", dex?: string): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(dex ? { type, dex } : { type }) };
}

export async function resolveMarket(a: Asset, get: JsonFetch = marketJson, issuerIdentity=true): Promise<NonNullable<Asset["resolution"]>> {
  const checkedAt = new Date().toISOString(), sym = canonicalSymbol(a.query);
  const result = (candidates: MarketCandidate[], message: string, exact = false): NonNullable<Asset["resolution"]> => ({ status: exact && candidates.length === 1 ? "matched" : candidates.length ? "choose" : "not_found", candidates: candidates.slice(0, 8), selectedId: exact && candidates.length === 1 ? candidates[0].id : null, checkedAt, message });
  try {
    if (a.venue === "polymarket" || a.kind === "outcome") {
      const raw: any = await get(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(a.query)}&limit_per_type=6&events_status=active`);
      const markets = [...list(raw.markets), ...list(raw.events).flatMap((e) => list(e.markets))];
      const out: MarketCandidate[] = [];
      for (const m of markets) {
        if (m.closed || m.archived || m.active === false || !m.id || !m.question) continue;
        const outcomes = list(m.outcomes); const tokens = list(m.version === "v2" ? m.positionIds : m.clobTokenIds);
        outcomes.forEach((o, i) => { if (typeof o !== "string" || !tokens[i]) return; if (a.outcome && o.toLowerCase() !== a.outcome.toLowerCase()) return;
          const id = `pm:outcome:${String(m.id)}:${o.toUpperCase()}`;
          if (out.some((v) => v.id === id)) return;
          out.push({ id, symbol: o.slice(0, 40), name: `${m.question} — ${o}`.slice(0, 300), venue: "polymarket", kind: "outcome", source: "polymarket", address: String(tokens[i]).slice(0, 100), url: m.slug ? `https://polymarket.com/event/${encodeURIComponent(m.slug)}` : null, maxLeverage: 1, endDate: nullable(m.endDate, 64), outcome: o.slice(0, 80) });
        });
      }
      return result(out, out.length ? "Choose the exact event, deadline and outcome. Similar headlines can settle differently." : `No active matching Polymarket event found for “${a.query}”. Add the event title or link in Refine.`, false);
    }
    if (a.venue === "hyperliquid" || a.kind === "perp") {
      const named = /^([a-z0-9]{1,16}):([a-z0-9._-]{1,20})$/i.exec(a.query.trim());
      const dex = named ? named[1].toLowerCase() : isEquitySymbol(sym) ? "xyz" : undefined;
      const symbol = named ? named[2].toUpperCase() : sym;
      const identity = dex ? dex + ":" + symbol : symbol;
      const raw: any = await get("https://api.hyperliquid.xyz/info", perpetualInfo("meta", dex));
      const out = list(raw?.universe).filter((m) => !m.isDelisted && typeof m.name === "string" &&
        (dex ? m.name === identity : m.name.toUpperCase() === symbol)).map((m): MarketCandidate => ({
        id: "hl:perp:" + m.name, symbol: m.name, name: m.name + " perpetual",
        venue: "hyperliquid", kind: "perp", source: "hyperliquid", address: null,
        url: "https://app.hyperliquid.xyz/trade/" + encodeURIComponent(m.name),
        maxLeverage: Number.isFinite(m.maxLeverage) ? m.maxLeverage : null, endDate: null, outcome: null,
      }));
      return result(out, out.length ? "Verified perpetual in the current Hyperliquid market list."
        : "No active Hyperliquid perpetual matched " + identity + ". Search an exact market ticker.", true);
    }
    const known = MOCK_INSTRUMENTS.filter((m) => m.symbol === sym && m.venue !== "polymarket" && m.kind !== "perp" && (!a.venue || a.venue === m.venue));
    if(issuerIdentity && (a.venue==="robinhood"||known[0]?.venue==="robinhood")){
      try{const token=robinhoodIssuerCandidate(await get(ROBINHOOD_ISSUER_ASSETS),sym);if(token)return result([token],"Verified the stock token on Robinhood Chain mainnet.",true);}catch{}
    }
    if (known.length && known[0].venue === "robinhood") {
      return result(known.map((m) => ({ id: m.id, name: m.name, symbol: m.symbol, venue: m.venue, kind: m.kind, source: "preview_catalog", address: null, url: null, maxLeverage: 1, endDate: null, outcome: null })), "For paper trading, stock instruments use the underlying US equity price. No token order is routed.", true);
    }
    if (a.venue === "robinhood") return result([], `No verified Robinhood instrument is configured for “${a.query}”.`);
    const raw: any = await get(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.query.trim()) ? a.query.trim() : sym)}`);
    const exactMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.query.trim());
    const map = new Map<string, MarketCandidate>();
    for (const p of list(raw.pairs).sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))) {
      if (p.chainId !== "solana") continue;
      for (const t of [p.baseToken, p.quoteToken]) {
        if (!t || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t.address ?? "")) continue;
        if (exactMint ? t.address !== a.query.trim() : canonicalSymbol(t.symbol ?? "") !== sym && String(t.name).toLowerCase() !== a.query.toLowerCase()) continue;
        const id = `sol:token:${t.address}`; if (map.has(id)) continue;
        map.set(id, { id, symbol: String(t.symbol).slice(0, 40), name: String(t.name ?? t.symbol).slice(0, 300), venue: "solana", kind: "token", source: "dexscreener", address: t.address, url: `https://solscan.io/token/${t.address}`, maxLeverage: 1, endDate: null, outcome: null });
      }
    }
    const out = [...map.values()];
    // A ticker is not an identity. An exact mint or an already-known mint can auto-resolve; arbitrary same-name tokens require a choice.
    const trusted = known.find((k) => out.some((c) => c.id === k.id));
    return result(trusted ? out.filter((c) => c.id === trusted.id) : out, out.length ? "Solana token found. Confirm the mint address to distinguish tokens sharing this name." : `No exact Solana token match for “${a.query}”. Add its mint address in Refine.`, exactMint || !!trusted);
  } catch (error) {
    // Operational diagnostics contain only the fixed provider and error, never the prompt or account data.
    console.warn("market_lookup_unavailable", { provider: a.venue ?? a.kind ?? "solana", reason: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    return { status: "unavailable", candidates: [], selectedId: null, checkedAt, message: `The market lookup for ${a.query} is unavailable. The requested asset is preserved; no substitute was selected.` };
  }
}

export async function resolveWorkflow(w: Workflow, get?: JsonFetch, issuerIdentity=true): Promise<Workflow> {
  const assets: Asset[] = [];
  // Bound parallel fanout to four public lookups, and never resolve unused invented assets.
  for (let i = 0; i < w.assets.length; i += 4) assets.push(...await Promise.all(w.assets.slice(i, i + 4).map(async (a) => ({ ...a, resolution: await resolveMarket(a, get, issuerIdentity) }))));
  return { ...w, assets };
}
