"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  Strategy,
  Risk,
  Workflow,
  MarketResolution,
  type MarketCandidate,
} from "@/lib/contracts";
import type { LiveNetwork } from "@/lib/live-client";
export default function QuickTicket({
  net,
  onSaved,
}: {
  net: LiveNetwork;
  onSaved: (id: string) => void;
}) {
  const venue =
    net === "hyperliquid-mainnet"
      ? "hyperliquid"
      : net === "solana-mainnet"
        ? "solana"
        : "robinhood";
  const [market, setMarket] = useState(
    venue === "hyperliquid"
      ? "BTC"
      : venue === "solana"
        ? "So11111111111111111111111111111111111111112"
        : "NVDA",
  );
  const [side, setSide] = useState(venue === "hyperliquid" ? "long" : "buy"),
    [amount, setAmount] = useState("25"),
    [leverage, setLeverage] = useState("1"),
    [budget, setBudget] = useState("100");
  const [candidates, setCandidates] = useState<MarketCandidate[]>([]),
    [chosen, setChosen] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false);
  async function submit() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const asset = {
        id: "market",
        query: market.trim(),
        sourceText: market.trim(),
        venue,
        kind: venue === "hyperliquid" ? "perp" : "token",
        outcome: null,
      };
      if (!asset.query || !(Number(amount) > 0) || !(Number(budget) > 0))
        throw Error("Enter a market, order size and budget.");
      let selected = candidates.find((c) => c.id === chosen);
      if (!selected) {
        const res = await fetch("/api/preview/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(asset),
        });
        if (!res.ok) throw Error("Market lookup is temporarily unavailable.");
        const result = MarketResolution.parse(await res.json());
        if (!result.candidates.length) throw Error(result.message);
        if (result.candidates.length > 1 || result.status === "choose") {
          setCandidates(result.candidates);
          return;
        }
        selected = result.candidates[0];
      }
      if (selected.venue !== venue)
        throw Error("Choose a market on the selected venue.");
      const name =
          side.charAt(0).toUpperCase() + side.slice(1) + " " + selected.symbol,
        size = Number(amount),
        lev = venue === "hyperliquid" ? Number(leverage) : 1,
        unit = side === "sell" ? "native" : "usd";
      const description =
        name +
        " · " +
        amount +
        (unit === "native" ? " tokens" : " USD") +
        (lev > 1 ? " · " + lev + "×" : "");
      const workflow = Workflow.parse({
        version: 1,
        name,
        summary: description,
        budgetUsd: Number(budget),
        assets: [
          {
            ...asset,
            kind: selected.kind,
            resolution: {
              status: "matched",
              selectedId: selected.id,
              candidates: [selected],
              checkedAt: new Date().toISOString(),
              message: "Selected " + selected.symbol,
            },
          },
        ],
        signals: [],
        stages: [
          {
            id: "entry",
            assetId: "market",
            side,
            sourceText: description,
            conditionText: "On start",
            when: null,
            after: [],
            amount: { unit, value: size },
            leverage: lev,
            funding: { kind: "budget", from: [] },
            repeat: null,
            exits: {
              stopLossPct: null,
              takeProfitPct: null,
              trailingStopPct: null,
              timeExitHours: null,
              ladder: [],
              description: "",
            },
          },
        ],
        questions: [],
        assumptions: [],
      });
      const risk = Risk.parse({
        maxPositionPct: 100,
        maxTotalExposurePct: 100,
        maxDailyLossPct: 10,
        maxOrdersPerDay: 1,
      });
      const saved = await api.createStrategy(
        Strategy.parse({
          schemaVersion: 1,
          name,
          thesis: description,
          workflow,
          risk,
          signals: [],
          triggers: [],
          actions: [],
        }),
      );
      onSaved(saved.id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not prepare this ticket.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="live-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="span-two">
        {venue === "solana" ? "Token mint or symbol" : "Market"}
        <input
          value={market}
          maxLength={100}
          required
          onChange={(e) => {
            setMarket(e.target.value);
            setCandidates([]);
            setChosen("");
          }}
        />
      </label>
      {candidates.length > 0 && (
        <label className="span-two">
          Exact market
          <select
            required
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value="">Choose a market</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.symbol} · {c.address ?? c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Direction
        <select value={side} onChange={(e) => setSide(e.target.value)}>
          {(venue === "hyperliquid" ? ["long", "short"] : ["buy", "sell"]).map(
            (s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        {side === "sell"
          ? "Token quantity"
          : venue === "hyperliquid"
            ? "Isolated margin · USD"
            : "Order amount · USD"}
        <input
          value={amount}
          type="number"
          min="0.000001"
          step="any"
          required
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {venue === "hyperliquid" && (
        <label>
          Leverage
          <input
            value={leverage}
            type="number"
            min="1"
            max="100"
            step="1"
            required
            onChange={(e) => setLeverage(e.target.value)}
          />
        </label>
      )}
      <label>
        Budget · USD
        <input
          value={budget}
          type="number"
          min="1"
          step="any"
          required
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <small className="span-two">
        Review saves your ticket as a strategy. You choose a wallet and
        authorize real orders in the next step.
      </small>
      <button type="submit" className="q-action span-two" disabled={busy}>
        {busy ? "Resolving market…" : "Review ticket"}
      </button>
      {error && (
        <p className="span-two live-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
