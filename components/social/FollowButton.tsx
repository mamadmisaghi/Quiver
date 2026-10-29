"use client";
// M5.5: follow / unfollow. Unfollowing ends any copies of this trader (M5.10), so it asks first when you copy them.
import { useState } from "react";
import { api, ApiErr, errCopy, type FollowRes } from "@/lib/api";
export default function FollowButton({ handle, following, copying = false, onChange }: { handle: string; following: boolean; copying?: boolean; onChange?: (r: FollowRes) => void }) {
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (follow: boolean) => {
    setBusy(true); setErr(null); setAsk(false);
    try { const r = follow ? await api.follow(handle) : await api.unfollow(handle); setOn(r.following); onChange?.(r); }
    catch (x) { setErr(x instanceof ApiErr ? errCopy(x.code, x.message) : "Couldn’t update. Try again."); }
    finally { setBusy(false); }
  };
  const base = "btn rounded-full px-4 py-1.5 text-[13px] disabled:opacity-40";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!on ? <button onClick={() => go(true)} disabled={busy} className={`${base} bg-accent font-medium text-bg`} data-testid="follow">{busy ? "Following…" : "Follow"}</button>
        : ask ? <span role="alertdialog" aria-label={`Unfollow ${handle}`} className="inline-flex flex-wrap items-center gap-2 text-[13px]" data-testid="unfollow-confirm">
            <span className="text-ink-2">Unfollowing stops your paper copies of {handle}; they won’t sync again.</span>
            <button onClick={() => go(false)} disabled={busy} autoFocus className={`${base} border border-short/60 text-short`} data-testid="unfollow-yes">Unfollow</button>
            <button onClick={() => setAsk(false)} className={`${base} border border-line-2`}>Keep following</button></span>
        : <button onClick={() => (copying ? setAsk(true) : go(false))} disabled={busy} className={`${base} border border-line-2 hover:bg-white/5`} data-testid="unfollow" aria-pressed="true">{busy ? "Updating…" : "Following"}</button>}
      {err && <span role="alert" className="text-[12.5px] text-short">{err}</span>}
    </span>
  );
}
