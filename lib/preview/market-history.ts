import { marketJson } from "@/services/backend/src/compile/markets";
import { MOCK_INSTRUMENTS } from "@/services/backend/src/venues/registry";
import { TiingoHistory, type Bar } from "@/services/backend/src/venues/tiingo";
import type { MarketHistoryRes, MarketRange, MarketTf } from "@/lib/api/types";

const day = 86400000;
const steps = { "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": day };
const windows = { "1d": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
const catalog = [
  ...MOCK_INSTRUMENTS,
  {
    id: "hl:perp:XMR",
    symbol: "XMR",
    venue: "hyperliquid",
    assetClass: "crypto",
  },
];
let stocks: TiingoHistory | undefined;

export function validBars(input: Bar[], start: number, end: number): Bar[] {
  const unique = new Map<number, Bar>();
  for (const b of input)
    if (
      b.t > start &&
      b.t <= end &&
      [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) &&
      b.l > 0 &&
      b.l <= Math.min(b.o, b.c) &&
      b.h >= Math.max(b.o, b.c)
    )
      unique.set(b.t, b);
  return [...unique.values()].sort((a, b) => a.t - b.t);
}
async function spotBars(
  symbol: string,
  from: number,
  to: number,
  step: number,
) {
  const base = step === steps["4h"] ? steps["1h"] : step;
  const batches: Promise<unknown>[] = [];
  for (let start = from; start < to; start += base * 299) {
    const query = new URLSearchParams({
      start: new Date(start).toISOString(),
      end: new Date(Math.min(to, start + base * 299)).toISOString(),
      granularity: String(base / 1000),
    });
    batches.push(
      marketJson(
        "https://api.exchange.coinbase.com/products/" +
          symbol +
          "-USD/candles?" +
          query,
        undefined,
        60000,
      ),
    );
  }
  const rows = (await Promise.all(batches)).flatMap((chunk) =>
    Array.isArray(chunk) ? chunk : [],
  );
  const bars = validBars(
    rows.filter(Array.isArray).map(([t, l, h, o, c]) => ({
      t: Number(t) * 1000 + base,
      o: Number(o),
      h: Number(h),
      l: Number(l),
      c: Number(c),
    })),
    from,
    to,
  );
  if (base === step) return bars;
  const groups = new Map<number, Bar[]>();
  for (const b of bars) {
    const key = Math.ceil(b.t / step) * step;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  return [...groups].flatMap(([t, g]) =>
    g.length === step / base && t <= to
      ? [
          {
            t,
            o: g[0].o,
            h: Math.max(...g.map((b) => b.h)),
            l: Math.min(...g.map((b) => b.l)),
            c: g[g.length - 1].c,
          },
        ]
      : [],
  );
}
type Pool = {
  attributes?: { address?: string };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
};
async function poolBars(
  mint: string,
  tf: MarketTf,
  from: number,
  to: number,
  step: number,
) {
  const api = "https://api.geckoterminal.com/api/v2/networks/solana";
  const pools = (await marketJson(
    api + "/tokens/" + mint + "/pools",
    undefined,
    600000,
  )) as { data?: Pool[] };
  const tokenId = "solana_" + mint;
  const pool = pools.data?.find(
    (p) =>
      p.relationships?.base_token?.data?.id === tokenId ||
      p.relationships?.quote_token?.data?.id === tokenId,
  );
  const address = pool?.attributes?.address;
  if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return [];
  const timeframe = tf === "15m" ? "minute" : tf === "1d" ? "day" : "hour";
  const token =
    pool?.relationships?.base_token?.data?.id === tokenId ? "base" : "quote";
  const query = new URLSearchParams({
    aggregate: tf === "15m" ? "15" : tf === "4h" ? "4" : "1",
    currency: "usd",
    token,
    before_timestamp: String(to / 1000),
    limit: String(Math.min(1000, (to - from) / step)),
  });
  const feed = (await marketJson(
    api + "/pools/" + address + "/ohlcv/" + timeframe + "?" + query,
    undefined,
    60000,
  )) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (feed.data?.attributes?.ohlcv_list ?? []).map(([t, o, h, l, c]) => ({
    t: t * 1000 + step,
    o,
    h,
    l,
    c,
  }));
}
export async function readMarketHistory(
  id: string,
  tf: MarketTf,
  range: MarketRange,
): Promise<MarketHistoryRes | null> {
  const market = catalog.find(
    (m) =>
      m.id === id ||
      (m.venue === "robinhood" &&
        ["equity", "etf"].includes(m.assetClass) &&
        id === "underlying:" + m.symbol),
  );
  if (!market) return null;
  const step = steps[tf],
    to = Math.floor(Date.now() / step) * step,
    from = to - windows[range] * day;
  const iso = (t: number) => new Date(t).toISOString();
  let input: Bar[] = [],
    source = "",
    dataSource: MarketHistoryRes["dataSource"] = "fallback";
  if (market.venue === "hyperliquid") {
    source = "Hyperliquid perpetual trades";
    const raw = await marketJson(
      "https://api.hyperliquid.xyz/info",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "candleSnapshot",
          req: {
            coin: market.symbol,
            interval: tf,
            startTime: from,
            endTime: to - 1,
          },
        }),
      },
      60000,
    );
    if (Array.isArray(raw))
      input = raw
        .filter((x) => x && x.s === market.symbol && x.i === tf)
        .map((x) => ({
          t: Number(x.t) + step,
          o: Number(x.o),
          h: Number(x.h),
          l: Number(x.l),
          c: Number(x.c),
        }));
  } else if (market.venue === "solana") {
    if (market.symbol === "SOL") {
      source = "Coinbase SOL/USD reference";
      input = await spotBars("SOL", from, to, step).catch(() => []);
    }
    if (!input.length) {
      source = "GeckoTerminal · Solana pool trades";
      input = await poolBars(market.id.split(":")[2], tf, from, to, step);
    }
  } else if (market.assetClass === "equity" || market.assetClass === "etf") {
    source = "Tiingo underlying equity";
    dataSource = "tiingo";
    if (process.env.TIINGO_API_KEY) {
      stocks ??= new TiingoHistory({ key: process.env.TIINGO_API_KEY });
      input = (await stocks.bars(market.symbol, step, from, to)) ?? [];
    }
  }
  const bars = validBars(input, from, to),
    first = bars[0],
    last = bars.at(-1);
  const high = bars.length ? Math.max(...bars.map((b) => b.h)) : null,
    low = bars.length ? Math.min(...bars.map((b) => b.l)) : null;
  return {
    instrumentId: id,
    tf,
    range,
    from: iso(from),
    to: iso(to),
    dataSource,
    synthetic: false,
    warmup: false,
    warmupNotice: null,
    notice: null,
    bars: bars.map((b) => ({
      t: iso(b.t),
      o: String(b.o),
      h: String(b.h),
      l: String(b.l),
      c: String(b.c),
    })),
    coverage:
      first && last
        ? [
            {
              source,
              from: iso(first.t),
              to: iso(last.t),
              synthetic: false,
              modeled: false,
              gaps: bars.slice(1).filter((b, i) => b.t - bars[i].t > step * 1.5)
                .length,
            },
          ]
        : [],
    stats: {
      bars: bars.length,
      open: first ? String(first.o) : null,
      last: last ? String(last.c) : null,
      high: high === null ? null : String(high),
      low: low === null ? null : String(low),
      rangePct: high && low ? String((high / low - 1) * 100) : null,
      changePct: first && last ? String((last.c / first.o - 1) * 100) : null,
      volatilityPct: null,
    },
  };
}
