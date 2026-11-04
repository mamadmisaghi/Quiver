"use client";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  ChevronRight,
  Layers3,
  ListOrdered,
  Radio,
  Wallet,
  Waypoints,
} from "lucide-react";
import Wrap from "@/components/Wrap";
import Link from "@/components/Link";
import VenueMark from "@/components/VenueMark";
import SignInButton from "@/components/SignInButton";
import QuickTicket from "@/components/live/QuickTicket";
import LiveMarket from "@/components/live/LiveMarket";
import LiveAllocation, {
  type ResolvedReview,
} from "@/components/live/LiveAllocation";
import LiveAccessPanel from "@/components/live/LiveAccessPanel";
import LiveReceiptPanel from "@/components/live/LiveReceiptPanel";
import {
  NETWORKS,
  NETWORK_DETAILS,
  connected,
  type Account,
  type LiveNetwork,
} from "@/lib/live-client";
import { api, API_MODE } from "@/lib/api";
import { onSession } from "@/lib/api/session";
import { useQ } from "@/lib/api/useQ";
const venues = {
  "hyperliquid-mainnet": "hyperliquid",
  "solana-mainnet": "solana",
  "robinhood-mainnet": "robinhood",
} as const;
const instruments = {
  "hyperliquid-mainnet": "Perpetual futures",
  "solana-mainnet": "Spot swaps",
  "robinhood-mainnet": "Stock tokens",
};
async function reviewSaved(
  id: string,
  production: boolean,
): Promise<ResolvedReview | null> {
  if (!id) return null;
  const s = await api.strategy(id),
    w = s.strategy.workflow;
  if (!w)
    throw Error("Open the strategy in the builder to review its workflow.");
  if (production)
    return connected<ResolvedReview>("/review", {
      strategyId: id,
      version: s.version,
    });
  return {
    name: s.strategy.name,
    strategyId: id,
    version: s.version,
    budgetUsd: w.budgetUsd,
    risk: { ...s.strategy.risk, ...w.risk },
    stages: w.stages.map((stage) => {
      const a = w.assets.find((a) => a.id === stage.assetId),
        selected = a?.resolution?.candidates.find(
          (c) => c.id === a.resolution?.selectedId,
        );
      const network =
        NETWORKS.find((n) => venues[n] === (selected?.venue ?? a?.venue)) ??
        null;
      return {
        id: stage.id,
        symbol: selected?.symbol ?? a?.query ?? stage.assetId,
        network,
        address: selected?.address ?? null,
        assetId: selected?.id ?? null,
        side: stage.side,
        amount: stage.amount,
        leverage: stage.leverage,
        when: stage.conditionText,
        after: stage.after,
        repeat: stage.repeat,
        exits: stage.exits,
      };
    }),
  };
}
export default function LiveDesk() {
  const production = API_MODE === "live",
    account = useQ(
      () =>
        production ? connected<Account>("/account") : Promise.resolve(null),
      [production],
    );
  const strategies = useQ(() => api.strategies(), [production]);
  const [net, setNet] = useState<LiveNetwork>("hyperliquid-mainnet"),
    [panel, setPanel] = useState<"ticket" | "strategy">("ticket"),
    [id, setId] = useState(""),
    [run, setRun] = useState("");
  const [apiEnabled, setApiEnabled] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search),
      s = q.get("strategy"),
      r = q.get("run");
    if (s) {
      setPanel("strategy");
      setId(s);
    }
    if (r && /^live_[a-f0-9]{28}$/.test(r)) setRun(r);
  }, []);
  useEffect(() => {
    if (!production) return;
    const c = new AbortController();
    void fetch("/v1/live/status", { cache: "no-store", signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (!c.signal.aborted)
          setApiEnabled((v as { enabled?: boolean } | null)?.enabled === true);
      })
      .catch(() => {});
    return () => c.abort();
  }, [production]);
  useEffect(
    () =>
      onSession(() => {
        setRun("");
      }),
    [],
  );
  useEffect(() => {
    if (!production || !account.data) return;
    const t = setInterval(() => account.reload(), 20000);
    return () => clearInterval(t);
  }, [production, !!account.data]);
  const review = useQ(() => reviewSaved(id, production), [id, production]);
  const select = (sid: string) => {
    setId(sid);
    setPanel("strategy");
    const url = new URL(window.location.href);
    url.searchParams.set("strategy", sid);
    window.history.replaceState(null, "", url);
  };
  const started = (rid: string) => {
    setRun(rid);
    account.reload();
    const url = new URL(window.location.href);
    url.searchParams.set("run", rid);
    window.history.replaceState(null, "", url);
    requestAnimationFrame(() =>
      document
        .getElementById("live-receipts")
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  };
  const state =
    production && apiEnabled ? "Account service online" : "Market access";
  return (
    <Wrap>
      <div className="live-desk">
        <header className="live-header">
          <div>
            <div className="live-eyebrow">
              <Radio size={14} /> Execution desk
            </div>
            <h1>Live trading</h1>
            <p>
              Route a trade from a strategy and follow it through to its venue
              receipt.
            </p>
          </div>
          <span className="live-environment">
            <i />
            {state}
          </span>
        </header>
        <nav className="live-venues" aria-label="Trading venue">
          {NETWORKS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={net === n}
              onClick={() => setNet(n)}
            >
              <VenueMark venue={venues[n]} />
              <span>
                <strong>{NETWORK_DETAILS[n].label}</strong>
                <small>{instruments[n]}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </nav>
        <div className="live-grid">
          <section
            className="live-box live-left"
            aria-label="Market and trade setup"
          >
            <LiveMarket key={net} net={net} />
            <div className="live-build">
              <div className="live-bar">
                <div className="live-tabs" aria-label="Order source">
                  <button
                    aria-pressed={panel === "ticket"}
                    onClick={() => setPanel("ticket")}
                  >
                    Trade ticket
                  </button>
                  <button
                    aria-pressed={panel === "strategy"}
                    onClick={() => setPanel("strategy")}
                  >
                    Saved strategy
                  </button>
                </div>
              </div>
              {panel === "ticket" ? (
                <QuickTicket
                  key={net}
                  net={net}
                  onSaved={(sid) => {
                    select(sid);
                    strategies.reload();
                  }}
                />
              ) : (
                <div className="live-select-strategy">
                  <label>
                    Strategy
                    <select value={id} onChange={(e) => select(e.target.value)}>
                      <option value="">Choose a saved strategy</option>
                      {(strategies.data?.items ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {id && review.data?.strategyId === id ? (
                    <LiveAllocation
                      key={id + ":" + review.data.version}
                      review={review.data}
                      account={account.data}
                      connectedApi={production && apiEnabled}
                      onStart={started}
                    />
                  ) : id ? (
                    <p className="live-note" role="status">
                      {review.error ?? "Reading your saved strategy…"}
                    </p>
                  ) : (
                    <p className="live-note">
                      Select a saved workflow to see each market, its entry
                      conditions and the funding it needs.{" "}
                      <Link href="/app/new">Build a strategy ↗</Link>
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
          <aside className="live-right">
            <section className="live-box live-routing">
              <div className="live-card-top">
                <span className="live-icon">
                  <Waypoints size={18} />
                </span>
                <span className="live-kicker">Order routing</span>
              </div>
              <h2>{NETWORK_DETAILS[net].label}</h2>
              <p>
                {net === "hyperliquid-mainnet"
                  ? "Use isolated margin for long and short positions. Review the exact order or grant an expiring trading agent."
                  : net === "solana-mainnet"
                    ? "Swap tokens from your own wallet. Review a Jupiter route or authorize a limited Raydium allowance for supported pairs."
                    : "Buy and sell issuer-verified stock tokens with USDG on Robinhood Chain. Review the router allowance and the swap separately."}
              </p>
              <dl className="live-pairs">
                {[
                  [
                    "Network",
                    net === "robinhood-mainnet"
                      ? "Robinhood · 4663"
                      : net === "solana-mainnet"
                        ? "Solana mainnet"
                        : "Hyperliquid mainnet",
                  ],
                  ["Settlement", NETWORK_DETAILS[net].unit],
                  [
                    "Fees",
                    net === "hyperliquid-mainnet"
                      ? "Exchange fees"
                      : "Venue fees + network gas",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <a
                className="live-inline"
                target="_blank"
                rel="noopener noreferrer"
                href={NETWORK_DETAILS[net].fund}
              >
                Official funding guide <ArrowUpRight size={13} />
              </a>
            </section>
            <section className="live-box live-account-summary">
              <div className="live-card-top">
                <Wallet size={16} />
                <h2>Trading account</h2>
              </div>
              {production && account.data ? (
                <>
                  <p>
                    {account.data.paused
                      ? "The account is paused."
                      : account.data.consent
                        ? "Your live trading limits are in effect."
                        : "Choose account limits before the first live run."}
                  </p>
                  <a className="live-inline" href="#live-permissions">
                    Wallet permissions <ChevronRight size={14} />
                  </a>
                </>
              ) : production ? (
                <>
                  <p>
                    Sign in to link your funding wallets and authorize real
                    orders.
                  </p>
                  <SignInButton onDone={account.reload} />
                </>
              ) : (
                <>
                  <p>
                    You can review markets and build tickets here. Real orders
                    use the connected production account.
                  </p>
                  <Link className="live-inline" href="/app/run">
                    Open paper trading <ArrowUpRight size={13} />
                  </Link>
                </>
              )}
            </section>
          </aside>
        </div>
        {production && account.data && (
          <section id="live-permissions" className="live-detail">
            <LiveAccessPanel
              account={account.data}
              network={net}
              onChange={account.reload}
            />
          </section>
        )}
        <section className="live-box live-runs" aria-label="Live run history">
          <div className="live-card-top">
            <div className="flex items-center gap-2">
              <ListOrdered size={17} />
              <h2>Live runs</h2>
            </div>
            <span className="live-kicker">Venue receipts</span>
          </div>
          {account.data?.runs.length ? (
            <div className="live-run-list">
              {account.data.runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => started(r.id)}
                  aria-pressed={run === r.id}
                >
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      v{r.version} · {new Date(r.createdAt).toLocaleString()}
                    </small>
                  </span>
                  <span>
                    {r.fills} fills · {r.status} <ChevronRight size={14} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="live-run-empty">
              <Layers3 size={18} />
              <span>
                Live runs appear here after a wallet authorizes a strategy.
              </span>
            </div>
          )}
          {production && account.error && !account.auth && (
            <p className="live-error" role="alert">
              {account.error}
            </p>
          )}
        </section>
        {run && production && account.data && (
          <section id="live-receipts" className="live-detail">
            <LiveReceiptPanel
              runId={run}
              account={account.data}
              onChange={account.reload}
            />
          </section>
        )}
        <footer className="live-foot">
          <Activity size={13} />
          <span>
            Polymarket outcomes can trigger strategy rules. Settlement comes
            from the trading venue.
          </span>
          <Link href="/app/execution">Testnet tools ↗</Link>
        </footer>
      </div>
    </Wrap>
  );
}
