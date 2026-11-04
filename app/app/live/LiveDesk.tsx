"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ListOrdered, Wallet } from "lucide-react";
import Wrap from "@/components/Wrap";
import Link from "@/components/Link";
import LiveAccessPanel from "@/components/live/LiveAccessPanel";
import QuickTicket from "@/components/live/QuickTicket";
import LiveMarket from "@/components/live/LiveMarket";
import { api } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import { NETWORKS, NETWORK_DETAILS, type LiveNetwork } from "@/lib/live-client";
import { liveReviewPath, liveRunPath } from "@/lib/live-navigation";
import { useLiveAccount } from "@/lib/use-live-account";

export default function LiveDesk() {
  const router = useRouter();
  const { account, production } = useLiveAccount();
  const strategies = useQ(() => api.strategies(), [production]);
  const [net, setNet] = useState<LiveNetwork>("hyperliquid-mainnet");
  const [openTicket, setOpenTicket] = useState(false);
  const runs = account.data?.runs ?? [];
  return (
    <Wrap>
      <div className="live-desk">
        <header className="live-header">
          <div>
            <div className="live-eyebrow">
              <Wallet size={14} />
              Trading account
            </div>
            <h1>Live trading</h1>
            <p>
              Manage your funding wallets, trading permissions and live runs.
            </p>
          </div>
          <Link className="q-action" href="/app/run">
            Paper trades <ArrowUpRight size={14} />
          </Link>
        </header>
        <div className="live-grid mt-5">
          <LiveAccessPanel account={account.data} onChange={account.reload} />
          <div className="live-right">
            <section className="live-box live-runs">
              <div className="live-card-top">
                <h2>Live runs</h2>
                <ListOrdered size={17} />
              </div>
              {runs.length ? (
                <ul className="live-home-list">
                  {runs.map((run) => (
                    <li key={run.id}>
                      <Link href={liveRunPath(run.id)}>
                        <div>
                          <strong>{run.name}</strong>
                          <small>
                            {run.fills} fills · {run.status}
                          </small>
                        </div>
                        <ArrowUpRight size={15} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="live-note">
                  Your authorized runs and their venue receipts appear here.
                </p>
              )}
              {account.error && !account.auth && (
                <p className="live-error" role="alert">
                  {account.error}
                </p>
              )}
            </section>
            <section className="live-box live-runs">
              <h2>Start from a strategy</h2>
              <p className="live-note">
                Choose a saved draft, or open a paper session to go live with
                its tested rules.
              </p>
              {strategies.data?.items.length ? (
                <ul className="live-home-list">
                  {strategies.data.items.map((s) => (
                    <li key={s.id}>
                      <Link href={liveReviewPath(s.id, s.version)}>
                        <strong>{s.name}</strong>
                        <ArrowUpRight size={15} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Link className="q-action mt-3" href="/app/new">
                  Build a strategy
                </Link>
              )}
              <Link className="live-inline mt-3" href="/app/run">
                Open paper sessions <ArrowUpRight size={14} />
              </Link>
            </section>
          </div>
        </div>
        <details
          className="live-box mt-4"
          onToggle={(e) => setOpenTicket(e.currentTarget.open)}
        >
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
            Market watch & trade ticket
          </summary>
          {openTicket && (
            <div className="live-build">
              <label className="live-field">
                Trading venue
                <select
                  value={net}
                  onChange={(e) => setNet(e.target.value as LiveNetwork)}
                >
                  {NETWORKS.map((n) => (
                    <option key={n} value={n}>
                      {NETWORK_DETAILS[n].label}
                    </option>
                  ))}
                </select>
              </label>
              <LiveMarket key={net} net={net} />
              <QuickTicket
                key={"ticket-" + net}
                net={net}
                onSaved={(id) => router.push(liveReviewPath(id))}
              />
            </div>
          )}
        </details>
        <footer className="live-foot">
          <span>Account limits apply across live runs.</span>
          <Link href="/app/execution">Testnet tools ↗</Link>
        </footer>
      </div>
    </Wrap>
  );
}
