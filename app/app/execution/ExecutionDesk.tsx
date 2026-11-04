"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight, FlaskConical, KeyRound, Radio, Wallet } from "lucide-react";
import Wrap from "@/components/Wrap";
import Link from "@/components/Link";
import VenueMark from "@/components/VenueMark";
import { api as workspace, API_MODE } from "@/lib/api";
import { raw } from "@/lib/api/live";
import { useQ } from "@/lib/api/useQ";
import { connect, signTypedData } from "@/lib/wallet";
import type { ExecutionService } from "@/services/backend/src/execution/service";
type Desk = ReturnType<ExecutionService["view"]> & { solanaQuoteEnabled?: boolean };
type Terms = Awaited<ReturnType<ExecutionService["prepare"]>>;
type Phantom = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (m: Uint8Array, enc: string) => Promise<{ signature: Uint8Array }>;
};

const venues = [
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    what: "Perpetual futures",
    role: "Testnet orders",
    detail: "A named, expiring agent can submit a confirmed order against a linked testnet account.",
  },
  {
    id: "solana",
    name: "Solana",
    what: "Jupiter swaps",
    role: "Wallet verification",
    detail:
      "Prove wallet ownership with Phantom. Review exact-in swap quotes and simulate within your price limits.",
  },
  {
    id: "robinhood",
    name: "Robinhood Chain",
    what: "Test pool",
    role: "Test tokens",
    detail: "Prepare a bounded swap and track the receipt on the selected testnet pool.",
  },
  {
    id: "polymarket",
    name: "Polymarket",
    what: "Outcome prices",
    role: "Signal source",
    detail: "Use the price of a specific outcome as a strategy condition.",
  },
] as const;
async function api<T>(path = "", payload?: unknown): Promise<T> {
  const r = await raw(
    "/execution" + path,
    payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) },
  );
  return r.json();
}
function bs58(b: Uint8Array) {
  const a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const v of b) n = n * 256n + BigInt(v);
  let out = "";
  while (n) {
    out = a[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const v of b) {
    if (v) break;
    out = "1" + out;
  }
  return out;
}
const fmt = (a: string) => a.slice(0, 6) + "…" + a.slice(-5);
export default function ExecutionDesk() {
  const live=API_MODE==="live";
  const [strategyId, setStrategyId] = useState("");
  useEffect(() => setStrategyId(new URLSearchParams(window.location.search).get("strategy") ?? ""), []);
  const strategy = useQ(
    () => (strategyId ? workspace.strategy(strategyId) : Promise.resolve(null)),
    [strategyId],
  );
  const plan = strategy.data?.strategy.workflow;
  const readiness = useQ(
    () =>
      live && strategyId
        ? api<{ version: number; issues: string[] }>(
            "/workflows/" + encodeURIComponent(strategyId) + "/readiness",
          )
        : Promise.resolve(null),
    [strategyId],
  );
  const [automatic, setAutomatic] = useState(false);
  const q = useQ(() => (live ? api<Desk>() : Promise.resolve(null)));
  const [venue, setVenue] = useState<(typeof venues)[number]["id"]>("hyperliquid"),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState(""),
    [error, setError] = useState("");
  const [balance, setBalance] = useState(""),
    [terms, setTerms] = useState<Terms | null>(null),
    [symbol, setSymbol] = useState("BTC"),
    [side, setSide] = useState("long"),
    [margin, setMargin] = useState("20"),
    [lev, setLev] = useState("1");
  const [sol, setSol] = useState({ inputMint: "", outputMint: "", inputAmount: "", minOutput: "" }),
    [quote, setQuote] = useState<{ id: string; minimumOutput: string; expiresAt: number } | null>(null);
  const data = q.data,
    selected = venues.find((v) => v.id === venue)!;
  const hasActive = !!data?.programs?.some((p) => p.status === "running");
  useEffect(() => {
    if (!hasActive) return;
    const t = window.setInterval(() => q.reload(), 7000);
    return () => window.clearInterval(t);
  }, [hasActive]); // reload reads the account without submitting orders.
  useEffect(() => {
    setMsg("");
    setError("");
    setBalance("");
    setTerms(null);
    setQuote(null);
  }, [venue, data?.agent?.agent]);
  async function action(fn: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      setMsg(await fn());
      q.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request could not be verified.");
    } finally {
      setBusy(false);
    }
  }
  const btn = "q-action",
    input =
      "mt-1 block w-full rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm text-ink";
  return (
    <Wrap>
      <Link className="q-action mb-4 inline-flex" href="/app/live">Open live trading ↗</Link>
      <header className="border-b border-line pb-7">
        <div className="mb-3 flex items-center gap-2 text-xs text-accent">
          <Radio size={14} aria-hidden />
          Execution
        </div>
        <h1 className="text-4xl font-medium tracking-tight">Execution setup</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Connect a venue, review its permissions and follow the evidence behind each fill.
        </p>
      </header>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-5 py-4">
        <div className="flex items-start gap-3">
          <FlaskConical size={19} className="mt-0.5 text-accent" />
          <div>
            <div className="text-sm font-medium">{live ? "Connected API" : "Paper workspace"}</div>
            <div className="mt-1 text-[13px] text-muted">
              {live
                ? "Wallet actions are scoped to the selected venue and network."
                : "Paper sessions use virtual balances. Wallet execution opens on the connected server."}
            </div>
          </div>
        </div>
        <Link className="q-action" href="/app/run">
          Paper sessions <ArrowUpRight size={14} />
        </Link>
      </div>
      {strategyId && (
        <section className="q-card mt-5 border border-line bg-card p-5">
          {plan ? (
            <>
              <p className="text-xs text-muted">Strategy execution requirements</p>
              <h2 className="mt-1 text-xl font-medium">{strategy.data?.strategy.name}</h2>
              <ul className="mt-4 divide-y divide-line">
                {plan.stages.map((stage) => {
                  const asset = plan.assets.find((a) => a.id === stage.assetId),
                    v = asset?.resolution?.candidates.find((c) => c.id === asset.resolution?.selectedId),
                    labels = stage.after.map((d) => {
                      const pre = plan.stages.find((x) => x.id === d.stageId);
                      return (
                        (plan.assets.find((x) => x.id === pre?.assetId)?.query ?? d.stageId) +
                        " " +
                        d.event.replaceAll("_", " ")
                      );
                    });
                  return (
                    <li
                      key={stage.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm"
                    >
                      <span>
                        {stage.side.toUpperCase()} {v?.symbol ?? asset?.query}{" "}
                        {stage.leverage > 1 ? " · " + stage.leverage + "×" : ""}
                        <small className="mt-1 block text-muted">
                          {labels.length
                            ? "After " + labels.join(" and ")
                            : stage.conditionText || "On start"}
                        </small>
                      </span>
                      <span className="text-right text-[13px] text-ink-2">
                        {stage.amount.value === null
                          ? "Size required"
                          : (stage.amount.unit === "usd" ? "$" : "") +
                            stage.amount.value +
                            (stage.amount.unit === "usd" ? "" : " " + stage.amount.unit.replaceAll("_", " "))}
                        <small className="block text-muted">{v?.venue ?? "Market selection required"}</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted">
                These are the strategy’s requirements. Paper fills do not authorize a venue order.
              </p>
              {readiness.data?.issues.length ? (
                <ul className="mt-3 text-xs text-muted">
                  {readiness.data.issues.map((m) => (
                    <li key={m} className="py-1">
                      {m}
                    </li>
                  ))}
                </ul>
              ) : (
                readiness.data &&
                data?.testnetEnabled &&
                data.agent?.state === "active" && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <label className="text-sm">
                      <input
                        type="checkbox"
                        checked={automatic}
                        onChange={(e) => setAutomatic(e.target.checked)}
                      />{" "}
                      Authorize automatic testnet entries
                    </label>
                    <button
                      className={btn}
                      disabled={busy || data.paused}
                      onClick={() =>
                        void action(async () => {
                          await api("/workflows", {
                            strategyId,
                            version: readiness.data!.version,
                            mode: automatic ? "auto" : "confirm_each",
                            network: "hyperliquid-testnet",
                            allowTestnetOrders: true,
                          });
                          return "Testnet workflow started.";
                        })
                      }
                    >
                      {automatic ? "Start automatic testnet orders" : "Start reviewed testnet entries"}
                    </button>
                  </div>
                )
              )}
            </>
          ) : (
            <p className="text-sm text-muted">{strategy.error ?? "Reading saved strategy…"}</p>
          )}
        </section>
      )}
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(220px,0.85fr)_minmax(0,1.65fr)]">
        <section
          aria-label="Execution venues"
          className="q-card h-fit overflow-hidden border border-line bg-card"
        >
          <h2 className="border-b border-line px-5 py-4 text-sm font-medium">Venues</h2>
          {venues.map((v) => (
            <button
              type="button"
              key={v.id}
              aria-pressed={v.id === venue}
              onClick={() => setVenue(v.id)}
              className={
                "flex w-full items-center gap-3 border-b border-line px-5 py-4 text-left last:border-0 hover:bg-white/5 " +
                (v.id === venue ? "bg-white/5" : "")
              }
            >
              <VenueMark venue={v.id} />
              <span className="grow">
                <span className="block text-sm font-medium">{v.name}</span>
                <span className="mt-1 block text-xs text-muted">{v.what}</span>
              </span>
              <ChevronRight size={15} className={v.id === venue ? "text-accent" : "text-muted"} />
            </button>
          ))}
        </section>
        <section
          className="q-card min-w-0 self-start border border-line bg-card p-5 sm:p-7"
          aria-label={selected.name + " setup"}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[23px] font-medium tracking-tight">{selected.name}</h2>
            <span className="rounded-full border border-line px-3 py-1 text-xs text-ink-2">
              {selected.role}
            </span>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">{selected.detail}</p>
          {venue === "hyperliquid" && (
            <>
              <dl className="my-5 divide-y divide-line border-y border-line text-sm">
                {[
                  ["Network", "Hyperliquid testnet"],
                  ["Order review", "Explicit confirmation"],
                  ["Permission", data?.agent?.state ?? "No active signer"],
                  [
                    "Agent expiry",
                    data?.agent ? new Date(data.agent.validUntil).toLocaleString() : "After 24 hours",
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-wrap justify-between gap-2 py-3">
                    <dt className="text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {data?.testnetEnabled ? (
                <>
                  {data.agent?.state !== "active" ? (
                    <button
                      className={btn}
                      disabled={busy || !data.ethereumWallets.length}
                      onClick={() =>
                        void action(async () => {
                          const master = await connect();
                          if (!data.ethereumWallets.some((x) => x.toLowerCase() === master.toLowerCase()))
                            throw Error("Link this EVM wallet in Wallets first.");
                          const g = await api<{ typedData: unknown }>("/hyperliquid/grant", { master });
                          const signature = await signTypedData(master, g.typedData);
                          await api("/hyperliquid/activate", { signature });
                          return "The exchange verified the testnet grant.";
                        })
                      }
                    >
                      <KeyRound size={15} />
                      Authorize agent
                    </button>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={btn}
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              const b = await api<{ withdrawable: string }>("/hyperliquid/balance");
                              setBalance(b.withdrawable + " test USDC available");
                              return "";
                            })
                          }
                        >
                          Check collateral
                        </button>
                        <button
                          className={btn}
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await api("/hyperliquid/disable", {});
                              return "Quiver disabled its signer. Manage the exchange grant in Hyperliquid.";
                            })
                          }
                        >
                          Disable signer
                        </button>
                      </div>
                      {balance && <p className="mt-2 font-mono text-sm">{balance}</p>}
                      <form
                        className="mt-5 grid grid-cols-2 gap-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void action(async () => {
                            setTerms(
                              await api<Terms>("/hyperliquid/orders", {
                                symbol,
                                side,
                                marginUsd: Number(margin),
                                leverage: Number(lev),
                                slippageBps: 50,
                              }),
                            );
                            return "Review the exact size and limit before confirming.";
                          });
                        }}
                      >
                        <label className="text-xs text-muted">
                          Market
                          <input
                            required
                            className={input}
                            value={symbol}
                            onChange={(e) => {
                              setSymbol(e.target.value);
                              setTerms(null);
                            }}
                          />
                        </label>
                        <label className="text-xs text-muted">
                          Direction
                          <select
                            className={input}
                            value={side}
                            onChange={(e) => {
                              setSide(e.target.value);
                              setTerms(null);
                            }}
                          >
                            <option value="long">Long</option>
                            <option value="short">Short</option>
                          </select>
                        </label>
                        <label className="text-xs text-muted">
                          Isolated margin · test USD
                          <input
                            required
                            type="number"
                            min="12"
                            max="200"
                            className={input}
                            value={margin}
                            onChange={(e) => {
                              setMargin(e.target.value);
                              setTerms(null);
                            }}
                          />
                        </label>
                        <label className="text-xs text-muted">
                          Leverage
                          <input
                            required
                            type="number"
                            min="1"
                            max="30"
                            className={input}
                            value={lev}
                            onChange={(e) => {
                              setLev(e.target.value);
                              setTerms(null);
                            }}
                          />
                        </label>
                        <button type="submit" className={btn + " col-span-2"} disabled={busy}>
                          Review testnet order
                        </button>
                      </form>
                      {terms && (
                        <div className="mt-3 border-l-2 border-accent pl-4">
                          <p className="text-sm">
                            {terms.side} {terms.quantity} {terms.symbol} · isolated {terms.leverage}× · limit{" "}
                            {terms.limit} · expires {new Date(terms.expiresAt).toLocaleTimeString()}
                          </p>
                          <button
                            className={btn + " mt-2"}
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await api("/hyperliquid/orders/" + terms.id + "/confirm", {
                                  digest: terms.digest,
                                });
                                setTerms(null);
                                return "Order recorded. Receipt status appears below.";
                              })
                            }
                          >
                            Confirm testnet order
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {data.agent && data.agent.state !== "active" && data.agent.state !== "disabled" && (
                    <button
                      className={btn}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api("/hyperliquid/disable", {});
                          return "Local signer disabled.";
                        })
                      }
                    >
                      Discard grant
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">
                  {live
                    ? "Testnet orders open once signing and durable storage are configured."
                    : "The paper workspace can read prices. A linked owner wallet and testnet collateral are required to place a test order."}
                </p>
              )}
              {(data?.programs ?? []).map((p) => (
                <div key={p.id} className="mt-4 border-t border-line pt-3 text-sm">
                  <strong>
                    {p.name} · {p.status}
                  </strong>
                  <p className="my-2 text-muted">{p.detail}</p>
                  {p.status === "running" && (
                    <button
                      className={btn}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api("/workflows/" + p.id + "/stop", {});
                          return "Workflow stopped.";
                        })
                      }
                    >
                      Stop workflow
                    </button>
                  )}
                </div>
              ))}
              {(data?.orders ?? []).map((o) => (
                <div key={o.terms.id} className="mt-4 border-t border-line pt-3 text-sm">
                  <p>
                    {o.terms.symbol} · {o.terms.side} · {o.status.replaceAll("_", " ")} · {o.receiptCount}{" "}
                    fill receipts
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {o.status === "planned" && o.terms.expiresAt > Date.now() && (
                      <button
                        className={btn}
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await api("/hyperliquid/orders/" + o.terms.id + "/confirm", {
                              digest: o.terms.digest,
                            });
                            return "Order submitted for reconciliation.";
                          })
                        }
                      >
                        Confirm {o.terms.quantity} at limit {o.terms.limit} · {o.terms.leverage}×
                      </button>
                    )}
                    {["reconcile", "cancel"]
                      .filter(
                        (a) =>
                          a === "reconcile" ||
                          !["filled", "cancelled", "rejected", "revoked"].includes(o.status),
                      )
                      .map((a) => (
                        <button
                          key={a}
                          className={btn}
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await api("/hyperliquid/orders/" + o.terms.id + "/" + a, {});
                              return "Order status refreshed.";
                            })
                          }
                        >
                          {a === "reconcile" ? "Check receipt" : "Cancel"}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </>
          )}
          {venue === "solana" && (
            <div className="mt-5 border-t border-line pt-4">
              {data ? (
                <>
                  <button
                    className={btn}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const ph = (window as unknown as { phantom?: { solana?: Phantom } }).phantom?.solana;
                        if (!ph) throw Error("Open Phantom in this browser to link a wallet.");
                        const address = (await ph.connect()).publicKey.toString();
                        const ch = await api<{ nonce: string; message: string }>("/solana/challenge", {
                          address,
                        });
                        const proof = await ph.signMessage(new TextEncoder().encode(ch.message), "utf8");
                        await api("/solana/link", {
                          address,
                          nonce: ch.nonce,
                          signature: bs58(proof.signature),
                        });
                        return "Solana wallet verified.";
                      })
                    }
                  >
                    <Wallet size={15} />
                    Link Phantom
                  </button>
                  {data.solanaWallets.map((a) => (
                    <div key={a} className="mt-3 flex flex-wrap items-center gap-3">
                      <span className="font-mono text-sm">{fmt(a)}</span>
                      <button
                        className={btn}
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            const b = await api<{ lamports: string }>("/solana/balance/" + a);
                            return fmt(a) + " · " + b.lamports + " lamports";
                          })
                        }
                      >
                        Balance
                      </button>
                      <button
                        className={btn}
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await api("/solana/unlink", { address: a });
                            return "Wallet unlinked.";
                          })
                        }
                      >
                        Unlink
                      </button>
                    </div>
                  ))}
                  {data.solanaQuoteEnabled && data.solanaWallets.length > 0 && (
                    <form
                      className="mt-5 grid gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(async () => {
                          setQuote(
                            await api("/solana/quotes", {
                              ...sol,
                              taker: data.solanaWallets[0],
                              maxSlippageBps: 50,
                            }),
                          );
                          return "Read-only quote prepared.";
                        });
                      }}
                    >
                      {(Object.keys(sol) as (keyof typeof sol)[]).map((k, i) => (
                        <label className="text-xs text-muted" key={k}>
                          {
                            [
                              "Input mint",
                              "Output mint",
                              "Input amount in base units",
                              "Minimum output in base units",
                            ][i]
                          }
                          <input
                            className={input}
                            value={sol[k]}
                            required
                            onChange={(e) => {
                              setSol({ ...sol, [k]: e.target.value });
                              setQuote(null);
                            }}
                          />
                        </label>
                      ))}
                      <button className={btn} disabled={busy}>
                        Get quote
                      </button>
                    </form>
                  )}
                  {quote && (
                    <div className="mt-3">
                      <p className="text-sm">
                        Minimum output {quote.minimumOutput} base units · valid until{" "}
                        {new Date(quote.expiresAt).toLocaleTimeString()}
                      </p>
                      <button
                        className={btn + " mt-2"}
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            const value = await api<{
                              input: string;
                              output: string;
                              networkFeeLamports: string;
                            }>("/solana/quotes/" + quote.id + "/simulate", {});
                            return (
                              "Simulated " +
                              value.input +
                              " in · " +
                              value.output +
                              " out · " +
                              value.networkFeeLamports +
                              " lamports network fee."
                            );
                          })
                        }
                      >
                        Simulate unsigned quote
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">
                  The connected server verifies a one-time Phantom signature before attaching a wallet to an
                  account.
                </p>
              )}
            </div>
          )}
          {venue === "robinhood" && (
            <Link href="/app/wallets#linked" className={btn + " mt-5"}>
              Open testnet wallets <ArrowUpRight size={14} />
            </Link>
          )}
          {venue === "polymarket" && (
            <Link href="/app/new" className={btn + " mt-5"}>
              Build with an outcome signal <ArrowUpRight size={14} />
            </Link>
          )}
          {live && q.auth && (
            <Link href="/app/wallets#linked" className={btn + " mt-4"}>
              Sign in and link a wallet
            </Link>
          )}
          {live && q.error && !q.auth && (
            <p role="alert" className="mt-3 text-sm text-warn">
              {q.error}
            </p>
          )}
          {(error || msg) && (
            <p
              role={error ? "alert" : "status"}
              className={"mt-4 text-sm " + (error ? "text-warn" : "text-ink-2")}
            >
              {error || msg}
            </p>
          )}
        </section>
      </div>
      {data && (
        <section className="q-card mt-6 flex flex-wrap items-center justify-between gap-4 border border-line bg-card p-5">
          <div>
            <h2 className="text-sm font-medium">Account controls</h2>
            <p className="mt-1 text-[13px] text-muted">
              {data.paused
                ? "The account is paused. Resume individual sessions after reopening the account."
                : "Pause running paper sessions and disable Quiver’s testnet signer. Existing venue positions stay open."}
            </p>
          </div>
          <button
            className={btn}
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api(data.paused ? "/resume-account" : "/pause-all", {});
                return data.paused ? "Account reopened." : "Account paused.";
              })
            }
          >
            {data.paused ? "Reopen account" : "Pause account"}
          </button>
        </section>
      )}
    </Wrap>
  );
}
