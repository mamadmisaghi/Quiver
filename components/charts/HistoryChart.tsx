"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { chartPrice } from "@/lib/chart-format";
import type { MarketHistoryRes } from "@/lib/contracts/market";
export type ChartPoint = {
  t: number;
  v: number;
  o?: number;
  h?: number;
  l?: number;
};
const date = (n: number, short = false) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(short
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : { month: "short", day: "numeric" }),
  }).format(n);
export function chartBars(history: MarketHistoryRes): ChartPoint[] {
  return history.bars.map((b) => ({
    t: Date.parse(b.t),
    v: Number(b.c),
    o: Number(b.o),
    h: Number(b.h),
    l: Number(b.l),
  }));
}
export function hasCandles(history: MarketHistoryRes) {
  return (
    !history.synthetic &&
    history.coverage.length > 0 &&
    history.coverage.every(
      (c) =>
        !c.synthetic &&
        !c.modeled &&
        (history.dataSource === "tiingo" ||
          /Hyperliquid perpetual trades|Coinbase SOL\/USD reference|Kraken (SOL|JUP)\/USD reference|GeckoTerminal/i.test(
            c.source,
          )),
    )
  );
}
export default function HistoryChart({
  points,
  title,
  source,
  unit = "usd",
  candles = false,
  short = false,
  step,
  readout = true,
}: {
  points: ChartPoint[];
  title: string;
  source?: string;
  unit?: "usd" | "percent";
  candles?: boolean;
  short?: boolean;
  step?: number;
  readout?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, ""),
    host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560),
    [mode, setMode] = useState<"line" | "candles">("line"),
    [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const obs = new ResizeObserver((entries) =>
      setWidth(Math.max(180, Math.round(entries[0].contentRect.width))),
    );
    obs.observe(host.current);
    return () => obs.disconnect();
  }, []);
  const data = useMemo(
    () =>
      points
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t),
    [points],
  );
  const first = data[0],
    last = data.at(-1);
  if (!first || !last)
    return (
      <div className="q-chart-empty">No observations for this period.</div>
    );
  const candle = candles && mode === "candles",
    h = short ? 175 : 230,
    left = 7,
    right = width - (width < 360 ? 61 : 78),
    top = 13,
    bottom = h - 24;
  let low = Infinity,
    high = -Infinity;
  for (const p of data) {
    low = Math.min(low, candle ? (p.l ?? p.v) : p.v);
    high = Math.max(high, candle ? (p.h ?? p.v) : p.v);
  }
  const pad = (high - low) * 0.13 || Math.abs(high) * 0.002 || 0.01;
  low -= pad;
  high += pad;
  const span = last.t - first.t,
    x = (t: number) =>
      span
        ? left + ((t - first.t) / span) * (right - left)
        : (left + right) / 2,
    y = (v: number) => bottom - ((v - low) / (high - low)) * (bottom - top);
  const increment = (high - low) / 3;
  const scale = 10 ** Math.floor(Math.log10(increment));
  const gridStep =
    ([1, 2, 2.5, 5, 10].find((n) => n >= increment / scale) ?? 10) * scale;
  const firstGrid = Math.ceil(low / gridStep) * gridStep;
  const yTicks = Array.from(
    { length: Math.max(1, Math.floor((high - firstGrid) / gridStep) + 1) },
    (_, i) => firstGrid + i * gridStep,
  );
  const target = span / (width < 400 ? 3 : 4);
  const timeStep =
    ([
      1, 5, 15, 30, 60, 300, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400,
      172800, 604800, 1209600, 2592000, 7776000, 31536000,
    ].find((n) => n * 1000 >= target) ?? 31536000) * 1000;
  const startTick = Math.ceil(first.t / timeStep) * timeStep;
  const xTicks = span
    ? Array.from(
        {
          length: Math.max(0, Math.floor((last.t - startTick) / timeStep) + 1),
        },
        (_, i) => startTick + i * timeStep,
      )
    : [first.t];
  const idx =
      hover === null ? data.length - 1 : Math.min(hover, data.length - 1),
    selected = data[idx],
    sx = x(selected.t),
    sy = y(selected.v);
  const chunks: string[] = [];
  let segment = "",
    begin = 0,
    prev = 0;
  const areas: string[] = [];
  for (const p of data) {
    const px = x(p.t),
      py = y(p.v);
    if (segment && step && p.t - prev > step * 1.6) {
      chunks.push(segment);
      areas.push(
        segment +
          "L" +
          x(prev) +
          "," +
          bottom +
          "L" +
          begin +
          "," +
          bottom +
          "Z",
      );
      segment = "";
    }
    if (!segment) begin = px;
    segment += (segment ? "L" : "M") + px.toFixed(1) + "," + py.toFixed(1);
    prev = p.t;
  }
  chunks.push(segment);
  areas.push(
    segment + "L" + x(last.t) + "," + bottom + "L" + begin + "," + bottom + "Z",
  );
  function selectAt(clientX: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect(),
      t =
        first.t +
        Math.max(
          0,
          Math.min(
            1,
            (((clientX - rect.left) * width) / rect.width - left) /
              (right - left),
          ),
        ) *
          span;
    let a = 0,
      b = data.length - 1;
    while (a < b) {
      const m = (a + b) >> 1;
      if (data[m].t < t) a = m + 1;
      else b = m;
    }
    setHover(a > 0 && t - data[a - 1].t < data[a].t - t ? a - 1 : a);
  }
  const delta = first.v !== 0 ? (last.v / first.v - 1) * 100 : null,
    fmt = (v: number) => chartPrice(v, unit);
  const size = Math.max(
    1,
    Math.min(10, ((right - left) / Math.max(data.length, 2)) * 0.7),
  );
  const tooltipTime =
    date(selected.t) + " · " + date(selected.t, true) + " UTC";
  return (
    <div ref={host} className="q-history-chart" data-readout={readout}>
      <div className="q-history-head">
        <div>
          <span className="q-chart-label">{title}</span>
          {readout && (
            <div className="q-chart-readout">
              <strong className="q-number">{fmt(selected.v)}</strong>
              {delta !== null && (
                <small className={delta < 0 ? "q-down" : "q-up"}>
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(2)}%
                </small>
              )}
            </div>
          )}
        </div>
        {candles && (
          <div className="q-chart-switch" aria-label="Chart style">
            {(["line", "candles"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={mode === v}
                onClick={() => setMode(v)}
              >
                {v === "line" ? "Line" : "Candles"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="q-history-legend">
        {hover !== null ? tooltipTime : (source ?? "Account history")}
        {candle && (
          <span className="q-chart-ohlc">
            {" "}
            O {fmt(selected.o ?? selected.v)} · H{" "}
            {fmt(selected.h ?? selected.v)} · L {fmt(selected.l ?? selected.v)}
          </span>
        )}
      </div>
      <div className="q-plot-surface">
        {!readout && hover !== null && (
          <div
            className="q-plot-tooltip"
            style={{
              left:
                (Math.max(90, Math.min(width - 90, sx)) / width) * 100 + "%",
            }}
          >
            <strong className="q-number">{fmt(selected.v)}</strong>
            <time>{tooltipTime}</time>
          </div>
        )}
        <svg
          viewBox={"0 0 " + width + " " + h}
          height={h}
          width="100%"
          tabIndex={0}
          role="group"
          aria-label={
            title + " chart. Use left and right arrows to inspect observations."
          }
          onPointerDown={(e) => selectAt(e.clientX, e.currentTarget)}
          onPointerMove={(e) => {
            if (e.pointerType !== "touch" || e.buttons)
              selectAt(e.clientX, e.currentTarget);
          }}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setHover(null);
              return;
            }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            setHover(
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? data.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        data.length - 1,
                        idx + (e.key === "ArrowLeft" ? -1 : 1),
                      ),
                    ),
            );
          }}
        >
          <defs>
            <linearGradient
              id={id + "fill"}
              x2="0"
              y2="1"
              gradientUnits="objectBoundingBox"
            >
              <stop offset="0%" stopColor="var(--accent)" stopOpacity=".19" />
              <stop
                offset="100%"
                stopColor="var(--accent)"
                stopOpacity=".005"
              />
            </linearGradient>
          </defs>
          {yTicks.map((v, i) => {
            const yy = y(v);
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={right}
                  y1={yy}
                  y2={yy}
                  className="q-plot-grid"
                />
                <text x={right + 8} y={yy + 4}>
                  {fmt(v)}
                </text>
              </g>
            );
          })}
          {candle ? (
            data.map((p, i) => {
              const o = p.o ?? p.v,
                px = x(p.t),
                color = p.v >= o ? "var(--q-up)" : "var(--q-down)";
              return (
                <g key={i} stroke={color}>
                  <line x1={px} x2={px} y1={y(p.h ?? p.v)} y2={y(p.l ?? p.v)} />
                  <rect
                    x={px - size / 2}
                    width={size}
                    y={Math.min(y(o), y(p.v))}
                    height={Math.max(1, Math.abs(y(o) - y(p.v)))}
                    fill={color}
                    stroke="none"
                  />
                </g>
              );
            })
          ) : (
            <>
              <path d={areas.join(" ")} fill={"url(#" + id + "fill)"} />
              <path
                d={chunks.join(" ")}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle
                cx={x(last.t)}
                cy={y(last.v)}
                r={3.5}
                fill="var(--accent)"
              />
            </>
          )}
          {xTicks.map((t) => (
            <text
              key={t}
              x={x(t)}
              y={h - 3}
              textAnchor={
                x(t) < left + 18
                  ? "start"
                  : x(t) > right - 18
                    ? "end"
                    : "middle"
              }
            >
              {span > 0 && span < 120000
                ? new Date(t).toISOString().slice(11, 19)
                : date(t, span <= dayMs * 1.3)}
            </text>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line
                className="q-plot-cursor"
                x1={sx}
                x2={sx}
                y1={top}
                y2={bottom}
              />
              <circle
                cx={sx}
                cy={sy}
                r="5"
                fill="var(--accent)"
                stroke="var(--card)"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>
      </div>
      <span className="sr-only" aria-live="polite">
        {hover !== null ? tooltipTime + " " + fmt(selected.v) : ""}
      </span>
    </div>
  );
}
const dayMs = 86400000;
