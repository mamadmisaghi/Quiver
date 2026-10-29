"use client";
// M4.4: GET /v1/runs/:id/replay → frames + chapters + digest, with a scrubber.
// Motion hooks for Ellis: root [data-motion="replay"] carries --replay-progress (0..1) and data-frame; the cursor line
// is [data-motion="replay-cursor"], the frame panel [data-motion="replay-frame"] (keyed per frame). A window event
// "quiver:replay-frame" {detail:{runId,i,ts}} fires on every frame change. No animation is built in here; under
// prefers-reduced-motion "Play" is replaced by step buttons only (auto-advance off).
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "@/components/Link";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import Loading from "@/components/Loading";
import { Card } from "@/components/ui";
import { api, fmtUsd, fmtNum, fmtInstrument, EVENT_LABEL, type Replay } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import ShareReplay from "@/components/ShareReplay";

const FRAME: [number, string][] = [[60_000, "1 min"], [300_000, "5 min"], [3_600_000, "1 h"]];
const t = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const btn = "btn rounded-full border border-line-2 px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-white/5 disabled:opacity-40";

const RM = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore((cb) => { const m = matchMedia(RM); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }, () => matchMedia(RM).matches, () => false);
}

function Chart({ r, i }: { r: Pick<Replay, "frames" | "chapters">; i: number }) {
  const W = 600, H = 120, n = r.frames.length;
  const ys = r.frames.map((f) => (f.equityUsd == null ? null : Number(f.equityUsd)));
  const vals = ys.filter((v): v is number => v != null); const mn = Math.min(...vals), mx = Math.max(...vals);
  const x = (k: number) => (n < 2 ? W / 2 : (k / (n - 1)) * W), y = (v: number) => H - 6 - ((v - mn) / (mx - mn || 1)) * (H - 12);
  let d = ""; ys.forEach((v, k) => { if (v != null) d += `${d ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`; });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[120px] w-full" aria-hidden>
      {r.chapters.map((c) => <line key={c.seq} x1={x(c.frame)} x2={x(c.frame)} y1={0} y2={H} stroke="var(--q-amber)" strokeOpacity=".25" vectorEffect="non-scaling-stroke" />)}
      {d && <path d={d} fill="none" stroke="var(--q-up)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      <line data-motion="replay-cursor" x1={x(i)} x2={x(i)} y1={0} y2={H} stroke="currentColor" className="text-ink" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>);
}

export default function ReplayView({ runId }: { runId: string }) {
  const [frameMs, setFrameMs] = useState(60_000);
  const q = useQ(() => api.replay(runId, { frameMs, maxFrames: 500 }), [runId, frameMs]);
  return (
    <Wrap>
      <PageHeader title="Run replay" sub="Step through what this paper run saw and did, frame by frame. Built from the stored run log." />
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
        <Link href={`/app/run/${runId}`} className="underline text-ink-2">Back to run</Link>
        <span className="text-muted">·</span>
        <label className="flex items-center gap-2 text-muted">Frame <select value={frameMs} onChange={(e) => setFrameMs(Number(e.target.value))} className="rounded-md border border-line-2 bg-card px-2 py-1 text-ink" data-testid="rp-frame-ms">{FRAME.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      {!q.data ? <Loading h={280} q={q} /> : <ReplayPlayer r={q.data} id={runId} />}
      {q.data && q.data.frames.length > 0 && <ShareReplay runId={runId} frameMs={frameMs} />}
    </Wrap>
  );
}

/** M5.7: shared by the owner view and the public /r/[token] page (frozen snapshot, no run id). */
export function ReplayPlayer({ r, id }: { r: Replay | Omit<Replay, "runId">; id: string }) {
  const runId = id; const n = r.frames.length;
  const [i, setI] = useState(0); const [play, setPlay] = useState(false); const reduced = useReducedMotion();
  const [seen, setSeen] = useState(r.digest);
  if (r.digest !== seen) { setSeen(r.digest); setI(0); setPlay(false); }
  useEffect(() => { if (!play || reduced || !n) return; const tm = setInterval(() => setI((k) => { if (k >= n - 1) { setPlay(false); return k; } return k + 1; }), 700); return () => clearInterval(tm); }, [play, reduced, n]);
  const f = r.frames[Math.min(i, n - 1)];
  useEffect(() => { if (f) window.dispatchEvent(new CustomEvent("quiver:replay-frame", { detail: { runId, i: f.i, ts: f.ts } })); }, [f, runId]);
  const chapters = useMemo(() => r.chapters, [r]);
  const prevCh = chapters.filter((c) => c.frame < i).at(-1), nextCh = chapters.find((c) => c.frame > i);
  const ticks = f ? (f.i > 0 ? f.lastSeq - (r.frames[Math.min(i, n - 1) - 1]?.lastSeq ?? 0) : f.lastSeq + 1) : 0;
  return (<>
      {n === 0 ? <Card className="mt-5 p-6 text-[13.5px] text-muted">Nothing recorded for this run yet.</Card> : (
        <div data-motion="replay" data-frame={f!.i} style={{ ["--replay-progress" as string]: n > 1 ? i / (n - 1) : 1 }} data-testid="replay">
          <Card className="mt-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[12px] tabular-nums text-muted">
              <span>{t(r.startTs)} → {t(r.endTs)}</span>
              <span title={r.digest}>{r.totalFrames} frames{r.truncated ? ` (showing first ${n})` : ""} · {r.digest.slice(0, 15)}…</span>
            </div>
            <div className="mt-3"><Chart r={r} i={i} /></div>
            <label htmlFor="rp-scrub" className="sr-only">Frame</label>
            <input id="rp-scrub" type="range" min={0} max={n - 1} step={1} value={i} onChange={(e) => { setPlay(false); setI(Number(e.target.value)); }} aria-valuetext={`Frame ${i + 1} of ${n}, ${t(f!.ts)}`} className="mt-2 w-full accent-[var(--q-amber)]" data-testid="rp-scrub" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className={btn} onClick={() => setI((k) => Math.max(0, k - 1))} disabled={i === 0} aria-label="Prev frame"><span aria-hidden>‹ </span>Prev</button>
              {!reduced && <button className={btn} onClick={() => { if (i >= n - 1) setI(0); setPlay((p) => !p); }} aria-pressed={play} data-testid="rp-play">{play ? "Pause" : "Play"}</button>}
              <button className={btn} onClick={() => setI((k) => Math.min(n - 1, k + 1))} disabled={i >= n - 1} aria-label="Next frame">Next<span aria-hidden> ›</span></button>
              <span className="mx-1 h-4 w-px bg-line" aria-hidden />
              <button className={btn} onClick={() => prevCh && setI(prevCh.frame)} disabled={!prevCh}>‹ Chapter</button>
              <button className={btn} onClick={() => nextCh && setI(nextCh.frame)} disabled={!nextCh}>Chapter ›</button>
              <span className="ml-auto font-mono text-[12px] tabular-nums text-muted" aria-live="polite">{i + 1} / {n}</span>
            </div>
          </Card>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_320px]">
            <Card className="p-5" data-motion="replay-frame" key={f!.i} data-testid="rp-frame">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-medium">{t(f!.ts)}</h2><span className="font-mono text-[15px] tabular-nums">{fmtUsd(f!.equityUsd)}</span></div>
              <div className="mt-1 font-mono text-[12px] tabular-nums text-muted">{f!.counts.fills} fills · {f!.counts.rejected} rejected · {f!.counts.halts} halts · {Math.max(0, ticks)} log entries</div>
              <h3 className="mt-4 text-[12px] text-muted">Positions</h3>
              {f!.positions.length === 0 ? <p className="mt-1 text-[13px] text-ink-2">Flat.</p> : (
                <ul className="mt-1 grid gap-1 font-mono text-[13px] tabular-nums">{f!.positions.map((p) => <li key={p.instrument} className="flex justify-between gap-3"><span className="font-sans text-ink">{fmtInstrument(p.instrument)}</span><span className="text-ink-2">{fmtNum(p.qty, 4)} @ {fmtUsd(p.avgEntry)}</span></li>)}</ul>)}
              <h3 className="mt-4 text-[12px] text-muted">What happened</h3>
              {f!.events.length === 0 ? <p className="mt-1 text-[13px] text-ink-2">Only signal checks in this frame.</p> : (
                <ol className="mt-1 grid gap-1.5 text-[13px]">{f!.events.map((e) => <li key={e.seq} className="grid grid-cols-[auto_1fr] gap-x-3"><span className={e.type === "fill" ? "text-paper" : e.type === "rejected" || e.type === "risk_halt" || e.type === "error" ? "text-short" : "text-muted"}>{EVENT_LABEL[e.type] ?? e.type}</span><span className="break-words text-ink-2">{e.summary}</span></li>)}</ol>)}
            </Card>
            <Card className="p-5">
              <h2 className="font-medium">Chapters</h2>
              {chapters.length === 0 ? <p className="mt-2 text-[13px] text-muted">No chapters yet.</p> : (
                <ol className="mt-2 grid gap-1" data-testid="rp-chapters">{chapters.map((c) => (
                  <li key={c.seq}><button onClick={() => { setPlay(false); setI(c.frame); }} aria-current={c.frame === i ? "step" : undefined} className={`w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-white/5 ${c.frame === i ? "bg-white/5 text-ink" : "text-ink-2"}`}><span className="font-mono text-[11.5px] tabular-nums text-muted">#{c.frame + 1}</span> {c.summary}</button></li>))}</ol>)}
            </Card>
          </div>
        </div>)}
  </>);
}
