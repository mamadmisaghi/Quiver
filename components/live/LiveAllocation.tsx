"use client";
import { useEffect, useRef, useState } from "react";
import {
  NETWORK_DETAILS,
  connected,
  units,
  shortAddress,
  type LiveNetwork,
  type LiveAccount,
  type RunView,
} from "@/lib/live-client";
import SpotAutomation from "./SpotAutomation";
import {
  orderSize,
  ruleTiming,
  type LiveReview,
} from "@/services/backend/src/execution/live-review";
export default function LiveAllocation({
  review,
  account,
  connectedApi,
  onStart,
  beforeStart,
}: {
  review: LiveReview;
  beforeStart?: () => void;
  account: LiveAccount | null;
  connectedApi: boolean;
  onStart: (id: string) => void;
}) {
  const networks = [
    ...new Set(
      review.stages.map((s) => s.network).filter((n): n is LiveNetwork => !!n),
    ),
  ];
  const [mode, setMode] = useState<"confirm_each" | "auto">("confirm_each"),
    [slip, setSlip] = useState("50"),
    [approved, setApproved] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef<{ signature: string; value: string } | null>(null),
    lock = useRef(false);
  const change = (k: string, v: string) => {
    setFields((x) => ({ ...x, [k]: v }));
    setApproved(false);
    setError("");
  };
  function val(k: string, v: string) {
    return fields[k] ?? v;
  }
  function suggested(n: LiveNetwork) {
    const stages = review.stages.filter(
      (s) => s.network === n && s.side !== "sell",
    );
    const needed = stages.reduce(
      (sum, s) => sum + (s.amount.unit === "usd" ? (s.amount.value ?? 0) : 0),
      0,
    );
    if (networks.length === 1 && stages.length && review.budgetUsd)
      return String(review.budgetUsd);
    return stages.length
      ? String(
          +Math.min(
            review.budgetUsd ?? needed,
            needed > 0
              ? needed + Math.min(1, needed * 0.01)
              : (review.budgetUsd ?? 0) / Math.max(1, networks.length),
          ).toFixed(6),
        )
      : "0";
  }
  const wallets = (n: LiveNetwork) =>
    n === "solana-mainnet"
      ? (account?.solanaWallets ?? [])
      : (account?.evmWallets ?? []);
  const walletReady =
    networks.length > 0 &&
    networks.every((n) =>
      wallets(n).includes(val(n + "wallet", wallets(n)[0] ?? "")),
    );
  const liveReady =
    connectedApi &&
    !!account?.consent &&
    account.consent.version === account.termsVersion &&
    !account.paused &&
    walletReady &&
    !!review.reviewHash &&
    review.stages.every((s) => s.network);
  const linkedWallets = JSON.stringify([
    account?.evmWallets,
    account?.solanaWallets,
  ]);
  useEffect(
    () => setApproved(false),
    [linkedWallets, account?.consent?.at, account?.paused, review.reviewHash],
  );
  async function start() {
    if (!liveReady || !approved || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      beforeStart?.();
      const bindings = networks.map((n) => {
        const detail = NETWORK_DETAILS[n],
          wallet = val(n + "wallet", wallets(n)[0] ?? ""),
          usd = val(n + "usd", suggested(n)),
          fee = val(n + "fee", detail.defaultFee);
        if (!wallet)
          throw Error("Link and select a wallet for " + detail.label + ".");
        const inventory = review.stages
          .filter((s) => s.network === n && s.side === "sell" && s.address)
          .map((s) => {
            const decimals =
              (s as { tokenDecimals?: number }).tokenDecimals ??
              (n === "robinhood-mainnet" ? 18 : null);
            if (decimals === null)
              throw Error("The token precision could not be verified.");
            return {
              asset: s.address!,
              units: units(
                val(s.id + "inventory", String(s.amount.value ?? "")),
                decimals,
              ),
            };
          });
        return {
          network: n,
          wallet,
          usd,
          feePerOrder: units(fee, detail.feeDecimals),
          gasBudget:
            n === "hyperliquid-mainnet"
              ? "0"
              : units(
                  val(
                    n + "gas",
                    String(
                      Number(detail.defaultFee) *
                        Math.max(
                          1,
                          review.stages.filter((s) => s.network === n).length,
                        ),
                    ),
                  ),
                  detail.feeDecimals,
                ),
          inventory,
        };
      });
      const body = {
        strategyId: review.strategyId,
        version: review.version,
        reviewHash: review.reviewHash,
        network: "mainnet",
        mode,
        slippageBps: Number(slip),
        wallets: bindings,
        acceptRealOrders: true,
      };
      const signature = JSON.stringify(body);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(signature),
      );
      const storageKey =
        "quiver.live.pending." +
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      if (key.current?.signature !== signature)
        key.current = {
          signature,
          value: sessionStorage.getItem(storageKey) ?? crypto.randomUUID(),
        };
      sessionStorage.setItem(storageKey, key.current.value);
      const r = await connected<RunView>("/start", {
        ...body,
        key: key.current.value,
      });
      sessionStorage.removeItem(storageKey);
      onStart(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start live orders.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="live-allocation">
      <div className="live-card-top">
        <div>
          <span className="live-kicker">Reviewed rules</span>
          <h3>{review.name}</h3>
        </div>
        <span className="live-chip">
          {review.stages.length}{" "}
          {review.stages.length === 1 ? "stage" : "stages"}
        </span>
      </div>
      <ol className="live-stages">
        {review.stages.map((s, i) => (
          <li key={s.id}>
            <span className="live-num">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <strong>
                {s.side.toUpperCase()} {s.symbol}
                {s.leverage > 1 ? " · " + s.leverage + "×" : ""}
              </strong>
              <small>{ruleTiming(s, review.stages)}</small>
            </div>
            <span>{orderSize(s.amount)}</span>
          </li>
        ))}
      </ol>
      <div className="live-stats single">
        <div>
          Strategy budget{" "}
          <strong>
            {review.budgetUsd == null
              ? "Required"
              : "$" + review.budgetUsd.toLocaleString()}
          </strong>
        </div>
        <div>
          Daily loss limit <strong>{review.risk.maxDailyLossPct}%</strong>
        </div>
      </div>
      <div className="live-first-action">
        <strong>What happens first</strong>
        {review.stages
          .filter((s) => !s.after.length)
          .map((s) => (
            <p key={s.id}>
              {s.conditional
                ? "Watch for " + s.when + ". Once eligible, "
                : "On the first eligible quote, "}
              {mode === "auto"
                ? "use granted permissions or request a signature to "
                : "ask you to approve an order to "}
              {s.side === "short" || s.side === "long"
                ? "open a " +
                  s.leverage +
                  "× " +
                  s.side +
                  " on " +
                  s.symbol +
                  " with " +
                  orderSize(s.amount) +
                  " margin"
                : s.side + " " + orderSize(s.amount) + " of " + s.symbol}
              .
            </p>
          ))}
      </div>
      <details className="live-rule-details">
        <summary>Repeat rules &amp; exits</summary>
        {review.stages.map((s) => (
          <p key={s.id}>
            <strong>{s.symbol}</strong> ·{" "}
            {s.repeat
              ? [
                  s.repeat.intervalMinutes
                    ? "Every " + s.repeat.intervalMinutes + " min"
                    : "Each eligible event",
                  s.repeat.maxTimes
                    ? "up to " + s.repeat.maxTimes + " fills"
                    : "within allocation",
                  s.repeat.conditionMode === "each_time"
                    ? "recheck each time"
                    : "after initial trigger",
                ].join(", ")
              : "Once"}{" "}
            ·{" "}
            {[
              s.exits.stopLossPct && "Stop loss " + s.exits.stopLossPct + "%",
              s.exits.takeProfitPct &&
                "Take profit " + s.exits.takeProfitPct + "%",
              s.exits.trailingStopPct &&
                "Trailing stop " + s.exits.trailingStopPct + "%",
              s.exits.timeExitHours &&
                "Exit after " + s.exits.timeExitHours + "h",
              ...s.exits.ladder.map(
                (x) =>
                  "At +" +
                  x.atPct +
                  "% sell " +
                  +(100 * x.fraction).toFixed(2) +
                  "%",
              ),
              s.exits.description,
            ]
              .filter(Boolean)
              .join(" · ") || "No automatic exit"}
          </p>
        ))}
      </details>
      <>
        <div className="live-form">
          {networks.map((n) => {
            const label = NETWORK_DETAILS[n];
            return (
              <fieldset className="span-two live-wallet-funds" key={n}>
                <legend>{label.label}</legend>
                <label className="span-two">
                  Funding wallet
                  <select
                    disabled={!wallets(n).length}
                    value={val(n + "wallet", wallets(n)[0] ?? "")}
                    onChange={(e) => change(n + "wallet", e.target.value)}
                  >
                    <option value="">
                      {wallets(n).length
                        ? "Choose a linked wallet"
                        : "Wallet connection required"}
                    </option>
                    {wallets(n).map((a) => (
                      <option key={a} value={a}>
                        {shortAddress(a)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Allocate · {label.unit}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={val(n + "usd", suggested(n))}
                    onChange={(e) => change(n + "usd", e.target.value)}
                  />
                </label>
                <label>
                  Fee cap per order · {label.feeUnit}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={val(n + "fee", label.defaultFee)}
                    onChange={(e) => change(n + "fee", e.target.value)}
                  />
                </label>
                {n !== "hyperliquid-mainnet" && (
                  <label>
                    Network gas budget · {label.feeUnit}
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={val(
                        n + "gas",
                        String(
                          Number(label.defaultFee) *
                            Math.max(
                              1,
                              review.stages.filter((s) => s.network === n)
                                .length,
                            ),
                        ),
                      )}
                      onChange={(e) => change(n + "gas", e.target.value)}
                    />
                  </label>
                )}
                {review.stages
                  .filter((s) => s.network === n && s.side === "sell")
                  .map((s) => (
                    <label key={s.id}>
                      Allocate {s.symbol} tokens
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={val(
                          s.id + "inventory",
                          String(s.amount.value ?? ""),
                        )}
                        onChange={(e) =>
                          change(s.id + "inventory", e.target.value)
                        }
                      />
                    </label>
                  ))}
              </fieldset>
            );
          })}
          <label>
            Order approval
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setApproved(false);
              }}
            >
              <option value="confirm_each">Review every order</option>
              <option value="auto">Use granted permissions</option>
            </select>
          </label>
          <label>
            Max slippage · basis points
            <input
              type="number"
              min="1"
              max="500"
              value={slip}
              onChange={(e) => {
                setSlip(e.target.value);
                setApproved(false);
              }}
            />
          </label>
          <label className="span-two live-check">
            <input
              type="checkbox"
              disabled={!liveReady}
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I authorize the displayed strategy to trade these real funds within
            my limits.
          </label>
          <button
            className="q-action q-primary span-two"
            disabled={!approved || busy || !liveReady}
            onClick={() => void start()}
          >
            {busy ? "Checking funds and permissions…" : "Start live trading"}
          </button>
          {!liveReady && (
            <small className="span-two">
              {!connectedApi
                ? "Real orders become available after production activation."
                : !account
                  ? "Sign in to link a funding wallet."
                  : !review.reviewHash
                    ? "Verify the exact session rules before authorization."
                    : !walletReady
                      ? "Link a funding wallet for each selected venue to continue."
                      : "Enable trading in Wallet & risk limits to continue."}
            </small>
          )}
          {error && (
            <p role="alert" className="live-error span-two">
              {error}
            </p>
          )}
        </div>
        {connectedApi &&
          account &&
          review.reviewHash &&
          networks.includes("solana-mainnet") && (
            <SpotAutomation
              strategyId={review.strategyId}
              version={review.version}
              stages={review.stages
                .filter(
                  (s) =>
                    s.network === "solana-mainnet" &&
                    s.side === "buy" &&
                    s.amount.unit === "usd",
                )
                .map((s) => ({ id: s.id, label: "Buy " + s.symbol }))}
            />
          )}
      </>
    </div>
  );
}
