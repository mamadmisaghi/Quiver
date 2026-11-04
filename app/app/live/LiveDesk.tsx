"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ChevronRight,
  ListOrdered,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Dialog, Tabs } from "radix-ui";
import Wrap from "@/components/Wrap";
import Link from "@/components/Link";
import VenueMark from "@/components/VenueMark";
import LiveAccessPanel from "@/components/live/LiveAccessPanel";
import QuickTicket from "@/components/live/QuickTicket";
import LiveMarket from "@/components/live/LiveMarket";
import { api } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import { NETWORKS, NETWORK_DETAILS, type LiveNetwork } from "@/lib/live-client";
import { liveReviewPath, liveRunPath } from "@/lib/live-navigation";
import { useLiveAccount } from "@/lib/use-live-account";

const venues = {
  "hyperliquid-mainnet": { mark: "hyperliquid", product: "Perpetual futures" },
  "solana-mainnet": { mark: "solana", product: "Spot swaps" },
  "robinhood-mainnet": { mark: "robinhood", product: "Stock tokens" },
} as const;

function DeskDialog({
  label,
  description,
  trigger,
  children,
}: {
  label: string;
  description: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="desk-scrim" />
        <Dialog.Content className="desk-dialog">
          <header>
            <div>
              <Dialog.Title>{label}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close
              className="q-icon-action"
              aria-label={"Close " + label}
            >
              <X size={17} />
            </Dialog.Close>
          </header>
          <div className="desk-dialog-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function LiveDesk() {
  const router = useRouter();
  const { account, production } = useLiveAccount();
  const strategies = useQ(() => api.strategies(), [production]);
  const [net, setNet] = useState<LiveNetwork>("hyperliquid-mainnet");
  const runs = account.data?.runs ?? [];
  return (
    <Wrap>
      <div className="live-desk trading-desk">
        <header className="live-header">
          <div>
            <h1>Trading Desk</h1>
            <p>Choose a market and review an order from your wallet.</p>
          </div>
          <DeskDialog
            label="Trading settings"
            description="Manage your funding wallets, account limits and permissions."
            trigger={
              <button type="button" className="q-action">
                <SlidersHorizontal size={15} />
                Trading settings
              </button>
            }
          >
            <LiveAccessPanel
              account={account.data}
              network={net}
              onChange={account.reload}
            />
            {account.error && !account.auth && (
              <p role="alert" className="live-error">
                {account.error}
              </p>
            )}
          </DeskDialog>
        </header>
        <Tabs.Root value={net} onValueChange={(v) => setNet(v as LiveNetwork)}>
          <Tabs.List className="desk-venue-tabs" aria-label="Trading venue" style={{ "--venue-index": NETWORKS.indexOf(net) } as React.CSSProperties}><span className="desk-venue-slider" aria-hidden="true"/>
            {NETWORKS.map((n) => (
              <Tabs.Trigger key={n} value={n} className="desk-venue-tab">
                <VenueMark venue={venues[n].mark} />
                <span>
                  <strong>{NETWORK_DETAILS[n].label}</strong>
                  <small>{venues[n].product}</small>
                </span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {NETWORKS.map((n) => (
            <Tabs.Content key={n} value={n} forceMount className="desk-market-panel">
              <section className="desk-market">
                <LiveMarket net={n} active={net===n} />
              </section>
              <section className="desk-ticket">
                <div className="desk-ticket-head">
                  <h2>Trade ticket</h2>
                  <DeskDialog
                    label="Use saved strategy"
                    description="Choose the rules you want to review for live trading."
                    trigger={
                      <button type="button" className="desk-text-action">
                        Use saved strategy <ChevronRight size={14} />
                      </button>
                    }
                  >
                    {strategies.data?.items.length ? (
                      <ul className="desk-picker-list">
                        {strategies.data.items.map((s) => (
                          <li key={s.id}>
                            <Link href={liveReviewPath(s.id, s.version)}>
                              <span>
                                {s.name}
                                <small>Version {s.version}</small>
                              </span>
                              <ArrowUpRight size={16} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="live-note">
                        {strategies.error ||
                          (strategies.data
                            ? "Save a strategy in the builder to review it here."
                            : "Loading saved strategies…")}
                      </p>
                    )}
                    <div className="desk-picker-foot">
                      <Link className="q-action" href="/app/new">
                        Build a strategy
                      </Link>
                      <Link className="q-action" href="/app/run">
                        Open paper sessions
                      </Link>
                    </div>
                  </DeskDialog>
                </div>
                <QuickTicket
                  net={n}
                  onSaved={(id) => router.push(liveReviewPath(id))}
                />
              </section>
            </Tabs.Content>
          ))}
        </Tabs.Root>
        <section className="desk-run-history" aria-label="Live run history">
          <div className="desk-ticket-head">
            <h2>
              <ListOrdered size={16} /> Live runs
            </h2>
            <span>{runs.length}</span>
          </div>
          {runs.length ? (
            <ul className="live-home-list">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link href={liveRunPath(r.id)}>
                    <div>
                      <strong>{r.name}</strong>
                      <small>
                        {r.fills} fills · {r.status}
                      </small>
                    </div>
                    <ArrowUpRight size={15} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="live-note">
              {account.error && !account.auth
                ? account.error
                : "Your live runs appear here after you authorize a strategy."}
            </p>
          )}
        </section>
        <footer className="live-foot">
          <Link href="/app/run">Paper trades ↗</Link>
          <Link href="/app/execution">Testnet tools ↗</Link>
        </footer>
      </div>
    </Wrap>
  );
}
