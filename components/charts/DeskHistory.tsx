"use client";
import { useEffect, useState } from "react";
import { publicChartHistory } from "@/lib/api/chart-history";
import type { MarketHistoryRes } from "@/lib/contracts/market";
import HistoryChart, { chartBars, hasCandles } from "./HistoryChart";

const ranges = [
  { label: "1D", tf: "15m", range: "1d", step: 900000 },
  { label: "1W", tf: "1h", range: "7d", step: 3600000 },
  { label: "1M", tf: "4h", range: "30d", step: 14400000 },
] as const;
export default function DeskHistory({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [selection, setSelection] = useState(0),
    [records, setRecords] = useState<Record<string, MarketHistoryRes>>({}),
    [error, setError] = useState("");
  const sel = ranges[selection],
    key = id + "|" + sel.range,
    hist = records[key];
  useEffect(() => {
    if (!active) return;
    let here = true;
    function load() {
      if (!here || document.hidden) return;
      publicChartHistory(id, sel.tf, sel.range)
        .then((h) => {
          if (here) {
            setRecords((old) => ({ ...old, [key]: h }));
            setError("");
          }
        })
        .catch(() => {
          if (here) setError(key);
        });
    }
    load();
    const timer = setInterval(load, 60000);
    return () => {
      here = false;
      clearInterval(timer);
    };
  }, [active, id, key, sel]);
  return (
    <section className="q-desk-history" aria-label="Market price history">
      <div className="q-plot-toolbar">
        <span>Price history</span>
        <div className="q-chart-switch" aria-label="Price history range">
          {ranges.map((r, i) => (
            <button
              type="button"
              key={r.label}
              aria-pressed={selection === i}
              onClick={() => setSelection(i)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {hist?.bars.length ? (
        <HistoryChart
          key={key}
          points={chartBars(hist)}
          title="Closing price"
          source={hist.coverage[0]?.source}
          short
          step={sel.step}
          candles={hasCandles(hist)}
        />
      ) : (
        <div className="q-chart-empty" role="status">
          {error === key
            ? "Price history is temporarily unavailable."
            : hist
              ? "No recorded candles in this period."
              : "Loading historical prices…"}
        </div>
      )}
    </section>
  );
}
