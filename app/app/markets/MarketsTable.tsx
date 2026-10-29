"use client";
// Markets from api.markets() (contract Market incl. spark).
import Link from "@/components/Link";
import { useEffect, useRef, useState } from "react";
import VenueMark from "@/components/VenueMark";
import { Th } from "@/components/Wrap";
import { Card, Spark } from "@/components/ui";
import SignInButton from "@/components/SignInButton";
import { onSession } from "@/lib/api/session";
import { api, ApiErr, errCopy, change24hTitle, fmtPct, fmtUsd, fmtSource, SESSION_LABEL, tone, type Market, type Venue } from "@/lib/api";
const TABS = [["All", undefined], ["Stock tokens", "robinhood"], ["Perps", "hyperliquid"], ["Solana", "solana"], ["Predictions", "polymarket"]] as const;
const KIND: Record<string, string> = { token: "Token", perp: "Perp", spot: "Spot", outcome: "Outcome", stock_token: "Stock token" };

function why(m: Market) {
  if (m.venue === "polymarket") return "Watch-only — odds can trigger trades on other venues";
  if (!m.tradable) return "Not tradable right now";
  return null;
}
/** geoRestricted = live trading blocked in your region; paper still works, so it's a muted tag, not a block. */
function liveNote(m: Market) {
  if (m.geoRestricted) return "Live trading isn't available in your region (stock tokens: non-US only). Paper trading works.";
  return null;
}
export default function MarketsTable() {
  const [tab, setTab] = useState<Venue | undefined>(undefined);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Market[] | null>(null);
  const [now, setNow] = useState(0);
  const [err, setErr] = useState<ApiErr | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // final pass: the inline "Sign in" on the auth error must refetch (session change bumps the nonce)
  useEffect(() => onSession(() => setNonce((n) => n + 1)), []);
  // QA P1: every failure lands in an error state with a retry, never an endless loader or an unhandled rejection.
  useEffect(() => {
    let on = true;
    api.markets({ venue: tab, q: q || undefined })
      .then((p) => { if (on) { setErr(null); setRows(p.items); setNow(Date.now()); } })
      .catch((x) => { if (on) { setErr(x instanceof Error ? x : new Error(String(x))); setRows(null); } });
    return () => { on = false; };
  }, [tab, q, nonce]);
  const idx = TABS.findIndex(([, v]) => v === tab);
  const onKey = (e: React.KeyboardEvent) => {
    const n = TABS.length, to = e.key === "ArrowRight" ? (idx + 1) % n : e.key === "ArrowLeft" ? (idx - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return; e.preventDefault(); setTab(TABS[to][1]); tabs.current[to]?.focus();
  };
  const authErr = err instanceof ApiErr && (err.code === "unauthorized" || err.status === 401);
  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter markets by venue" onKeyDown={onKey} className="flex flex-wrap gap-2">
        {TABS.map(([l, v], i) => <button type="button" role="tab" id={`mk-tab-${i}`} aria-controls="mk-panel" aria-selected={tab === v} tabIndex={tab === v ? 0 : -1} ref={(el) => { tabs.current[i] = el; }} key={l} onClick={() => setTab(v)} className={`btn rounded-full px-3.5 py-1.5 text-[13px] ${tab === v ? "bg-white/[.08] text-ink" : "text-muted hover:text-ink"}`}>{l}</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets" aria-label="Search markets" className="ml-auto w-full rounded-full border border-line bg-card px-4 py-1.5 text-[13px] placeholder:text-muted focus:border-accent/50 focus:outline-none sm:w-64" />
      </div>
      <div id="mk-panel" role="tabpanel" aria-labelledby={`mk-tab-${Math.max(0, idx)}`}>
      <Card className={`mt-5 overflow-x-auto ${rows || err ? "" : "min-h-[100dvh]"}`}>
        <table aria-label="Markets" className="rtable w-full min-w-[860px] text-left text-[13.5px]">
          <Th cols={["Market", "Venue", "Type", "Price", "24h", "sr:Trend", "Source", "sr:Actions"]} />
          <tbody>
            {rows?.map((m) => { const w = why(m), ln = liveNote(m); return (
              <tr key={m.id} className="group relative border-b border-line last:border-0 hover:bg-white/[.02]">
                <th scope="row" data-label="Market" className="px-5 py-4 text-left font-normal"><div className="flex items-center gap-1.5 font-mono font-medium"><Link href={`/app/markets/${encodeURIComponent(m.id)}`} data-testid="mk-link" className="hover:text-accent after:absolute after:inset-0">{m.symbol}</Link>{m.isMock === true && <span title="Simulated price, not a real market feed." className="rounded-[4px] border border-line-2 px-1 font-sans text-[12px] font-normal text-muted">Mock</span>}{m.addressVerified === true && <span title={`Token address verified${m.addressChainId ? ` on chain ${m.addressChainId}` : m.venue === "solana" ? " on Solana" : ""}${m.addressSource ? ` · source: ${new URL(m.addressSource).hostname}` : ""}`} className="inline-flex items-center gap-0.5 rounded-[4px] border border-long/25 px-1 font-sans text-[12px] font-normal text-long/80"><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden><path d="M1.5 4.2 3.2 5.8 6.5 2.2" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>Verified</span>}{m.addressVerified === false && <span title="Only a placeholder address is known for this token." className="rounded-[4px] border border-line-2 px-1 font-sans text-[12px] font-normal text-muted">Unverified</span>}</div><div className="text-[12.5px] text-muted">{m.name}{m.venue === "robinhood" && m.marketSession !== "always" && <span className={m.marketSession === "open" ? "text-long" : ""}> · {SESSION_LABEL[m.marketSession]}</span>}</div></th>
                <td data-label="Venue" className="px-5"><VenueMark venue={m.venue} /></td>
                <td data-label="Type" className="px-5 text-muted">{KIND[m.kind] ?? m.kind}</td>
                <td data-label="Price" className="tnum px-5 font-mono">{m.price == null ? <span className="text-muted">waiting</span> : m.kind === "outcome" ? fmtPct(String(Number(m.price) * 100), { dp: 1 }) : fmtUsd(m.price)}</td>
                <td data-label="24h" title={change24hTitle(m.change24hPct, m.change24hSource)} className={`tnum px-5 font-mono ${tone(m.change24hPct)}`}>{fmtPct(m.change24hPct, { sign: true, dp: 1 })}</td>
                <td className="px-5">{m.spark && m.spark.length > 1 ? <Spark pts={m.spark} w={80} h={22} tone={tone(m.change24hPct) === "text-short" ? "short" : "long"} /> : null}</td>
                <td data-label="Source" className="px-5 text-[12.5px] text-muted">{fmtSource(m.priceSource, m.priceAt, now)}{m.priceStale && <div>{m.priceStaleReason === "market_closed" ? "Market closed · last close" : "Stale"}</div>}</td>
                <td className="px-5 text-right">
                  {ln && !w && <span className="relative z-10 mr-3 text-[12.5px] text-muted" title={ln}>Restricted <span aria-hidden>ⓘ</span><span className="sr-only">: {ln}</span></span>}
                  {w ? <span className="relative z-10 text-[12.5px] text-muted" title={w}>{m.venue === "polymarket" ? "Watch-only" : "Unavailable"} <span aria-hidden>ⓘ</span><span className="sr-only">: {w}</span></span>
                    : <Link href={`/app/new?q=${encodeURIComponent("Trade " + m.symbol + " when ")}`} className="relative z-10 text-[13px] text-accent opacity-70 group-hover:opacity-100">Build →</Link>}
                  {w && m.venue === "polymarket" && <Link href={`/app/new?q=${encodeURIComponent("When " + m.name + " odds rise, ")}`} className="relative z-10 ml-3 text-[13px] text-accent opacity-70 group-hover:opacity-100">Use as signal →</Link>}
                </td>
              </tr>); })}
            {rows && !rows.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-muted">No markets match.</td></tr>}
            {!rows && !err && <tr><td colSpan={8} className="px-5 py-10 text-center text-muted" role="status">Loading markets…</td></tr>}
            {err && <tr><td colSpan={8} className="px-5 py-10 text-center">
              <div role="alert" className="text-[14px] text-ink-2">{authErr ? "Sign in to see markets." : err instanceof ApiErr ? errCopy(err.code, err.message) : "Couldn't load markets."}</div>
              <div className="mt-4 flex justify-center gap-3">
                {authErr && <SignInButton />}
                <button type="button" onClick={() => { setErr(null); setNonce((n) => n + 1); }} className="btn rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:border-white/30">Try again</button>
              </div>
            </td></tr>}
          </tbody>
        </table>
      </Card>
      </div>
    </>
  );
}
