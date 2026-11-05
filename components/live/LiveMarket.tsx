"use client";
import { useEffect, useState } from "react";
import QuoteNumber from "../charts/QuoteNumber";
import DeskHistory from "../charts/DeskHistory";
import { RefreshCw } from "lucide-react";
import { shortAddress, type LiveNetwork } from "@/lib/live-client";
import {
  hyperliquidBook,
  type LiveMarketPrice as Price,
} from "@/lib/live-market-data";
const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(2, d),
    maximumFractionDigits: d,
  });
const quotes = new Map<string, Price>();
const observed = new Map<string, { t: number; v: number }[]>();
export default function LiveMarket({
  net,
  active,
}: {
  net: LiveNetwork;
  active: boolean;
}) {
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
  const key = net + "|" + symbol;
  const record = fresh?.symbol === symbol ? fresh : (quotes.get(key) ?? null);
  const historyId = perp
    ? "hl:perp:" + symbol
    : stock
      ? "underlying:" + symbol
      : "sol:token:So11111111111111111111111111111111111111112";
  useEffect(() => {
    if (!active) return;
    let alive = true,
      fetching = false,
      lastStream = 0,
      retries = 0;
    let pollTimer: ReturnType<typeof setTimeout>,
      reconnect: ReturnType<typeof setTimeout>;
    let socket: WebSocket | null = null;
    const ctl = new AbortController();
    setFresh(quotes.get(key) ?? null);
    setError("");
    const accept = (v: Price) => {
      const previous = quotes.get(key);
      if (
        !alive ||
        v.symbol !== symbol ||
        !v.source ||
        !Number.isFinite(v.at) ||
        (previous && v.at < previous.at)
      )
        return;
      if (v.price !== null && Number.isFinite(v.price)) {
        const series =
          previous?.source === v.source ? (observed.get(key) ?? []) : [];
        if (!series.length || v.at > series[series.length - 1].t)
          observed.set(key, [...series.slice(-119), { t: v.at, v: v.price }]);
      }
      quotes.set(key, v);
      setFresh(v);
      setError("");
    };
    const poll = async () => {
      clearTimeout(pollTimer);
      if (fetching) return;
      fetching = true;
      try {
        if (document.hidden || (perp && Date.now() - lastStream < 8000)) return;
        const response = await fetch(
          "/api/preview/live-market?venue=" +
            (perp ? "hyperliquid" : stock ? "robinhood" : "solana") +
            "&symbol=" +
            encodeURIComponent(symbol),
          { signal: ctl.signal, cache: "no-store" },
        );
        if (!response.ok)
          throw Error("The venue did not return a fresh observation.");
        const v = (await response.json()) as Price;
        if (v.symbol !== symbol || !v.source || !Number.isFinite(v.at))
          throw Error("The quote could not be verified.");
        accept(v);
      } catch (e) {
        if (alive && Date.now() - lastStream >= 8000)
          setError(e instanceof Error ? e.message : "Market data unavailable.");
      } finally {
        fetching = false;
        if (alive)
          pollTimer = setTimeout(
            () => void poll(),
            document.hidden ? 45000 : perp ? 5000 : 10000,
          );
      }
    };
    const connect = () => {
      if (!perp || !alive || document.hidden || socket) return;
      try {
        const ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
        socket = ws;
        ws.onopen = () => {
          if (alive) {
            retries = 0;
            ws.send(
              JSON.stringify({
                method: "subscribe",
                subscription: { type: "l2Book", coin: symbol },
              }),
            );
          }
        };
        ws.onmessage = (event) => {
          if (
            !alive ||
            document.hidden ||
            typeof event.data !== "string" ||
            Date.now() - lastStream < 750
          )
            return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.channel !== "l2Book") return;
            const book = hyperliquidBook(msg.data, symbol);
            if (book) {
              lastStream = Date.now();
              accept(book);
            }
          } catch {
            /* Ignore malformed public frames. */
          }
        };
        ws.onerror = () => ws.close();
        ws.onclose = () => {
          if (socket === ws) socket = null;
          if (alive && !document.hidden)
            reconnect = setTimeout(
              connect,
              Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)),
            );
        };
      } catch {
        if (alive) reconnect = setTimeout(connect, 10000);
      }
    };
    const visibility = () => {
      clearTimeout(reconnect);
      if (document.hidden) {
        const old = socket;
        socket = null;
        old?.close();
      } else {
        connect();
        void poll();
      }
    };
    connect();
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      ctl.abort();
      clearTimeout(pollTimer);
      clearTimeout(reconnect);
      document.removeEventListener("visibilitychange", visibility);
      socket?.close();
    };
  }, [active, key, net, symbol, serial, perp, stock]);
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
          <label className="sr-only" htmlFor={"watch-pair-" + net}>
            Market watch symbol
          </label>
          <select
            id={"watch-pair-" + net}
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
            {record?.price != null ? (
              <QuoteNumber value={record.price} />
            ) : error ? (
              "Unavailable"
            ) : record ? (
              "Registry verified"
            ) : (
              "…"
            )}
          </div>
          <div className="live-source">
            {error && record ? "Last observation · " : ""}
            {record?.source ??
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
      <DeskHistory
        key={historyId}
        id={historyId}
        active={active}
        observed={observed.get(key) ?? []}
        source={record?.source}
      />
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
