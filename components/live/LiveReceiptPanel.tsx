"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Clock3,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import { useTradingWallets } from "@/components/auth/WalletRuntime";
import { onSession } from "@/lib/api/session";
import {
  NETWORK_DETAILS,
  connected,
  shortAddress,
  money,
  amountLabel,
  amountText,
  timestamp,
  type Account,
  type Allowance,
  type HandOff,
  type LiveOrder,
  type RunView,
  type SolPin,
} from "@/lib/live-client";
import {
  getReviewedEvmProvider,
  sendRobinhoodEOA,
  type RobinhoodTx,
} from "@/lib/wallet/live-evm";
import {
  signHlOwnerOrder,
  type HlOwnerTerms,
} from "@/lib/wallet/live-hl-owner";
import { signSolanaQuote } from "@/lib/wallet/live-solana";
import {
  checkStockAllowance,
  checkStockHandoff,
} from "@/lib/live-order-review";

type Props = {
  runId: string;
  account: Account | null;
  onChange?: () => void | Promise<void>;
};
type ApprovalHand = {
  tx: RobinhoodTx;
  wallet: string;
  expiresAt: number;
  maxNetworkFeeWei: string;
};
const final = new Set(["filled", "cancelled", "rejected", "revoked"]);
const phase = (s: string) =>
  ({
    planned: "Awaiting review",
    reserved: "Reserved",
    dispatching: "Awaiting venue",
    unknown: "Awaiting receipt",
    submitted: "Submitted",
    partial: "Partially filled",
    awaiting_final: "Awaiting finality",
    reconciling: "Reconciling",
    filled: "Filled",
    cancelled: "Cancelled",
    rejected: "Rejected",
    revoked: "Revoked",
    running: "Running",
    paused: "Paused",
    complete: "Complete",
    stopped: "Stopped",
  })[s] ?? s.replaceAll("_", " ");
const badge = (s: string) =>
  "inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] " +
  (s === "filled" || s === "complete"
    ? "border-line text-long"
    : s === "planned" || s === "partial" || s === "unknown"
      ? "border-line text-accent"
      : "border-line text-muted");
function receiptLink(o: LiveOrder) {
  const ref = o.orderRef ?? o.recoveryId ?? "";
  if (
    o.network === "solana-mainnet" &&
    /^[1-9A-HJ-NP-Za-km-z]{84,88}$/.test(ref)
  )
    return "https://explorer.solana.com/tx/" + ref;
  if (o.network === "robinhood-mainnet" && /^0x[0-9a-fA-F]{64}$/.test(ref))
    return "https://robinhoodchain.blockscout.com/tx/" + ref;
  return null;
}
function hint(result: { state: string; hash?: string }) {
  if (result.state === "submitted")
    return "Wallet submitted the transaction. Waiting for canonical confirmation.";
  if (result.state === "rejected")
    return "The wallet request was declined. Quiver will check the reserved nonce before permitting another attempt.";
  return result.hash
    ? "Transaction " + result.hash + " is under reconciliation."
    : "The wallet response was inconclusive. Quiver will track the original nonce.";
}
function reviewUnits(o: LiveOrder, v: string) {
  if (o.network === "hyperliquid-mainnet")
    return amountLabel(v, 18) + " " + o.market.symbol;
  if (
    o.network === "robinhood-mainnet" &&
    o.spendAsset.toLowerCase() === o.market.address?.toLowerCase()
  )
    return amountLabel(v, 18) + " " + o.market.symbol;
  if (
    o.network === "solana-mainnet" &&
    o.unsigned &&
    "pin" in o.unsigned &&
    o.spendAsset === o.market.address
  )
    return amountLabel(v, o.unsigned.assetDecimals) + " " + o.market.symbol;
  return amountText(o.network, o.spendAsset, v);
}
function OrderFacts({ order }: { order: LiveOrder }) {
  const o = order,
    hl = o.unsigned && "kind" in o.unsigned ? o.unsigned : null,
    sol = o.unsigned && "pin" in o.unsigned ? o.unsigned : null,
    stock = o.quote,
    link = receiptLink(o);
  const rows: [string, string][] = [
    ["Wallet", shortAddress(o.wallet)],
    ["Input", amountText(o.network, o.spendAsset, o.spendUnits)],
    ["Slippage ceiling", (o.slippageBps / 100).toLocaleString() + "%"],
  ];
  if (o.notionalUsd6)
    rows.push(["Reviewed notional", money(amountLabel(o.notionalUsd6, 6))]);
  if (hl)
    rows.push(
      ["Limit price", money(hl.limit)],
      ["Perpetual quantity", hl.quantity + " " + hl.instrument],
      ["Maximum fill fee", amountLabel(hl.feeCapUsd6, 6) + " USDC"],
    );
  if (sol)
    rows.push(
      [
        "Minimum output",
        amountLabel(
          sol.pin.requiredOutput,
          o.leg === "exit" || o.side === "sell" ? 6 : sol.assetDecimals,
        ) +
          " " +
          (o.leg === "exit" || o.side === "sell" ? "USDC" : o.market.symbol),
      ],
      [
        "Fee and rent ceiling",
        amountLabel(sol.pin.intent.maxNetworkAndRentLamports, 9) + " SOL",
      ],
    );
  if (stock)
    rows.push(
      [
        "Minimum output",
        amountLabel(
          stock.minimumOutputUnits,
          o.side === "sell" || o.leg === "exit" ? 6 : 18,
        ) +
          " " +
          (o.side === "sell" || o.leg === "exit" ? "USDG" : o.market.symbol),
      ],
      ["Network fee ceiling", amountLabel(stock.maxFeeWei, 18) + " ETH"],
    );
  if (o.perpetual) {
    rows.push([
      "Exchange fills",
      o.perpetual.filledSize +
        " / " +
        o.perpetual.requestedSize +
        " " +
        o.market.symbol,
    ]);
    if (o.perpetual.averagePrice)
      rows.push(["Average fill", money(o.perpetual.averagePrice)]);
    rows.push(["Filled notional", money(o.perpetual.executedNotional)]);
    if (o.perpetual.realizedClosedPnl !== null)
      rows.push(["Realized close P&L", money(o.perpetual.realizedClosedPnl)]);
    for (const [currency, fee] of Object.entries(o.perpetual.fees))
      rows.push(["Paid fee", fee + " " + currency]);
  } else if (o.filledUnits !== "0")
    rows.push([
      "Confirmed input",
      reviewUnits(o, o.filledUnits) + " / " + reviewUnits(o, o.targetUnits),
    ]);
  return (
    <>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] text-muted">{k}</dt>
            <dd className="mt-0.5 break-words font-mono text-[12.5px] text-ink-2">
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {o.network === "robinhood-mainnet" &&
        o.status !== "planned" &&
        !final.has(o.status) &&
        o.recoveryId && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Quiver is tracking wallet nonce {o.recoveryId.split(":").at(-1)}. If
            your wallet declined or lost the request, check this nonce in your
            wallet. A finalized replacement can release the reservation.
          </p>
        )}
      {(o.orderRef || o.recoveryId) && (
        <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-muted">
          <span>Venue reference</span>
          {link ? (
            <a
              className="inline-flex items-center gap-1 font-mono text-accent"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
            >
              {shortAddress(o.orderRef ?? o.recoveryId!)}{" "}
              <ArrowUpRight size={12} />
            </a>
          ) : (
            <code title={o.orderRef ?? o.recoveryId!} className="break-all">
              {o.orderRef ?? o.recoveryId}
            </code>
          )}
        </div>
      )}
    </>
  );
}

export default function LiveReceiptPanel({ runId, account, onChange }: Props) {
  const runtime = useTradingWallets(),
    [view, setView] = useState<RunView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pollError, setPollError] = useState("");
  const [sessionRev, setSessionRev] = useState(0),
    [decision, setDecision] = useState<"pause" | "resume" | "stop" | null>(
      null,
    ),
    [clock, setClock] = useState(Date.now),
    epoch = useRef(0),
    lock = useRef(false),
    alive = useRef(true),
    rev = useRef(-1);
  const endpoint = "/runs/" + encodeURIComponent(runId),
    accountPresent = !!account;
  const install = useCallback(
    (v: RunView, ticket: number) => {
      if (
        alive.current &&
        ticket === epoch.current &&
        v.id === runId &&
        v.revision >= rev.current
      ) {
        rev.current = v.revision;
        setView(v);
        setPollError("");
      }
    },
    [runId],
  );
  useEffect(() => {
    alive.current = true;
    const t = ++epoch.current;
    rev.current = -1;
    setView(null);
    setNotice("");
    setError("");
    setPollError("");
    setDecision(null);
    if (!accountPresent || !runId) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const run = await connected<RunView>(
          endpoint,
          undefined,
          controller.signal,
        );
        install(run, t);
      } catch (e) {
        if (t === epoch.current && !controller.signal.aborted)
          setPollError(
            e instanceof Error ? e.message : "Could not read the live run.",
          );
      } finally {
        if (t === epoch.current && !controller.signal.aborted)
          timeout = setTimeout(read, document.hidden ? 15000 : 4500);
      }
    }
    void read();
    const timer = setInterval(() => setClock(Date.now()), 1000);
    const off = onSession(() => {
      epoch.current++;
      setView(null);
      setNotice("");
      setError("");
      setDecision(null);
      controller.abort();
      setSessionRev((n) => n + 1);
    });
    return () => {
      off();
      controller.abort();
      clearTimeout(timeout);
      clearInterval(timer);
      epoch.current++;
      alive.current = false;
    };
  }, [accountPresent, runId, endpoint, install, sessionRev]);
  async function act(fn: (t: number) => Promise<string>) {
    if (lock.current || !view) return;
    lock.current = true;
    const t = epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await fn(t);
      if (t !== epoch.current) return;
      setNotice(message);
      const v = await connected<RunView>(endpoint);
      install(v, t);
      if (t === epoch.current) await onChange?.();
    } catch (e) {
      if (t === epoch.current)
        setError(
          e instanceof Error
            ? e.message
            : "Could not complete the wallet action.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const match = (t: number) => {
    if (t !== epoch.current || !alive.current)
      throw Error("The account changed. Reopen the live run.");
  };
  const mutate = async (path: string, data: unknown, t: number) => {
    match(t);
    const v = await connected<RunView>(endpoint + path, data);
    install(v, t);
    return v;
  };
  async function confirm(order: LiveOrder, t: number) {
    const fresh = await connected<RunView>(endpoint);
    match(t);
    const o = fresh.orders.find(
      (r) => r.id === order.id && r.digest === order.digest,
    );
    if (
      !o ||
      o.status !== "planned" ||
      Date.now() >= o.expiresAt ||
      o.wallet !== order.wallet
    )
      throw Error("The quote changed. Read the current order before signing.");
    const post = (value: unknown) => {
      match(t);
      return connected<RunView & { walletSubmission?: HandOff }>(
        endpoint + "/confirm",
        {
          orderId: o.id,
          digest: o.digest,
          value,
          acceptRealOrder: true,
        },
      );
    };
    if (o.network === "robinhood-mainnet") {
      const signer = await runtime.selectEvm(o.wallet);
      await getReviewedEvmProvider(signer, o.wallet, 4663);
      if (!o.quote)
        throw Error(
          "The stock minimum and fee cap are unavailable. Refresh this run.",
        );
      const v = await post({ authorizeWalletSubmission: true });
      install(v, t);
      match(t);
      const h = v.walletSubmission;
      if (!h)
        return "This wallet request already has a durable claim. Quiver is tracking the original.";
      const q = checkStockHandoff(o, runId, v.id, h);
      let handed = false;
      const outcome = await sendRobinhoodEOA(
        signer,
        {
          intentId: o.id,
          step: o.sequence,
          owner: o.wallet,
          expiresAt: h.expiresAt,
          maxNetworkFeeWei: q.maxFeeWei,
          tx: h.packet,
        },
        {
          claim: async () => {
            match(t);
            if (handed) return "already_claimed";
            handed = true;
            return "claimed";
          },
          record: async (result) => {
            if (result.hash)
              await mutate(
                "/wallet-receipt",
                { orderId: o.id, digest: o.digest, txHash: result.hash },
                t,
              );
          },
        },
      );
      return hint(outcome);
    }
    if (o.network === "solana-mainnet") {
      if (!o.unsigned || !("pin" in o.unsigned))
        throw Error("The reviewed Solana transaction is unavailable.");
      const p: SolPin = o.unsigned.pin;
      if (!p.intent)
        throw Error(
          "This order requires its separately authorized execution wallet. Refresh its permission or prepare a reviewed wallet order.",
        );
      if (
        p.intent.taker !== o.wallet ||
        p.intent.inputMint !== o.spendAsset ||
        p.intent.inputAmount !== o.spendUnits ||
        p.expiresAt !== o.expiresAt
      )
        throw Error("The swap inputs differ from the review.");
      const signed = await signSolanaQuote(
        await runtime.selectSolana(o.wallet),
        {
          network: "solana:mainnet",
          wallet: o.wallet,
          transaction: p.unsigned,
          messageHash: p.messageHash,
          expiresAt: p.expiresAt,
        },
      );
      const v = await post({ signed: signed.signed });
      install(v, t);
      return "Exact wallet signature submitted. Waiting for its finalized Solana receipt.";
    }
    if (
      o.network !== "hyperliquid-mainnet" ||
      !o.unsigned ||
      !("kind" in o.unsigned)
    )
      throw Error("The Hyperliquid order terms are unavailable.");
    const isAgent =
      account?.agent?.state === "active" &&
      account.agent.master.toLowerCase() === o.wallet.toLowerCase() &&
      account.agent.validUntil > Date.now();
    const hasOwner = (o.unsigned as HlOwnerTerms).ownerSignatures.length > 0;
    if (!isAgent && !hasOwner)
      throw Error(
        "Configure a mainnet trading agent or prepare an owner-signed order.",
      );
    const value = isAgent
      ? { reviewed: true }
      : (
          await signHlOwnerOrder(
            await runtime.selectEvm(o.wallet),
            o.unsigned as HlOwnerTerms,
            o.wallet,
          )
        ).value;
    const v = await post(value);
    install(v, t);
    return "Order confirmation recorded. Quiver will reconcile the exchange’s fill receipts.";
  }
  async function allowance(a: Allowance, t: number) {
    if (a.state !== "review" || Date.now() >= a.expiresAt)
      throw Error("The allowance request expired.");
    const signer = await runtime.selectEvm(a.wallet);
    await getReviewedEvmProvider(signer, a.wallet, 4663);
    match(t);
    const hand = await connected<ApprovalHand>(
      "/allowances/" + a.id + "/claim",
      {
        digest: a.digest,
        acceptRealAllowance: true,
      },
    );
    match(t);
    if (
      hand.wallet.toLowerCase() !== a.wallet.toLowerCase() ||
      hand.expiresAt !== a.expiresAt ||
      hand.maxNetworkFeeWei !== a.fee
    )
      throw Error("Claimed wallet allowance differs from the review.");
    checkStockAllowance(a, hand.tx);
    let released = false;
    return hint(
      await sendRobinhoodEOA(
        signer,
        {
          intentId: a.id,
          step: 0,
          owner: a.wallet,
          expiresAt: a.expiresAt,
          maxNetworkFeeWei: a.fee,
          tx: hand.tx,
        },
        {
          claim: async () => {
            match(t);
            if (released) return "already_claimed";
            released = true;
            return "claimed";
          },
          record: async (result) => {
            if (result.hash) {
              match(t);
              await connected("/allowances/" + a.id + "/receipt", {
                txHash: result.hash,
              });
            }
          },
        },
      ),
    );
  }
  if (!runId || !account) return null;
  const allowances = account.allowances.filter(
    (x) => x.program === runId && ["review", "claimed"].includes(x.state),
  );
  return (
    <section
      className="q-card min-w-0 overflow-hidden border border-line bg-card"
      aria-label="Live workflow and order receipts"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <ReceiptText size={14} className="text-accent" /> Mainnet receipts
          </div>
          <h2 className="mt-1.5 text-xl font-medium tracking-tight">
            {view?.name ?? account.runs.find((r) => r.id === runId)?.name ?? "Live workflow"}
          </h2>
        </div>
        {view && (
          <span className={badge(view.status)}>{phase(view.status)}</span>
        )}
      </header>
      {pollError && (
        <p role="alert" className="px-5 pt-4 text-sm text-warn">
          {pollError}
        </p>
      )}
      {!view ? (
        <p className="p-5 text-sm text-muted" role="status">
          Reading the saved run and its venue evidence…
        </p>
      ) : (
        <>
          <div className="border-b border-line p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-muted">
                {view.mode === "auto"
                  ? "Authorized automation"
                  : "Review each order"}{" "}
                · Version {view.version} · Started {timestamp(view.createdAt)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="q-action"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async (t) => {
                      await mutate("/refresh", {}, t);
                      return "Receipt reconciliation requested.";
                    })
                  }
                >
                  <RefreshCw size={13} /> Refresh
                </button>
                {(view.status === "running" || view.status === "paused") && (
                  <>
                    <button
                      className="q-action"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setDecision(
                          view.status === "running" ? "pause" : "resume",
                        )
                      }
                    >
                      {view.status === "running" ? "Pause" : "Resume"}
                    </button>
                    <button
                      className="q-action"
                      type="button"
                      disabled={busy}
                      onClick={() => setDecision("stop")}
                    >
                      Stop run
                    </button>
                  </>
                )}
              </div>
            </div>
            {decision && (
              <div className="mt-3 rounded-lg border border-line p-3 text-sm">
                <p>
                  {decision === "resume"
                    ? "Resume observing this workflow and executing its authorized orders."
                    : decision === "pause"
                      ? "Pause new entries. Submitted orders stay under reconciliation."
                      : "End this run. Already submitted orders and open venue positions remain."}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    className="q-action"
                    disabled={busy}
                    onClick={() =>
                      void act(async (t) => {
                        await mutate("/control", { command: decision }, t);
                        setDecision(null);
                        return "Workflow control updated.";
                      })
                    }
                  >
                    {decision === "resume"
                      ? "Confirm resume"
                      : decision === "pause"
                        ? "Confirm pause"
                        : "Confirm stop"}
                  </button>
                  <button
                    className="q-action"
                    disabled={busy}
                    onClick={() => setDecision(null)}
                  >
                    Keep current state
                  </button>
                </div>
              </div>
            )}
            <p className="mt-3 border-l-2 border-accent pl-3 text-sm text-ink-2">
              {view.message}
            </p>
            {view.issues.map((x) => (
              <p
                key={x.id + ":" + x.reason}
                role="alert"
                className="mt-2 text-sm text-warn"
              >
                {x.reason}
              </p>
            ))}
          </div>
          <div className="grid border-b border-line md:grid-cols-2">
            <div className="p-5">
              <h3 className="text-sm font-medium">Stages</h3>
              <ol className="mt-3 space-y-3">
                {view.stages.map((s, i) => {
                  const symbol = s.symbol ?? view.orders.find((o) => o.stage === s.id)
                    ?.market.symbol;
                  return (
                    <li
                      key={s.id}
                      className="grid grid-cols-[1.4rem_1fr] items-start gap-2"
                    >
                      <span className="font-mono text-xs text-muted">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <div className="break-words text-sm">
                          {symbol
                            ? s.side.toUpperCase() + " " + symbol
                            : s.id.replaceAll("_", " ")}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {s.after.length
                            ? "After " +
                              s.after
                                .map(
                                  (d) =>
                                    d.stageId.replaceAll("_", " ") +
                                    " " +
                                    d.event,
                                )
                                .join(" and ")
                            : s.when || "Entry condition"}{" "}
                          · {s.entryOrders.length} entry intents
                        </p>
                        {s.holding && (
                          <p className="mt-1 text-xs text-ink-2">
                            Verified holding · average entry{" "}
                            {money(s.holding.averageEntryUsd)}
                          </p>
                        )}
                        {s.canClose && (
                          <button
                            className="q-action mt-2"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void act(async (t) => {
                                await mutate("/close", { stage: s.id }, t);
                                return "Review the closing quantity, network and price before confirming.";
                              })
                            }
                          >
                            Review close
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="border-t border-line p-5 md:border-l md:border-t-0">
              <h3 className="text-sm font-medium">Reserved capital</h3>
              <ul className="mt-3 space-y-3">
                {view.allocations.map((x) => {
                  const net = x.venue as LiveOrder["network"];
                  return (
                    <li key={net + x.asset} className="text-sm">
                      <p>
                        {NETWORK_DETAILS[net]?.label ?? net}{" "}
                        <span className="text-xs text-muted">
                          · {shortAddress(x.asset)}
                        </span>
                      </p>
                      <p className="mt-0.5 font-mono text-[12px] text-muted">
                        {amountText(net, x.asset, x.free)} free ·{" "}
                        {amountText(net, x.asset, x.held)} held
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          {allowances.length > 0 && (
            <div className="space-y-3 border-b border-line p-5">
              <h3 className="text-sm font-medium">Stock token allowances</h3>
              {allowances.map((a) => (
                <div className="rounded-lg border border-line p-3" key={a.id}>
                  <p className="text-sm">
                    {a.kind === "approve_zero"
                      ? "Reset token allowance"
                      : "Approve exact token spend"}{" "}
                    · {amountText("robinhood-mainnet", a.asset, a.amount)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Wallet {shortAddress(a.wallet)} · Uniswap SwapRouter02 · fee
                    cap {amountLabel(a.fee, 18)} ETH · {phase(a.state)}
                  </p>
                  {a.state === "review" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className="q-action"
                        disabled={busy || clock >= a.expiresAt}
                        onClick={() => void act((t) => allowance(a, t))}
                      >
                        {clock >= a.expiresAt
                          ? "Allowance expired"
                          : "Sign exact allowance"}
                      </button>
                      <button
                        className="q-action"
                        disabled={busy}
                        onClick={() =>
                          void act(async (t) => {
                            match(t);
                            await connected(
                              "/allowances/" + a.id + "/decline",
                              {},
                            );
                            return "Allowance declined.";
                          })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  ) : (
                    <button
                      className="q-action mt-2"
                      disabled={busy}
                      onClick={() =>
                        void act(async (t) => {
                          match(t);
                          await connected(
                            "/allowances/" + a.id + "/receipt",
                            {},
                          );
                          return "Original wallet nonce checked.";
                        })
                      }
                    >
                      Check original receipt
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="p-5">
            <h3 className="text-sm font-medium">Order activity</h3>
            {view.orders.length === 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-bg p-3 text-sm text-muted">
                <Clock3 size={15} /> Waiting for an eligible stage.
              </div>
            )}
            <ol className="mt-3 space-y-3">
              {[...view.orders].reverse().map((o) => {
                const pending =
                    o.status === "planned" &&
                    (o.leg === "exit" || view.status === "running"),
                  expired = clock >= o.expiresAt;
                return (
                  <li key={o.id} className="rounded-lg border border-line p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-[11px] text-muted">
                          {NETWORK_DETAILS[o.network].label} ·{" "}
                          {o.leg === "exit" ? "Exit" : "Entry"} {o.sequence}
                        </div>
                        <h4 className="mt-1 text-sm font-medium">
                          {o.side.toUpperCase()} {o.market.symbol}
                          {o.leverage > 1 ? " · " + o.leverage + "×" : ""}
                        </h4>
                      </div>
                      <span className={badge(o.status)}>{phase(o.status)}</span>
                    </div>
                    <p className="mt-2 text-sm text-ink-2">{o.summary}</p>
                    <OrderFacts order={o} />
                    {pending && (
                      <p className="mt-3 text-xs text-muted">
                        {expired
                          ? "Quote expired"
                          : "Quote expires " + timestamp(o.expiresAt)}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {pending && (
                        <button
                          className="q-action q-primary"
                          disabled={
                            busy ||
                            expired ||
                            !runtime.ready ||
                            (o.network === "robinhood-mainnet"
                              ? !o.quote
                              : !o.unsigned)
                          }
                          onClick={() => void act((t) => confirm(o, t))}
                        >
                          {o.network === "hyperliquid-mainnet" &&
                          account.agent?.state === "active" &&
                          account.agent.master.toLowerCase() ===
                            o.wallet.toLowerCase()
                            ? "Confirm with trading agent"
                            : "Review in wallet"}
                        </button>
                      )}
                      {!final.has(o.status) &&
                        !o.cancellation &&
                        (o.network === "hyperliquid-mainnet" ||
                          o.status === "planned" ||
                          o.status === "reserved") && (
                          <button
                            className="q-action"
                            disabled={busy}
                            onClick={() =>
                              void act(async (t) => {
                                await mutate("/cancel", { orderId: o.id }, t);
                                return "Cancellation status refreshed. A fill remains possible until the venue confirms.";
                              })
                            }
                          >
                            {o.status === "planned" || o.status === "reserved"
                              ? "Decline order"
                              : "Request cancel"}
                          </button>
                        )}
                      {o.cancellation && (
                        <span className="text-xs text-muted">
                          Cancellation {o.cancellation}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
      {(error || notice) && (
        <p
          role={error ? "alert" : "status"}
          className={
            "border-t border-line px-5 py-3 text-sm " +
            (error ? "text-warn" : "text-ink-2")
          }
        >
          {error || notice}
        </p>
      )}
    </section>
  );
}
