"use client";
import { useState } from "react";
import HistoryChart from "./charts/HistoryChart";
export default function EquityChart({
  points,
  synthetic,
}: {
  points: { ts: string; equityUsd: string | number }[];
  synthetic?: boolean;
}) {
  const [days, setDays] = useState(0);
  const all = points
    .map((p) => ({ t: Date.parse(p.ts), v: Number(p.equityUsd) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (!all.length)
    return (
      <div className="q-equity-empty">
        Your equity chart appears after the first paper update.
      </div>
    );
  const last = Math.max(...all.map((p) => p.t)),
    data = days ? all.filter((p) => p.t >= last - days * 86400000) : all;
  return (
    <div className="q-equity">
      <div className="q-plot-toolbar">
        <span>Account history</span>
        <div
          className="q-chart-switch"
          role="group"
          aria-label="Chart time range"
        >
          {[1, 7, 30, 0].map((n) => (
            <button
              type="button"
              key={n}
              aria-pressed={days === n}
              onClick={() => setDays(n)}
            >
              {n ? n + "D" : "All"}
            </button>
          ))}
        </div>
      </div>
      <HistoryChart
        key={days}
        title="Paper equity"
        source={synthetic ? "Simulated prices" : "Account observations"}
        points={data}
      />
    </div>
  );
}
