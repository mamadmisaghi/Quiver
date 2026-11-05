"use client";
import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { API_MODE, type Strategy } from "@/lib/api";
import { raw } from "@/lib/api/live";
import type { WorkflowHistory } from "@/services/backend/src/workflows/history";
export default function WorkflowHistoryPanel({
  strategy,
  save,
}: {
  strategy: Strategy;
  save: () => Promise<{ id: string; version: number }>;
}) {
  const [days, setDays] = useState(7),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState<WorkflowHistory | null>(null);
  const ref = useRef<AbortController | null>(null);
  useEffect(() => {
    setReport(null);
    setError("");
    setBusy(false);
    return () => {
      ref.current?.abort();
    };
  }, [strategy, days]);
  async function replay() {
    if (!strategy.workflow || busy) return;
    const ctrl = new AbortController();
    ref.current = ctrl;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const to = Math.floor(Date.now() / 3600000) * 3600000,
        window = { from: to - days * 86400000, to, timeframe: "1h" };
      let res: Response;
      if (API_MODE === "live") {
        const saved = await save();
        res = await raw("/workflow-history", {
          method: "POST",
          signal: ctrl.signal,
          body: JSON.stringify({ ...window, strategyId: saved.id, version: saved.version }),
        });
      } else
        res = await fetch("/api/preview/workflow-history", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({ ...window, workflow: strategy.workflow, risk: strategy.risk }),
        });
      const value = (await res.json()) as WorkflowHistory & { message?: string };
      if (!res.ok) throw Error(value.message ?? "Could not load historical prices.");
      if (!ctrl.signal.aborted) setReport(value);
    } catch (e) {
      if (!ctrl.signal.aborted)
        setError(e instanceof Error ? e.message : "Historical replay is unavailable.");
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="q-card mt-6 border border-line bg-card p-5" aria-label="Historical replay">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <History size={16} aria-hidden />
            Historical replay
          </h3>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
            Replay the rules against recorded market observations. Fills and fees are simulated.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="history-window">
            History window
          </label>
          <select
            id="history-window"
            className="q-action bg-card"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[1, 7, 30].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "Last day" : "Last " + n + " days"}
              </option>
            ))}
          </select>
          <button className="q-action" type="button" disabled={busy} onClick={() => void replay()}>
            {busy ? "Loading observations…" : "Run replay"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-warn">
          {error}
        </p>
      )}
      {report && (
        <div className="mt-4 border-t border-line pt-4" aria-live="polite">
          <p className="font-medium">
            {report.result
              ? report.status === "observed"
                ? "Replay complete"
                : "Partial coverage"
              : "Insufficient history for a return"}
          </p>
          {report.result && (
            <p className="mt-2 font-mono text-sm">
              {report.result.returnPct === null
                ? "Return unavailable"
                : report.result.returnPct.toFixed(2) + "% return"}{" "}
              · {report.result.fillsTotal} simulated fills · {report.result.steps} observations evaluated
            </p>
          )}
          <ul className="mt-3 divide-y divide-line">
            {report.coverage.map((c) => (
              <li key={c.assetId} className="grid gap-1 py-2 text-[13px] sm:grid-cols-[1fr_2fr]">
                <span>{strategy.workflow?.assets.find((a) => a.id === c.assetId)?.query ?? c.assetId}</span>
                <span className="text-muted">
                  {c.observations} observations · {c.issue ?? c.source.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ul>
          {report.issues.map((m) => (
            <p key={m} className="mt-1 text-[12px] text-muted">
              {m}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
