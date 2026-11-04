"use client";
import { useEffect } from "react";
import { API_MODE } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import {
  connected,
  NETWORK_DETAILS,
  amountLabel,
  type LiveNetwork,
} from "@/lib/live-client";
import Link from "@/components/Link";
type Row = {
  run: string;
  name: string;
  stage: string;
  side: string;
  symbol: string;
  network: LiveNetwork;
  status: string;
  quantity: string;
  proof: string | null;
  when: number;
  sequence: number;
};
type Overview = {
  pending: Row[];
  history: Row[];
  positions: {
    run: string;
    name: string;
    symbol: string;
    network: LiveNetwork;
    qty: string;
    asset: string;
    decimals: number | null;
    average: number;
  }[];
};
function View({ part }: { part: "approvals" | "portfolio" | "activity" }) {
  const q = useQ(() => connected<Overview>("/overview"));
  useEffect(() => {
    const t = setInterval(() => q.reload(), 18000);
    return () => clearInterval(t);
  }, []);
  const x = q.data;
  if (!x) return null;
  const rows = part === "approvals" ? x.pending : x.history;
  return (
    <section className="q-card my-5 border border-line bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">
          {part === "portfolio"
            ? "Live positions"
            : part === "approvals"
              ? "Real-money order reviews"
              : "My live trading activity"}
        </h2>
        <Link className="text-[12px] text-accent" href="/app/live">
          Live desk ↗
        </Link>
      </div>
      {part === "portfolio" ? (
        x.positions.length ? (
          <ul className="mt-3 divide-y divide-line">
            {x.positions.slice(0, 20).map((p, i) => (
              <li
                key={p.run + p.asset + i}
                className="flex flex-wrap justify-between gap-2 py-2 text-sm"
              >
                <span>
                  {p.symbol} · {NETWORK_DETAILS[p.network].label}
                  <small className="ml-2 text-muted">
                    {p.decimals === null
                      ? p.qty + " base units"
                      : amountLabel(p.qty, p.decimals) + " units"}{" "}
                    · entry {"$" + p.average.toLocaleString()}
                  </small>
                </span>
                <Link href={"/app/live?run=" + p.run} className="text-accent">
                  View position ↗
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Open quantities appear after a venue reports a fill.
          </p>
        )
      ) : rows.length ? (
        <ul className="mt-3 divide-y divide-line">
          {rows.slice(0, 24).map((o) => (
            <li
              key={o.run + o.stage + o.sequence + o.side}
              className="flex flex-wrap justify-between items-center gap-2 py-2 text-sm"
            >
              <span>
                {o.side.toUpperCase()} {o.symbol} ·{" "}
                {NETWORK_DETAILS[o.network].label}
                <small className="ml-2 text-muted">
                  {o.status.replaceAll("_", " ")}
                </small>
              </span>
              <Link href={"/app/live?run=" + o.run} className="text-accent">
                {part === "approvals" ? "Review order" : "Open receipt"} ↗
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {part === "approvals"
            ? "No live orders are waiting for your signature."
            : "Your live trading activity will appear here."}
        </p>
      )}
    </section>
  );
}
export default function AccountActivity(p: {
  part: "approvals" | "portfolio" | "activity";
}) {
  return API_MODE === "live" ? <View {...p} /> : null;
}
