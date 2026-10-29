"use client";
// M5.5 settings: edit my profile, who I follow, and my paper copies (sync, + M5.10 detached state and 403 reasons).
import { useEffect, useState } from "react";
import { api, ApiErr, reasonOf, errCopy, fmtAgo, type CopyView, type FollowingRes, type Profile } from "@/lib/api";
import { Card, Pill } from "@/components/ui";
import HandleLink from "@/components/social/Handle";
import FollowButton from "@/components/social/FollowButton";
const say = (x: unknown, d: string) => (x instanceof ApiErr ? (x.status === 422 ? x.message : errCopy(x.code, x.message)) : d);

export function ProfileCard() {
  const [p, setP] = useState<Profile | null>(null);
  const [name, setName] = useState(""); const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.myProfile().then((x) => { setP(x); setName(x.displayName ?? ""); setBio(x.bio ?? ""); }).catch((x) => setErr(say(x, "Couldn’t load your profile."))); }, []);
  const save = async () => { setBusy(true); setMsg(null); setErr(null);
    try { const x = await api.putMyProfile({ displayName: name.trim() || null, bio: bio.trim() || null }); setP(x); setName(x.displayName ?? ""); setBio(x.bio ?? ""); setMsg("Saved."); }
    catch (x) { setErr(say(x, "Couldn’t save.")); } finally { setBusy(false); } };
  return (
    <Card className="p-6" id="profile" data-testid="profile-card">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">Your profile</h2>{p && <HandleLink handle={p.handle} className="text-[13px] text-muted" />}</div>
      <p className="mt-1 text-[13px] text-muted">Shown on your public page once you publish a strategy.</p>
      <label htmlFor="pf-name" className="mt-4 block text-[12.5px] text-muted">Display name</label>
      <input id="pf-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-[8px] border border-line-2 bg-bg px-3 py-2 outline-none focus:border-accent" />
      <label htmlFor="pf-bio" className="mt-3 block text-[12.5px] text-muted">Bio <span className="tnum">({bio.length}/280)</span></label>
      <textarea id="pf-bio" value={bio} maxLength={280} rows={3} onChange={(e) => setBio(e.target.value)} className="mt-1.5 w-full resize-y rounded-[8px] border border-line-2 bg-bg px-3 py-2 outline-none focus:border-accent" />
      <div className="mt-3 flex flex-wrap items-center gap-3"><button onClick={save} disabled={busy || !p} className="btn rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-bg disabled:opacity-40" data-testid="pf-save">{busy ? "Saving…" : "Save profile"}</button>
        {msg && <span role="status" className="text-[13px] text-long" data-testid="pf-ok">{msg}</span>}{err && <span role="alert" className="text-[13px] text-short">{err}</span>}</div>
    </Card>
  );
}

export function FollowingCard() {
  const [f, setF] = useState<FollowingRes | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.following().then(setF).catch((x) => setErr(say(x, "Couldn’t load who you follow."))); }, []);
  return (
    <Card className="p-6" id="following" data-testid="following-card">
      <h2 className="font-medium">Following</h2>
      {err ? <p role="alert" className="mt-3 text-[13px] text-short">{err}</p> : !f ? <div className="mt-3 h-10 animate-pulse rounded-[8px] bg-white/[.04]" role="status" aria-label="Loading" />
        : f.items.length ? <ul className="mt-3 divide-y divide-line text-[13.5px]" data-testid="following-list">{f.items.map((x) => (
            <li key={x.handle} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><span className="min-w-0"><HandleLink handle={x.handle} />{x.displayName && <span className="ml-2 text-muted">{x.displayName}</span>}</span><span className="tnum text-[12.5px] text-muted">{x.strategies} public</span></li>))}</ul>
        : <p className="mt-3 text-[13.5px] text-muted">You don’t follow anyone yet. Find traders on the leaderboard.</p>}
    </Card>
  );
}

function CopyRow({ c0 }: { c0: CopyView }) {
  const [c, setC] = useState(c0); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [refollow, setRefollow] = useState(false);
  const sync = async () => { setBusy(true); setMsg(null); setErr(null); setRefollow(false);
    try { const x = await api.syncCopy(c.strategyId); setMsg(x.sourceVersion > c.sourceVersion ? `Synced to v${x.sourceVersion}.` : "Already up to date."); setC(x); }
    catch (x) { const reason = x instanceof ApiErr ? reasonOf(x) : undefined;
      if (reason === "detached") { setC({ ...c, detached: true, detachedAt: c.detachedAt ?? new Date().toISOString() }); setErr(null); }
      else if (reason === "not_following") { setRefollow(true); }
      else setErr(say(x, "Couldn’t sync.")); }
    finally { setBusy(false); } };
  return (
    <li className="grid gap-2 py-3" data-testid="copy-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0"><span className="font-medium">{c.sourceName}</span> <span className="text-muted">by</span> <HandleLink handle={c.sourceHandle} className="text-[13px]" /></span>
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="paper">Paper</Pill>
          {c.detached ? <Pill tone="muted">Ended</Pill> : c.latestSourceVersion === null ? <Pill tone="muted">Source unpublished</Pill> : c.behind ? <Pill tone="accent">Update available</Pill> : <Pill tone="long">Up to date</Pill>}
        </span>
      </div>
      <p className="tnum text-[12.5px] text-muted">v{c.sourceVersion}{c.latestSourceVersion !== null && c.latestSourceVersion !== c.sourceVersion ? ` · source v${c.latestSourceVersion}` : ""} · synced {fmtAgo(c.syncedAt)}{c.runStatus ? ` · run ${c.runStatus}` : ""}</p>
      {c.detached ? <p className="text-[13px] text-ink-2" data-testid="copy-detached">This copy ended{c.detachedAt ? ` ${fmtAgo(c.detachedAt)}` : ""} when you unfollowed {c.sourceHandle}. Its paper run was stopped and it won’t sync again — copy the strategy again to start fresh.</p>
        : <div className="flex flex-wrap items-center gap-2">
            <button onClick={sync} disabled={busy || c.latestSourceVersion === null} className="btn rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:bg-white/5 disabled:opacity-40" data-testid="copy-sync">{busy ? "Syncing…" : "Sync"}</button>
            {c.runId && <a href={`/app/run/${c.runId}`} className="text-[13px] text-muted hover:text-ink">Open run →</a>}
            {msg && <span role="status" className="text-[13px] text-long" data-testid="copy-sync-ok">{msg}</span>}
          </div>}
      {refollow && <div role="status" className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="copy-refollow"><span className="text-ink-2">Follow {c.sourceHandle} again to sync this copy.</span><FollowButton handle={c.sourceHandle} following={false} onChange={(r) => { if (r.following) setRefollow(false); }} /></div>}
      {err && <p role="alert" className="text-[13px] text-short">{err}</p>}
    </li>
  );
}

export function CopiesCard() {
  const [items, setItems] = useState<CopyView[] | null>(null); const [notice, setNotice] = useState(""); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.copies().then((r) => { setItems(r.items); setNotice(r.notice); }).catch((x) => setErr(say(x, "Couldn’t load your copies."))); }, []);
  return (
    <Card className="p-6" id="copies" data-testid="copies-card">
      <h2 className="font-medium">My copies</h2>
      {notice && <p className="mt-1 text-[13px] text-muted">{notice}</p>}
      {err ? <p role="alert" className="mt-3 text-[13px] text-short">{err}</p> : !items ? <div className="mt-3 h-10 animate-pulse rounded-[8px] bg-white/[.04]" role="status" aria-label="Loading" />
        : items.length ? <ul className="mt-2 divide-y divide-line text-[13.5px]" data-testid="copies-list">{items.map((c) => <CopyRow key={c.strategyId} c0={c} />)}</ul>
        : <p className="mt-3 text-[13.5px] text-muted">No copies yet. Follow a trader, then copy one of their public strategies to paper.</p>}
    </Card>
  );
}
