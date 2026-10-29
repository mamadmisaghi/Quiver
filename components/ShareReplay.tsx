"use client";
// M5.7 share a frozen replay link (+ optional video render). M5.15: stub renderer → not_configured; local ffmpeg → done with
// same-origin media paths resolved against the API origin (clientMedia). 429 = render queue full, shown calmly.
// M5.10: titles are plain text and are only ever rendered as React text nodes (never innerHTML).
import { useEffect, useState } from "react";
import { api, ApiErr, errCopy, fmtAgo, type ReplayShareView, type RenderJob } from "@/lib/api";
import { Card, Pill } from "@/components/ui";
import { clientMedia } from "@/lib/api/media";
const btn = "btn rounded-full border border-line-2 px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-white/5 disabled:opacity-40";
const ASPECT = [["9:16", "Vertical 9:16"], ["16:9", "Wide 16:9"], ["1:1", "Square 1:1"]] as const;
type Aspect = (typeof ASPECT)[number][0];
const say = (x: unknown, d: string) => (x instanceof ApiErr ? (x.code === "validation_failed" || x.code === "conflict" || x.code === "limit_exceeded" ? x.message : errCopy(x.code, x.message)) : d);
export const shareUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/r/${encodeURIComponent(token)}`;
const RENDER: Record<RenderJob["status"], [string, "muted" | "accent" | "long" | "short"]> = {
  none: ["No video", "muted"], queued: ["Video queued", "accent"], rendering: ["Rendering…", "accent"], done: ["Video ready", "long"], failed: ["Render failed", "short"], not_configured: ["Video not set up", "muted"],
};

function Row({ x0, onChange }: { x0: ReplayShareView; onChange: () => void }) {
  const [x, setX] = useState(x0); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false); const [ask, setAsk] = useState(false);
  const url = shareUrl(x.token);
  const [full, setFull] = useState(false);
  const render = async () => { setBusy(true); setErr(null); setFull(false); try { setX({ ...x, render: await api.renderReplay(x.token, { aspect: x.render.spec?.aspect ?? "9:16" }) }); } catch (e) { if (e instanceof ApiErr && e.status === 429) setFull(true); else setErr(say(e, "Couldn’t start the render.")); } finally { setBusy(false); } };
  const video = clientMedia(x.render.videoUrl), poster = clientMedia(x.render.posterUrl);
  const revoke = async () => { setBusy(true); setErr(null); try { await api.revokeReplay(x.token); setX({ ...x, revokedAt: new Date().toISOString() }); setAsk(false); onChange(); } catch (e) { setErr(say(e, "Couldn’t revoke the link.")); } finally { setBusy(false); } };
  // Poll while a render is in flight so "queued" settles to done / failed / not_configured.
  const inFlight = !x.revokedAt && (x.render.status === "queued" || x.render.status === "rendering");
  useEffect(() => {
    if (!inFlight) return; let off = false;
    const t = setInterval(() => { api.myReplays().then((l) => { const n = l.items.find((i) => i.token === x.token); if (n && !off) setX(n); }).catch(() => {}); }, 2000);
    return () => { off = true; clearInterval(t); };
  }, [inFlight, x.token]);
  const [label, tone] = RENDER[x.render.status];
  return (
    <li className="grid gap-2 py-3" data-testid="share-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words font-medium" data-testid="share-title">{x.title}</span>
        <span className="flex flex-wrap gap-2">{x.revokedAt ? <Pill tone="muted">Revoked</Pill> : <Pill tone={tone}>{label}</Pill>}</span>
      </div>
      <p className="tnum text-[12.5px] text-muted">{x.frames} frames · created {fmtAgo(x.createdAt)}{x.revokedAt ? ` · revoked ${fmtAgo(x.revokedAt)}` : ""}</p>
      {!x.revokedAt && <>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`u-${x.token}`}>Share link</label>
          <input id={`u-${x.token}`} readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 basis-[220px] rounded-[8px] border border-line-2 bg-bg px-3 py-1.5 font-mono text-[12px] text-ink-2" data-testid="share-url" />
          <button className={btn} onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setErr("Couldn’t copy. Select the link and copy it."); } }} data-testid="share-copy">{copied ? "Copied" : "Copy link"}</button>
          <a className={btn} href={`/r/${encodeURIComponent(x.token)}`} target="_blank" rel="noopener">Open</a>
        </div>
        {x.render.status === "not_configured" && <p className="text-[12.5px] text-muted" data-testid="share-render-nc">Video rendering isn’t set up on this server yet. The link still works as an interactive replay.</p>}
        {x.render.status === "failed" && x.render.error && <p className="text-[12.5px] text-short">{x.render.error}</p>}
        {full && <p role="status" className="text-[12.5px] text-muted" data-testid="share-render-full">The video queue is full right now. Try again in a few minutes; the link works meanwhile.</p>}
        {x.render.status === "done" && video && <div className="grid gap-2" data-testid="share-video">
          <video controls playsInline preload="none" src={video} poster={poster ?? undefined} aria-label={`Replay video: ${x.title}`} className="max-h-[50vh] w-full max-w-[420px] rounded-[12px] bg-black" />
          <a href={video} download className="text-[13px] text-ink-2 underline" data-testid="share-download">Download video (MP4)</a></div>}
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={render} disabled={busy || x.render.status === "queued" || x.render.status === "rendering"} data-testid="share-render">{x.render.status === "none" ? "Render video" : "Render again"}</button>
          {!ask ? <button className={btn} onClick={() => setAsk(true)} data-testid="share-revoke">Revoke link</button>
            : <span role="alertdialog" aria-label="Revoke this link?" className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-ink-2">Anyone with the link loses access.</span>
                <button className="btn rounded-full bg-short/90 px-3.5 py-1.5 text-[13px] font-medium text-bg" onClick={revoke} disabled={busy} data-testid="share-revoke-yes">Revoke</button>
                <button className={btn} onClick={() => setAsk(false)}>Keep</button></span>}
        </div>
      </>}
      {err && <p role="alert" className="text-[13px] text-short">{err}</p>}
    </li>
  );
}

export default function ShareReplay({ runId, frameMs }: { runId: string; frameMs: number }) {
  const [title, setTitle] = useState(""); const [aspect, setAspect] = useState<Aspect>("9:16"); const [video, setVideo] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<ReplayShareView[] | null>(null); const [k, setK] = useState(0);
  useEffect(() => { api.myReplays().then((r) => setItems(r.items.filter((x) => x.runId === runId))).catch(() => setItems([])); }, [runId, k]);
  const create = async () => {
    setBusy(true); setErr(null);
    try { const x = await api.shareReplay(runId, { ...(title.trim() ? { title: title.trim() } : {}), frameMs, maxFrames: 300, ...(video ? { render: { aspect } } : {}) }); setItems((s) => [x, ...(s ?? [])]); setTitle(""); }
    catch (e) { setErr(say(e, "Couldn’t create the link.")); } finally { setBusy(false); }
  };
  return (
    <Card className="mt-3 p-5" data-testid="share-replay">
      <h2 className="font-medium">Share this replay</h2>
      <p className="mt-1 text-[13px] text-muted">Creates a public, read-only link to a frozen copy of this replay. It shows your handle and strategy name, never your account or run id. Paper and testnet runs only.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div><label htmlFor="sr-title" className="block text-[12.5px] text-muted">Title <span className="tnum">({[...title].length}/80)</span></label>
          <input id="sr-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Optional — defaults to the strategy name" className="mt-1.5 w-full rounded-[8px] border border-line-2 bg-bg px-3 py-2 outline-none focus:border-accent" /></div>
        <div><label htmlFor="sr-aspect" className="block text-[12.5px] text-muted">Video shape</label>
          <select id="sr-aspect" value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)} disabled={!video} className="mt-1.5 w-full rounded-[8px] border border-line-2 bg-card px-3 py-2 disabled:opacity-50">{ASPECT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} className="accent-[var(--q-amber)]" data-testid="sr-video" /> Also render a short video</label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={create} disabled={busy} className="btn rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-bg disabled:opacity-40" data-testid="sr-create">{busy ? "Creating…" : "Create link"}</button>
        {err && <span role="alert" className="text-[13px] text-short" data-testid="sr-err">{err}</span>}
      </div>
      {items && items.length > 0 && <ul className="mt-4 divide-y divide-line border-t border-line text-[13.5px]" data-testid="share-list">{items.map((x) => <Row key={x.token + (x.revokedAt ?? "")} x0={x} onChange={() => setK((n) => n + 1)} />)}</ul>}
    </Card>
  );
}
