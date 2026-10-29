"use client";
// M5.5: copy a public strategy into your own PAPER run. Server rules: follow the author first (403 details.handle),
// one copy per source (409), not your own strategy or a copy of it (422). Paper only; nothing live.
import { useEffect, useRef, useState } from "react";
import Link from "@/components/Link";
import { api, ApiErr, errCopy, type CopyView } from "@/lib/api";
import FollowButton from "./FollowButton";
export default function CopyDialog({ publicStrategyId, name, handle, onClose }: { publicStrategyId: string; name: string; handle: string; onClose: () => void }) {
  const [eq, setEq] = useState("10000");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needFollow, setNeedFollow] = useState<string | null>(null);
  const [dup, setDup] = useState(false);
  const [done, setDone] = useState<CopyView | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) { const f = [...ref.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input")]; if (!f.length) return; const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } else if (!ref.current.contains(document.activeElement)) { e.preventDefault(); a.focus(); } }
    }; window.addEventListener("keydown", k); ref.current?.querySelector<HTMLElement>("input,button")?.focus(); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const valid = /^\d{2,7}(\.\d{1,2})?$/.test(eq) && Number(eq) >= 100;
  const go = async () => {
    setBusy(true); setErr(null); setNeedFollow(null); setDup(false);
    try { setDone(await api.copy({ publicStrategyId, mode: "paper", startingEquityUsd: eq })); }
    catch (x) {
      if (x instanceof ApiErr && x.status === 403) setNeedFollow((x.details as { handle?: string } | undefined)?.handle ?? handle);
      else if (x instanceof ApiErr && x.status === 409) setDup(true);
      else setErr(x instanceof ApiErr ? (x.status === 422 ? x.message : errCopy(x.code, x.message)) : "Couldn’t copy. Try again.");
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="copy-h" onClick={(e) => e.stopPropagation()} className="w-full max-w-[440px] rounded-[14px] border border-line-2 bg-bg-2 p-6 text-[14px]" data-testid="copy-dialog">
        <h2 id="copy-h" className="text-[17px] font-medium">Copy “{name}”</h2>
        <p className="mt-1 text-[13px] text-muted">by <span className="font-mono">{handle}</span></p>
        <p className="mt-4 rounded-[8px] border border-line px-3 py-2 text-[13px] text-ink-2" data-testid="copy-paper">Paper only. It mirrors this strategy’s rules in your own paper run — no real funds, no live orders.</p>
        {done ? <div role="status" className="mt-5 grid gap-3" data-testid="copy-done">
            <p>Copied. Your paper run {done.runId ? "has started" : "is ready"}.</p>
            <div className="flex flex-wrap gap-2">{done.runId && <Link href={`/app/run/${done.runId}`} className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg">Open run →</Link>}<Link href="/app/settings#copies" className="btn rounded-full border border-line-2 px-4 py-2 text-[13px]">My copies</Link><button onClick={onClose} className="btn rounded-full px-4 py-2 text-[13px] text-muted">Close</button></div>
          </div>
        : <>
          <label htmlFor="copy-eq" className="mt-5 block text-[12.5px] text-muted">Starting paper equity (USD)</label>
          <input id="copy-eq" inputMode="decimal" value={eq} onChange={(e) => setEq(e.target.value.trim())} className="tnum mt-2 w-full rounded-[8px] border border-line-2 bg-bg px-3 py-2 font-mono outline-none focus:border-accent" aria-invalid={!valid} />
          {!valid && <p className="mt-1 text-[12.5px] text-short">Enter at least $100.</p>}
          {needFollow && <div role="status" className="mt-4 grid gap-2 text-[13px]" data-testid="copy-need-follow"><span className="text-ink-2">Follow {needFollow} first to copy their strategies.</span>
            <FollowButton handle={needFollow} following={false} onChange={(r) => { if (r.following) setNeedFollow(null); }} /></div>}
          {dup && <p role="status" className="mt-4 text-[13px] text-ink-2" data-testid="copy-dup">You already copy this strategy. <Link href="/app/settings#copies" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-current">Sync it in My copies</Link>.</p>}
          {err && <p role="alert" className="mt-4 text-[13px] text-short" data-testid="copy-err">{err}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button onClick={onClose} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px]">Cancel</button>
            <button onClick={go} disabled={busy || !valid || !!needFollow} className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-40" data-testid="copy-go">{busy ? "Copying…" : "Copy to paper"}</button>
          </div></>}
      </div>
    </div>
  );
}
