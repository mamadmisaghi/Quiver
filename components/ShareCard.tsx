"use client";
// M4.8: share a stopped run's card publicly (POST/DELETE /v1/runs/:id/card/share). Link points at the web page /c/<token>.
import { useState } from "react";
import { api, errOf } from "@/lib/api";

type S = { k: "idle" } | { k: "busy" } | { k: "shared"; url: string; copied?: boolean; confirm?: boolean; revoking?: boolean } | { k: "revoked" };
export default function ShareCard({ runId }: { runId: string }) {
  const [s, setS] = useState<S>({ k: "idle" });
  const [err, setErr] = useState<string | null>(null);
  const share = () => {
    setS({ k: "busy" }); setErr(null);
    api.shareCard(runId).then((r) => setS({ k: "shared", url: `${location.origin}/c/${r.token}` }), (e) => { setS({ k: "idle" }); setErr(errOf(e, "Couldn’t create a link.")); });
  };
  const copy = (url: string) => navigator.clipboard?.writeText(url).then(() => setS({ k: "shared", url, copied: true }), () => setErr("Copy failed. Select the link and copy it."));
  const revoke = (url: string) => {
    setS({ k: "shared", url, revoking: true }); setErr(null);
    api.revokeCard(runId).then(() => setS({ k: "revoked" }), (e) => { setS({ k: "shared", url }); setErr(errOf(e, "Couldn’t revoke the link.")); });
  };
  const btn = "btn rounded-full border border-line-2 px-3.5 py-1.5 text-[13px] text-ink-2 hover:border-white/30 hover:text-ink disabled:opacity-50";
  return (
    <div className="border-t border-line px-5 py-3.5" data-testid="share-card" data-motion="share-card">
      {(s.k === "idle" || s.k === "busy" || s.k === "revoked") && (
        <div className="flex flex-wrap items-center gap-3">
          <button className={btn} onClick={share} disabled={s.k === "busy"}>{s.k === "busy" ? "Creating link…" : s.k === "revoked" ? "Share again" : "Share"}</button>
          <span className="text-[12.5px] text-muted" role="status">{s.k === "revoked" ? "Link revoked. Anyone opening it now sees “not shared”." : "Makes a public page with percentages only. No dollar amounts."}</span>
        </div>
      )}
      {s.k === "shared" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <input readOnly value={s.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} className="tnum min-w-0 flex-1 basis-[14rem] rounded-md border border-line-2 bg-bg px-3 py-1.5 font-mono text-[12.5px] text-ink" data-testid="share-url" />
            <button className={btn} onClick={() => copy(s.url)}>{s.copied ? "Copied" : "Copy"}</button>
            <a className={btn} href={s.url} target="_blank" rel="noopener">Open</a>
          </div>
          {!s.confirm ? (
            <div><button className="btn text-[12.5px] text-muted underline hover:text-short" onClick={() => setS({ ...s, confirm: true })}>Revoke link</button></div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]" role="alertdialog" aria-label="Confirm revoke">
              <span className="text-ink-2">Revoke? The link stops working for everyone.</span>
              <button className="btn rounded-full bg-short/15 px-3 py-1 text-short disabled:opacity-50" onClick={() => revoke(s.url)} disabled={s.revoking}>{s.revoking ? "Revoking…" : "Yes, revoke"}</button>
              <button className="btn rounded-full px-3 py-1 text-ink-2" onClick={() => setS({ k: "shared", url: s.url })} disabled={s.revoking}>Keep it</button>
            </div>
          )}
        </div>
      )}
      {err && <p className="mt-2 text-[12.5px] text-short" role="alert">{err}</p>}
    </div>
  );
}
