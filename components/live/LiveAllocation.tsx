"use client";
import { useRef, useState } from "react";
import {
  NETWORK_DETAILS,
  connected,
  units,
  shortAddress,
  type LiveNetwork,
  type LiveAccount,
  type Review,
  type RunView,
} from "@/lib/live-client";
import SpotAutomation from "./SpotAutomation";
export type ResolvedReview = Review & {
  reviewHash?: string;
  stages: (Review["stages"][number] & { tokenDecimals?: number | null })[];
};
export default function LiveAllocation({
  review,
  account,
  connectedApi,
  onStart,
}: {
  review: ResolvedReview;
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
  async function start() {
    if (!account || !approved || lock.current || !review.reviewHash) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
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
      if (key.current?.signature !== signature)
        key.current = { signature, value: crypto.randomUUID() };
      const r = await connected<RunView>("/start", {
        ...body,
        key: key.current.value,
      });
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
          <span className="live-kicker">
            Strategy review · V{review.version}
          </span>
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
              <small>
                {s.after.length
                  ? "After " +
                    s.after
                      .map(
                        (d) =>
                          (review.stages.find((p) => p.id === d.stageId)
                            ?.symbol ?? d.stageId) +
                          " " +
                          d.event.replaceAll("_", " "),
                      )
                      .join(" and ")
                  : s.when || "On start"}
              </small>
            </div>
            <span>
              {s.amount.unit === "usd" ? "$" : ""}
              {s.amount.value ?? "—"}{" "}
              {s.amount.unit === "usd"
                ? ""
                : s.amount.unit.replaceAll("_", " ")}
            </span>
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
      {connectedApi && account ? (
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
                      value={val(n + "wallet", wallets(n)[0] ?? "")}
                      onChange={(e) => change(n + "wallet", e.target.value)}
                    >
                      <option value="">Choose a linked wallet</option>
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
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I authorize the displayed strategy to trade these real funds
              within my limits.
            </label>
            <button
              className="q-action q-primary span-two"
              disabled={
                !approved ||
                busy ||
                !account.consent ||
                account.paused ||
                !review.reviewHash
              }
              onClick={() => void start()}
            >
              {busy ? "Checking funds and permissions…" : "Start live trading"}
            </button>
            {(!account.consent || account.paused) && (
              <small className="span-two">
                Set your account limits and enable live orders in Wallet
                permissions below.
              </small>
            )}
            {error && (
              <p role="alert" className="live-error span-two">
                {error}
              </p>
            )}
          </div>
          {networks.includes("solana-mainnet") && (
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
      ) : (
        <p className="live-note">
          {connectedApi
            ? "Sign in to select funding wallets and authorize a live run."
            : "The reviewed rules are available on this device. Funding and order authorization use the connected production account."}
        </p>
      )}
    </div>
  );
}
