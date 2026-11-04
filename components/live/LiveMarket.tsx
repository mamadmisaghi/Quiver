"use client";
import { useEffect, useState } from "react";
import QuoteNumber from "../charts/QuoteNumber";
import DeskHistory from "../charts/DeskHistory";
import { RefreshCw } from "lucide-react";
import { shortAddress, type LiveNetwork } from "@/lib/live-client";
type Price = {
  symbol: string;
  price: number | null;
  at: number;
  source: string;
  bid?: number;
  ask?: number;
  address?: string;
  liquidity?: number;
  volume?: number;
  slot?: number;
  referencePair?: string;
  levels?: { price: number; size: number }[][];
};
const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(2, d),
    maximumFractionDigits: d,
  });
const quotes = new Map<string,Price>();
export default function LiveMarket({ net, active }: { net: LiveNetwork; active:boolean }) {
  const perp = net === "hyperliquid-mainnet",
    stock = net === "robinhood-mainnet",
    symbols = perp
      ? ["BTC", "ETH", "SOL", "XMR"]
      : stock
        ? ["NVDA", "AAPL", "TSLA", "SPY"]
        : ["SOL"];
  const [symbol, setSymbol] = useState(symbols[0]),
    [fresh, setFresh] = useState<Price | null>(null),
    [error, setError] = useState(""),
    [serial, setSerial] = useState(0);
  const key=net+"|"+symbol;
  const record=fresh?.symbol===symbol?fresh:quotes.get(key)??null;
  const historyId=perp?"hl:perp:"+symbol:stock?"underlying:"+symbol:"sol:token:So11111111111111111111111111111111111111112";
  useEffect(() => {
    if(!active)return;
    let alive = true;
    const ctl = new AbortController();
    let t: ReturnType<typeof setTimeout>;
    setFresh(quotes.get(key)??null);
    setError("");
    const poll = async () => {
      try {
        const r = await fetch(
          "/api/preview/live-market?venue=" +
            (perp ? "hyperliquid" : stock ? "robinhood" : "solana") +
            "&symbol=" +
            encodeURIComponent(symbol),
          { signal: ctl.signal, cache: "no-store" },
        );
        if (!r.ok) throw Error("The venue did not return a fresh observation.");
        const v = (await r.json()) as Price;
        if (!v.source || !Number.isFinite(v.at))
          throw Error("The quote could not be verified.");
        if (alive) {
          quotes.set(key,v);
          setFresh(v);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setFresh(quotes.get(key)??null);
          setError(e instanceof Error ? e.message : "Market data unavailable.");
        }
      } finally {
        if (alive)
          t = setTimeout(
            () => void poll(),
            document.hidden ? 45000 : perp ? 14000 : 30000,
          );
      }
    };
    void poll();
    return () => {
      alive = false;
      ctl.abort();
      clearTimeout(t);
    };
  }, [active,key,net, symbol, serial, perp, stock]);
  const levels = record?.levels,
    book = levels && levels.length === 2 ? levels : null;
  const max = book
    ? Math.max(...book.map((s) => s.reduce((v, l) => v + l.size, 0)), 1)
    : 1;
  const currency = "USD";
  const stats = perp
    ? [
        ["Best bid", record?.bid ? "$" + fmt(record.bid) : "—"],
        ["Best ask", record?.ask ? "$" + fmt(record.ask) : "—"],
      ]
    : stock
      ? [
          ["Network", "Chain 4663"],
          ["Token", record?.address ? shortAddress(record.address) : "—"],
        ]
      : record?.referencePair
        ? [
            ["Reference pair", record.referencePair],
            ["Mint", shortAddress(record.address ?? "")],
          ]
        : record?.slot
          ? [
              ["Observed slot", String(record.slot)],
              ["Mint", shortAddress(record.address ?? "")],
            ]
          : [
              [
                "Pool liquidity",
                record?.liquidity ? "$" + fmt(record.liquidity, 0) : "—",
              ],
              [
                "24h pool volume",
                record?.volume ? "$" + fmt(record.volume, 0) : "—",
              ],
            ];
  return (
    <div className="live-market">
      <div className="live-market-head">
        <h2>Market watch</h2>
        <div className="live-market-opts">
          <label className="sr-only" htmlFor={"watch-pair-"+net}>
            Market watch symbol
          </label>
          <select
            id={"watch-pair-"+net}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Refresh market observation"
            title="Refresh market observation"
            onClick={() => setSerial((x) => x + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="live-quote-grid">
        <div>
          <span className="live-kicker">
            {symbol} / {currency}
          </span>
          <div className="live-price">
            {record?.price != null
              ? <QuoteNumber value={record.price}/>
              : error
                ? "Unavailable"
                : record
                  ? "Registry verified"
                  : "…"}
          </div>
          <div className="live-source">
            {error && record ? "Last observation · " : ""}{record?.source ??
              (error ? "Waiting for venue data" : "Reading the venue")}{" "}
            {record && (
              <time dateTime={new Date(record.at).toISOString()}>
                ·{" "}
                {new Date(record.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
            )}
          </div>
        </div>
        {book && (
          <figure
            className="live-depth"
            aria-label="Cumulative quantity at the top ten bid and ask price levels"
          >
            <div>
              {book.map((side, idx) => {
                let cumulative = 0;
                const points = side.map((l, i) => {
                  cumulative += l.size;
                  return [i * 13, 39 - (cumulative / max) * 33];
                });
                if (!idx) points.forEach((p) => (p[0] = 120 - p[0]));
                return (
                  <svg
                    key={idx}
                    viewBox="0 0 120 40"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    <polygon
                      points={[
                        "0,40",
                        ...(!idx ? points.reverse() : points).map((p) =>
                          p.join(","),
                        ),
                        "120,40",
                      ].join(" ")}
                      fill={idx ? "#ffb54526" : "#92bba82b"}
                    />
                    <polyline
                      points={points.map((p) => p.join(",")).join(" ")}
                      fill="none"
                      stroke={idx ? "#d79f48" : "#8eb9a4"}
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                );
              })}
            </div>
            <figcaption>
              Bid depth <span>Ask depth</span>
            </figcaption>
          </figure>
        )}
      </div>
      <DeskHistory key={historyId} id={historyId} active={active} />
      <dl className="live-stats">
        {stats.map(([name, val]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
