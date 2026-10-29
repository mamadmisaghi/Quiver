"use client";
// M5.12 activity feed: GET /v1/activity (scope all|following|mine, opaque cursor, newest first).
// Used on /app/activity (all three scopes) and on /u/[handle] (M5.16: ?handle=@x public trader activity, run always null).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/Link";
import { api, ApiErr, errCopy, type ActivityItem, type ActivityScope } from "@/lib/api";
import { onSession } from "@/lib/api/session";
import HandleLink, { profileHref } from "./Handle";
import SignInButton from "@/components/SignInButton";

const VERB: Record<ActivityItem["kind"], string> = {
  strategy_published: "published", strategy_updated: "updated", run_started: "started a run of", run_stopped: "stopped a run of",
  copy_started: "started copying", copy_detached: "stopped copying",
};
const DOT: Record<ActivityItem["kind"], string> = { strategy_published: "bg-accent", strategy_updated: "bg-accent/60", run_started: "bg-long", run_stopped: "bg-muted", copy_started: "bg-paper", copy_detached: "bg-short/70" };
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
const MODE: Record<string, string> = { paper: "Paper", testnet: "Testnet", live: "Live" };

export default function ActivityFeed({ scope = "all", handle, limit = 20, empty, onNotFound }: { scope?: ActivityScope; handle?: string; limit?: number; empty?: string; onNotFound?: () => void }) {
  const [limited, setLimited] = useState(false);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auth, setAuth] = useState(true);
  const [now, setNow] = useState(0);
  const gen = useRef(0);
  const page = useCallback(async (from: string | null, reset: boolean) => {
    const g = ++gen.current; setBusy(true); setErr(null);
    try {
      const r = await api.activity(handle ? { handle, cursor: from, limit } : { scope, cursor: from, limit });
      const got = r.items, next = r.nextCursor;
      if (g === gen.current) setLimited(!!r.limited);
      if (g !== gen.current) return;
      setNow(Date.now()); setAuth(true); setItems((x) => (reset || !x ? got : x.concat(got.filter((y) => !x.some((z) => z.id === y.id))))); setCursor(next);
    } catch (x) {
      if (g !== gen.current) return;
      if (x instanceof ApiErr && x.status === 404 && handle && onNotFound) { onNotFound(); return; }
      if (x instanceof ApiErr && x.status === 401) setAuth(false); else setErr(x instanceof ApiErr ? errCopy(x.code, x.message) : "Couldn’t load activity.");
      if (reset) setItems((v) => v ?? []);
    } finally { if (g === gen.current) setBusy(false); }
  }, [scope, handle, limit, onNotFound]);
  useEffect(() => { const t = setTimeout(() => page(null, true), 0); const off = onSession(() => page(null, true)); return () => { clearTimeout(t); off(); }; }, [page]);

  if (!auth) return <div className="text-[13.5px] text-muted" data-testid="act-signin"><p className="mb-3">Sign in to see activity.</p><SignInButton /></div>;
  if (items == null) return <div className="grid gap-2" role="status" aria-label="Loading activity">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-[10px] bg-white/[.04] motion-reduce:animate-none" />)}</div>;
  if (limited) return <p className="py-3 text-[14px] text-muted" data-testid="act-limited">No public strategies yet.</p>;
  return (
    <div data-testid="activity" data-scope={handle ? "handle" : scope}>
      {items.length ? <ol className="divide-y divide-line" data-testid="act-list">{items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 py-3 text-[13.5px]" data-motion="rise" data-testid="act-item" data-kind={a.kind}>
          <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[a.kind]}`} />
          <div className="min-w-0 flex-1">
            <p className="break-words text-ink-2">
              {a.actor.isYou ? <span className="text-ink">You</span> : <HandleLink handle={a.actor.handle} className="text-ink" />} {VERB[a.kind]}{" "}
              <span className="font-medium text-ink">{a.strategy.name}</span>
              {a.strategy.version != null && <span className="tnum font-mono text-[12px] text-muted"> v{a.strategy.version}</span>}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              <time dateTime={a.at} title={new Date(a.at).toUTCString()} className="tnum">{now ? ago(a.at, now) : ""}</time>
              {a.run && !handle && <><span>{MODE[a.run.mode] ?? a.run.mode} · {a.run.status}</span><Link href={`/app/run/${encodeURIComponent(a.run.runId)}`} className="-my-3 inline-block py-3 underline-offset-4 hover:text-ink hover:underline">Open run</Link></>}
              {!a.run && !handle && a.strategy.publicStrategyId && !a.actor.isYou && <Link href={profileHref(a.actor.handle)} className="underline-offset-4 hover:text-ink hover:underline">View profile</Link>}
            </p>
          </div>
        </li>))}</ol>
        : !err && <p className="py-6 text-[14px] text-muted" data-testid="act-empty">{empty ?? (scope === "following" ? "Nothing yet from the traders you follow. Follow someone on Traders to see what they publish." : scope === "mine" ? "No runs or copies yet." : "No activity yet.")}</p>}
      {err && <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 text-[13px]" data-testid="act-err"><span className="text-short">{err}</span><button onClick={() => page(cursor, !items.length)} className="btn rounded-full border border-line-2 px-3 py-1 text-[12.5px] hover:bg-white/5">Try again</button></div>}
      {cursor && !err && <button onClick={() => page(cursor, false)} disabled={busy} className="btn mt-3 rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:bg-white/5 disabled:opacity-50" data-testid="act-more">{busy ? "Loading…" : "Load more"}</button>}
    </div>
  );
}
