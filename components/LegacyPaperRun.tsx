"use client";
import { type PaperSession } from "@/lib/paper/sessions";
import Wrap from "./Wrap";
import PageHeader from "./PageHeader";
import Link from "./Link";
import { Card } from "./ui";

export default function LegacyPaperRun({ session }: { session: PaperSession }) {
  const result = session.legacyResult?.result;
  return (
    <Wrap>
      <PageHeader
        title={session.name}
        sub={`Archived simulation · version ${session.strategyVersion} · 7 days of synthetic hourly prices`}
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
        ) : (
          <p className="text-muted">This earlier simulation has no saved results.</p>
        )}
        <Link className="q-action mt-4" href={`/app/new?strategy=${encodeURIComponent(session.strategyId)}`}>Open draft for live quotes</Link>
      </Card>
    </Wrap>
  );
}
