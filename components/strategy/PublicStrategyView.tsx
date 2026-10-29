"use client";
// Public strategy detail: GET /public/strategies/:id (thesis, rules, graph, lineage) + fork (POST …/fork) and copy-to-paper.
// Paper only. Forking saves a private editable copy; it never starts a run or touches funds.
import Link from "@/components/Link";
import { useState } from "react";
import StrategyGraph from "@/components/StrategyGraph";
import VenueMark from "@/components/VenueMark";
import Loading from "@/components/Loading";
import SignInButton from "@/components/SignInButton";
import HandleLink from "@/components/social/Handle";
import CopyDialog from "@/components/social/CopyDialog";
import { Pill, Spark } from "@/components/ui";
import { api, ApiErr, errCopy, fmtAgo, fmtPct, tone, strategyEdges, type GNode, type PublicStrategyDetail, type StrategyRecord } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";

const RULES = [["watch", "Signals"], ["when", "Trigger"], ["do", "Actions"], ["exit", "Exits"]] as const;
const wrap = "mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12";
const back = <Link href="/app/strategies" className="font-mono text-[12px] uppercase tracking-[.14em] text-muted hover:text-ink">← Strategies</Link>;

export default function PublicStrategyView({ id, initial }: { id: string; initial?: PublicStrategyDetail }) {
  // Always fetch on the client too: the server copy is the guest view (author.isYou is false for everyone).
  const live = useQ(async () => ({ d: await api.publicStrategy(id), now: Date.now() as number | null }), [id]);
  // A mock seed renders on the server; until the client has a clock, "published" shows the date instead of "…ago".
  const q = live.data || !initial ? live : { ...live, error: null, data: { d: initial, now: null } };
  const [needSignIn, setNeedSignIn] = useState(false);
  const [forking, setForking] = useState(false);
  const [forked, setForked] = useState<StrategyRecord | null>(null);
  const [forkErr, setForkErr] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  if (!q.data) {
    if (q.status === 404) return (
      <div className={wrap}>{back}
        <div className="mt-8 rounded-[14px] border border-line bg-card px-6 py-14 text-center" data-motion="ps-missing">
          <h1 className="text-[20px] font-medium tracking-tight">This strategy isn&rsquo;t public</h1>
          <p className="mt-2 text-[13.5px] text-muted">The author may have unpublished it, or the link is wrong.</p>
          <Link href="/app/strategies" className="btn mt-6 inline-block rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:bg-white/5">Browse public strategies</Link>
        </div>
      </div>);
    return <div className={wrap}>{back}<Loading h={560} q={q} /></div>;
  }
  const { d, now } = q.data;
  const ret = d.paperReturn30dPct;
  const fork = async () => {
    setForking(true); setForkErr(null);
    try { setForked(await api.forkPublicStrategy(d.id)); }
    catch (e) {
      // M5.28: guests can read but not fork. 401 → sign-in prompt in place; signing in keeps this URL, so you land back here.
      if (e instanceof ApiErr && e.status === 401) { setNeedSignIn(true); return; }
      setForkErr(e instanceof ApiErr ? errCopy(e.code, e.message) : "Couldn't fork right now. Try again."); }
    finally { setForking(false); }
  };
  const nodes = d.nodes as GNode[];

  return (
    <div className={wrap} data-motion="ps-page">
      {back}
      <header className="mt-6 grid gap-8 border-b border-line pb-8 md:grid-cols-[1fr_auto] md:items-end" data-motion="ps-head">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex gap-1">{d.venues.map((v) => <VenueMark key={v} venue={v} />)}</span>
            <Pill tone="paper">Paper</Pill>
            {d.mock && <Pill tone="warn">Example data</Pill>}
          </div>
          <h1 className="mt-4 text-balance text-[28px] font-medium leading-[1.15] tracking-[-.02em] sm:text-[36px]">{d.name}</h1>
          <p className="mt-3 font-mono text-[12.5px] text-muted">
            by <HandleLink handle={d.author.handle} /> · <span className="tnum">{d.forks}</span> {d.forks === 1 ? "fork" : "forks"} · published {now == null ? d.publishedAt.slice(0, 10) : fmtAgo(d.publishedAt, now)}
            {d.forkedFrom && <> · forked from <Link className="underline decoration-line-2 underline-offset-4 hover:text-ink" href={`/app/strategies/${encodeURIComponent(d.forkedFrom)}`}>original</Link></>}
          </p>
        </div>
        <div className="md:text-right" data-motion="ps-return">
          <div className="font-mono text-[11.5px] uppercase tracking-[.14em] text-muted">30-day paper return</div>
          <div className={`tnum mt-1 font-mono text-[32px] leading-none ${tone(ret)}`} data-motion="tick">{ret == null ? "—" : fmtPct(ret, { sign: true, dp: 1 })}</div>
          {d.spark.length > 1 && <div className="mt-3 w-full md:ml-auto md:w-[220px]"><Spark pts={d.spark} w={220} h={36} fluid tone={tone(ret) === "text-short" ? "short" : "long"} /></div>}
        </div>
      </header>

      {d.thesis && (
        <section className="mt-8 max-w-[760px]" data-motion="ps-thesis">
          <h2 className="font-mono text-[12px] uppercase tracking-[.14em] text-muted">Thesis</h2>
          <p className="mt-3 text-pretty text-[16px] leading-relaxed text-ink-2">{d.thesis}</p>
        </section>
      )}

      <section className="mt-8" aria-labelledby="ps-graph-h" data-motion="ps-graph">
        <h2 id="ps-graph-h" className="sr-only">How it fits together</h2>
        <StrategyGraph nodes={nodes} edges={strategyEdges(d.strategy)} label={`${d.name}: ${nodes.length} steps — signals feed the trigger, the trigger runs actions, actions carry exits.`} />
      </section>

      <section className="mt-6 grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4" aria-label="Rules in plain words" data-motion="ps-rules">
        {RULES.map(([k, t]) => (
          <div key={k} className="bg-bg p-5" data-motion="ps-rule">
            <h3 className="font-mono text-[12px] uppercase tracking-[.14em] text-muted">{t}</h3>
            <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-2">{d.humanized[k].map((it) => <li key={it}>{it}</li>)}</ul>
          </div>
        ))}
      </section>

      <section className="mt-8 flex flex-col gap-4 rounded-[14px] border border-line p-5 sm:flex-row sm:items-center sm:justify-between" aria-label="Use this strategy" data-motion="ps-actions">
        {forked ? (
          <p role="status" className="text-[13.5px] text-ink-2" data-testid="ps-forked" data-motion="ps-forked">
            Saved to your strategies as <span className="font-medium text-ink">{forked.name}</span> <span className="font-mono text-muted">v{forked.version}</span>. Nothing is running yet.
          </p>
        ) : (
          <p className="text-[13.5px] text-muted">{d.author.isYou ? "This is your strategy. Others can fork it or copy it to paper." : "Fork to edit your own copy, or copy it to paper and keep it in sync with the author."}</p>
        )}
        <div className="flex shrink-0 flex-wrap gap-2">
          {forked ? (
            <Link href="/app/strategies" className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg" data-testid="ps-open-fork">Open in Strategies →</Link>
          ) : (
            <button type="button" onClick={fork} disabled={forking} className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-50" data-testid="ps-fork">{forking ? "Forking…" : "Fork to edit"}</button>
          )}
          {!d.author.isYou && <button type="button" onClick={() => setCopying(true)} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5" data-testid="ps-copy">Copy to paper…</button>}
        </div>
      </section>
      {needSignIn && !forked && (
        <div className="mt-3 flex flex-col items-start gap-3 rounded-[14px] border border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="ps-signin" data-motion="ps-signin">
          <p className="text-[13.5px] text-ink-2">Sign in to fork this strategy. You&rsquo;ll come back to this page.</p>
          <SignInButton onDone={() => { setNeedSignIn(false); live.reload(); }} />
        </div>
      )}
      {forkErr && <p role="alert" className="mt-3 text-[13px] text-short" data-motion="ps-error">{forkErr}</p>}
      <p className="mt-6 text-[12.5px] text-muted">Returns are a paper backtest on each venue&rsquo;s data, not a promise. Forks and copies run on paper until you go live.</p>
      {copying && <CopyDialog publicStrategyId={d.id} name={d.name} handle={d.author.handle} onClose={() => setCopying(false)} />}
    </div>
  );
}
