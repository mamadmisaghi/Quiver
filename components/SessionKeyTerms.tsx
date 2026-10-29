"use client";
// M3.7: session-key terms in the Go live confirm step. An active key shows its policy read-only. Otherwise the caps
// form is prefilled from GET /v1/session-keys/defaults and its values are what Go live sends to
// POST /session-keys/prepare (PrepareSessionKeyReq: perTxCapUsd, dailyCapUsd, maxSlippagePct, expiresInHours, tokens).
// M3.9: max slippage (0 < x ≤ 10, whole bps) and expiry in hours (default defaultExpiryHours, ≤ maxExpiryHours) are
// editable; the server still enforces the account's on-chain slippage cap (422 session_key_slippage_above_cap). Min swap is the API's minSwapUsd for the default per-day cap; ceil(day ÷ 64) only as a fallback.
import { useEffect, useState } from "react";
import { SESSION_KEY, fmtUsd, minSwapUsd, type SessionKeyDefaults } from "@/lib/api";

export type SkTerms = { perTxCapUsd: string; windowCapUsd: string; maxSlippagePct: number; active: boolean };
/** Caps the user will grant, or null while the form is invalid. */
export type SkCaps = { perTxCapUsd: string; dailyCapUsd: string; maxSlippagePct: number; expiresInHours: number } | null;
export const EXPIRY = { def: 24, max: 168 } as const; // fallbacks when /defaults is missing
const FALLBACK: SkTerms = { perTxCapUsd: SESSION_KEY.defaultPerTxCapUsd, windowCapUsd: SESSION_KEY.defaultWindowCapUsd, maxSlippagePct: SESSION_KEY.defaultSlippageCapBps / 100, active: false };
export const termsFromDefaults = (d: SessionKeyDefaults): SkTerms => ({ perTxCapUsd: String(d.perTradeCapUsd), windowCapUsd: String(d.dailyCapUsd), maxSlippagePct: d.maxSlippagePct, active: false });

const pct = (n: number) => `${String(Number(n.toFixed(2)))}%`;
const DEC = /^\d+(\.\d{1,2})?$/;
/** Local checks mirroring prepare + the SessionAccount: per trade > 0, per day ≥ per trade, per day ≤ 64 × per trade. */
export function capsError(perTx: string, daily: string): string | null {
  if (!DEC.test(perTx) || Number(perTx) <= 0) return "Per-trade cap must be a positive dollar amount.";
  if (!DEC.test(daily) || Number(daily) <= 0) return "Per-day cap must be a positive dollar amount.";
  if (Number(daily) < Number(perTx)) return "Per-day cap can’t be below the per-trade cap.";
  if (Number(daily) > SESSION_KEY.maxSpendsPerWindow * Number(perTx)) return `Per-day cap can be at most 64 × the per-trade cap (${fmtUsd(String(SESSION_KEY.maxSpendsPerWindow * Number(perTx)))}).`;
  return null;
}
export function slipError(v: string): string | null {
  if (!DEC.test(v) || Number(v) <= 0 || Number(v) > 10) return "Max slippage must be between 0.01% and 10%, up to 2 decimals.";
  return null;
}
export function expiryError(v: string, max: number): string | null {
  if (!/^\d+$/.test(v) || Number(v) < 1) return "Expiry must be a whole number of hours, at least 1.";
  if (Number(v) > max) return `Expiry can be at most ${max} hours (${max / 24} days).`;
  return null;
}
/** Server 422 codes that belong to one field; shown under that field instead of as a generic error. */
export type SkFieldErr = { field: "caps" | "slip" | "expiry"; message: string } | null;
const field = "w-24 rounded-[6px] border bg-transparent px-1.5 py-0.5 text-right tabular-nums text-ink focus:outline-none aria-[invalid=true]:border-short/70 border-line-2 focus:border-accent/60";

export default function SessionKeyTerms({ terms, defaults = null, onCaps, serverErr = null, locked = false }: { terms?: SkTerms | null; defaults?: SessionKeyDefaults | null; onCaps?: (c: SkCaps) => void; serverErr?: SkFieldErr; locked?: boolean }) {
  const t = terms ?? FALLBACK;
  return <Form key={`${t.perTxCapUsd}|${t.windowCapUsd}|${t.maxSlippagePct}|${t.active}`} t={t} defaults={defaults} onCaps={onCaps} serverErr={serverErr} locked={locked} />;
}

function Form({ t, defaults, onCaps, serverErr, locked }: { t: SkTerms; defaults: SessionKeyDefaults | null; onCaps?: (c: SkCaps) => void; serverErr: SkFieldErr; locked: boolean }) {
  const maxH = defaults?.maxExpiryHours ?? EXPIRY.max;
  const [perTx, setPerTx] = useState(t.perTxCapUsd);
  const [daily, setDaily] = useState(t.windowCapUsd);
  const [slip, setSlip] = useState(String(Number(t.maxSlippagePct.toFixed(2))));
  const [hours, setHours] = useState(String(Math.min(defaults?.defaultExpiryHours ?? EXPIRY.def, maxH)));
  const ro = t.active || locked;
  const capErr = t.active ? null : capsError(perTx, daily) ?? (serverErr?.field === "caps" ? serverErr.message : null);
  const sErr = t.active ? null : slipError(slip) ?? (serverErr?.field === "slip" ? serverErr.message : null);
  const hErr = t.active ? null : expiryError(hours, maxH) ?? (serverErr?.field === "expiry" ? serverErr.message : null);
  const localBad = !!(capsError(perTx, daily) || slipError(slip) || expiryError(hours, maxH));
  useEffect(() => { onCaps?.(t.active || localBad ? null : { perTxCapUsd: perTx, dailyCapUsd: daily, maxSlippagePct: Number(slip), expiresInHours: Number(hours) }); }, [perTx, daily, slip, hours, localBad, t.active, onCaps]);
  const fromApi = defaults != null && Number(daily) === defaults.dailyCapUsd;
  const min = fromApi ? defaults.minSwapUsd : minSwapUsd(daily);
  const input = (id: string, v: string, set: (s: string) => void, label: string, err: string | null, errId: string, re: RegExp, w = "w-24") =>
    <input id={id} aria-label={label} aria-invalid={!!err} aria-describedby={err ? errId : undefined} readOnly={locked} type="text" inputMode="decimal" value={v} onChange={(e) => set(e.target.value.replace(re, ""))} className={`${field} ${w} read-only:opacity-70`} />;
  const usd = (id: string, v: string, set: (s: string) => void, label: string) => t.active
    ? <span className="tabular-nums">{fmtUsd(v)}</span>
    : <span className="flex items-center gap-1">${input(id, v, set, label, capErr, "sk-err", /[^\d.]/g)}</span>;
  const days = Number(hours) >= 24 && Number(hours) % 24 === 0 ? ` · ${Number(hours) / 24} day${Number(hours) === 24 ? "" : "s"}` : "";
  return (
    <div className="grid gap-1.5 text-[13px]">
      <span>A revocable key that can only call this strategy&apos;s swap targets, with a spend cap and expiry.</span>
      <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 font-mono text-[12.5px] text-muted" data-testid="sk-terms">
        <dt><label htmlFor="sk-tx">Per trade</label></dt><dd className="text-ink-2">{usd("sk-tx", perTx, setPerTx, "Per-trade cap in USD")}</dd>
        <dt><label htmlFor="sk-day">Per day</label></dt><dd className="text-ink-2">{usd("sk-day", daily, setDaily, "Per-day cap in USD")}</dd>
        <dt>Min swap</dt><dd className="tabular-nums text-ink-2" data-testid="min-swap" data-source={fromApi ? "api" : "local"}>{min != null && !capErr ? fmtUsd(min.toFixed(2)) : "—"}</dd>
        <dt><label htmlFor="sk-slip">Max slippage</label></dt>
        <dd className="tabular-nums text-ink-2" data-testid="max-slippage">{ro ? pct(t.maxSlippagePct) : <span className="flex items-center gap-1">{input("sk-slip", slip, setSlip, "Max slippage in percent", sErr, "sk-slip-err", /[^\d.]/g, "w-16")}%</span>}</dd>
        {!t.active && <><dt><label htmlFor="sk-exp">Expires in</label></dt>
          <dd className="tabular-nums text-ink-2"><span className="flex items-center gap-1">{input("sk-exp", hours, setHours, "Expiry in hours", hErr, "sk-exp-err", /[^\d]/g, "w-16")}h<span className="text-muted">{days} · max {maxH}h</span></span></dd></>}
      </dl>
      {capErr && <span id="sk-err" role="alert" className="text-[12.5px] text-short">{capErr}</span>}
      {sErr && <span id="sk-slip-err" role="alert" className="text-[12.5px] text-short">{sErr}</span>}
      {hErr && <span id="sk-exp-err" role="alert" className="text-[12.5px] text-short">{hErr}</span>}
    </div>
  );
}
