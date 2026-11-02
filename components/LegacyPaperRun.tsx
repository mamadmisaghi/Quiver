"use client";
import { useEffect, useState } from "react";
import { previewBacktest } from "@/lib/api/preview-backtest";
import { completeLegacySession, type PaperSession } from "@/lib/paper/sessions";
import Wrap from "./Wrap";
import PageHeader from "./PageHeader";
import Link from "./Link";
import { Card } from "./ui";

export default function LegacyPaperRun({
  session,
  onSave,
}: {
  session: PaperSession;
  onSave: (s: PaperSession) => void;
}) {
  const [error, setError] = useState(""),
    [attempt, retry] = useState(0);
  const result = session.legacyResult?.result;
  useEffect(() => {
    if (session.status === "completed") return;
    let active = true;
    const to = session.createdAt,
      from = to - 7 * 86_400_000;
    previewBacktest({
      strategy: session.strategy,
      startingEquityUsd: String(session.startingBalance),
      resolution: "1h",
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      feeModel: "default",
    })
      .then((r) => {
        if (active) onSave(completeLegacySession(session.id, r));
      })
      .catch(() => {
        if (active)
          setError(
            "Could not finish this simulation. Your saved rules are available to retry.",
          );
      });
    return () => {
      active = false;
    };
  }, [session.id, session.status, attempt]);
  return (
    <Wrap>
      <PageHeader
        title={session.name}
        sub={`Paper session · version ${session.strategyVersion} · 7 days of synthetic hourly prices`}
        right={
          <Link className="q-action" href="/app/run">
            Paper trades
          </Link>
        }
      />
      <Card className="mt-6 p-6" aria-live="polite">
        {result ? (
          <>
            <h2 className="font-medium">Simulation complete</h2>
            <dl className="q-legacy-result">
              {[
                ["Starting equity", session.startingBalance],
                ["Ending equity", result.endingEquityUsd],
                ["Return", result.returnPct + "%"],
                ["Fills", result.fills.length],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {result.fills.length > 0 ? (
              <ul className="mt-6 divide-y divide-line">
                {result.fills
                  .slice(-40)
                  .reverse()
                  .map((f, i) => (
                    <li key={i} className="py-2 text-[13px]">
                      {f.side} · {f.qty} at ${f.price} ·{" "}
                      {new Date(f.ts).toLocaleString()}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-4 text-muted">
                No orders filled in this price window.
              </p>
            )}
          </>
        ) : error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="q-action mt-3"
              onClick={() => {
                setError("");
                retry((n) => n + 1);
              }}
            >
              Retry simulation
            </button>
          </>
        ) : (
          <p>Testing your saved rules against synthetic prices…</p>
        )}
      </Card>
    </Wrap>
  );
}
