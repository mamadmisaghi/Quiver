"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Pencil, SlidersHorizontal } from "lucide-react";
import DisclosurePanel from "@/components/DisclosurePanel";
import { Card } from "@/components/ui";
import {
  KeyDefaults,
  readKeyDefaults,
  readPaperDefaults,
  writePaperDefaults,
  writeSetting,
} from "@/lib/api/browser-settings";

function currentCaps() {
  const k = readKeyDefaults();
  return {
    trade: String(k.perTradeCapUsd),
    day: String(k.dailyCapUsd),
    slippage: String(k.maxSlippagePct),
  };
}

export default function WorkspaceDefaults({
  kind,
  onSaved,
}: {
  kind: "paper" | "keys";
  onSaved?: () => void;
}) {
  const paper = kind === "paper";
  const title = paper ? "Paper trading defaults" : "Session key defaults";
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState(() => {
    const value = typeof window === "undefined" ? null : readPaperDefaults().budgetUsd;
    return value === null ? "" : String(value);
  });
  const [caps, setCaps] = useState(() => typeof window === "undefined" ? { trade: "", day: "", slippage: "" } : currentCaps());
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const editorId = useId();
  const edit = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  function load() {
    const value = readPaperDefaults().budgetUsd;
    setBudget(value === null ? "" : String(value));
    setCaps(currentCaps());
  }
  useLayoutEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      edit.current?.focus({ preventScroll: true });
    }
  }, [editing]);
  function close() {
    restoreFocus.current = true;
    setEditing(false);
    setError("");
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (paper)
        writePaperDefaults({
          budgetUsd: budget.trim() ? Number(budget) : null,
        });
      else {
        const checked = KeyDefaults.safeParse({
          perTradeCapUsd: Number(caps.trade),
          dailyCapUsd: Number(caps.day),
          maxSlippagePct: Number(caps.slippage),
        });
        if (!checked.success)
          throw new Error(
            "Use positive caps up to $250 per trade, $1,000 per day and 1% slippage. Daily cap must be between 1× and 64× the trade cap.",
          );
        writeSetting("key-defaults", KeyDefaults, checked.data);
      }
      load();
      close();
      setNotice("Saved in this browser.");
      onSaved?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save these defaults.",
      );
    }
  }
  const currency = (v: string) =>
    Number(v).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  const rows = paper
    ? [
        ["Price source", "Live market prices"],
        ["Starting budget", budget ? currency(budget) : "Set per strategy"],
      ]
    : [
        ["Per trade", currency(caps.trade)],
        ["Per day", currency(caps.day)],
        [
          "Smallest swap",
          currency(String(Math.ceil((Number(caps.day) / 64) * 100) / 100)),
        ],
        ["Max slippage", caps.slippage + "%"],
      ];
  return (
    <Card className="q-config-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium">
          <SlidersHorizontal size={16} className="text-accent" />
          {title}
        </h2>
          <button
            ref={edit}
            type="button"
            className={`q-action${editing ? " invisible" : ""}`}
            aria-expanded={editing} aria-controls={editorId}
            aria-label={`Edit ${title}`}
            onClick={() => {
              load();
              setNotice("");
              setEditing(true);
            }}
          >
            <Pencil size={13} />
            Edit
          </button>
      </div>
      <DisclosurePanel id={editorId} open={editing} focusFirst>
        <form
          onSubmit={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              load();
              close();
            }
          }}
          className="mt-4 grid gap-3"
        >
          {paper ? (
            <>
              <label>
                Default virtual budget (USD)
                <input
                  className="q-control"
                  type="number"
                  step="any"
                  min="0.01"
                  max="1000000000000"
                  value={budget}
                  placeholder="Set per strategy"
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
            </>
          ) : (
            (
              [
                ["trade", "Per trade (USD)", 250],
                ["day", "Per day (USD)", 1000],
                ["slippage", "Max slippage (%)", 1],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key}>
                {label}
                <input
                  className="q-control"
                  required
                  type="number"
                  min="0.01"
                  max={max}
                  step="0.01"
                  value={caps[key]}
                  onChange={(e) => setCaps({ ...caps, [key]: e.target.value })}
                />
              </label>
            ))
          )}
          {error && (
            <p role="alert" className="text-short">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button className="q-action q-primary">Save changes</button>
            <button
              type="button"
              className="q-action"
              onClick={() => {
                load();
                close();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </DisclosurePanel>
      <DisclosurePanel open={!editing}>
        <dl className="mt-3 divide-y divide-line">
          {rows.map(([label, val]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 py-2.5"
            >
              <dt className="text-muted">{label}</dt>
              <dd className="tnum">{val}</dd>
            </div>
          ))}
        </dl>
      </DisclosurePanel>
      <p className="mt-3 text-[12px] text-muted">
        {paper
          ? "Applied when a new draft leaves the virtual budget open. Paper orders use live market prices."
          : "Used when preparing new session keys. Existing keys keep their original limits."}
      </p>
      {notice && (
        <p className="mt-2 text-[12px] text-accent" role="status">
          {notice}
        </p>
      )}
    </Card>
  );
}
