"use client";
// M4.9: tell a running PAPER strategy what to change in plain English. The server compiles a bounded diff (InstructOps);
// we show before/after and only apply when the user presses Apply. Never auto-applied.
// Hooks for Ellis: data-motion="instruct" | "instruct-proposal" | "instruct-change" (data-kind=removes|change) | "instruct-applied" | "instruct-typed" (inline span around the echoed instruction; caret via ::after).
import { useEffect, useRef, useState } from "react";
import { api, ApiErr, issuesOf, type FieldIssue, type InstructProposal } from "@/lib/api";
import { Card, Pill } from "./ui";

const fmtV = (v: unknown): string => {
  if (v == null) return "—";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.map(fmtV).join(", ");
  const o = v as Record<string, unknown>;
  if ("unit" in o && "value" in o && Object.keys(o).length === 2) return o.unit === "usd" ? `$${o.value}` : o.unit === "pct" || o.unit === "pct_equity" ? `${o.value}%` : `${o.value} ${o.unit}`;
  return Object.entries(o).map(([k, x]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${fmtV(x)}`).join(" · ");
};
const removesRule = (p: InstructProposal, c: InstructProposal["changes"][number]) => c.after == null && (c.path.startsWith("/triggers") || p.ops.some((o) => o.op === "pause_rule"));
const CONFLICT: Record<string, string> = {
  superseded: "A newer proposal replaced this one. Use the latest, or ask again.",
  expired: "This proposal expired before it was applied. Ask again to get a fresh one.",
  applied: "This proposal was already applied.",
  stopped: "The run has stopped, so it can’t be changed.",
};
type Err = { msg: string; suggestions?: string[]; issues?: FieldIssue[]; retryAt?: number };
/** M4.9.1: extra guidance for 422 strategy_invalid issue codes (server message stays the headline). */
const ISSUE_HINT: Record<string, string> = {
  strategy_needs_rule: "Keep at least one rule active. Try changing a rule’s size or exits instead of pausing it.",
  strategy_needs_action: "Every rule needs something to do. Try adjusting the action instead of removing it.",
  out_of_range: "Pick a value inside the allowed range.",
};
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)), p = (n: number) => String(n).padStart(2, "0"); return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`; };

export default function InstructPanel({ runId, onApplied, onAsk, warning }: { runId: string; onApplied: (version: number) => void; onAsk?: () => void; warning: string | null }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"ask" | "apply" | null>(null);
  const [prop, setProp] = useState<InstructProposal | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLTextAreaElement>(null);
  const waitMs = err?.retryAt ? err.retryAt - now : 0, waiting = waitMs > 0;
  useEffect(() => { if (!err?.retryAt) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [err?.retryAt]);
  useEffect(() => { if (!prop) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [prop]);
  const left = prop ? Date.parse(prop.expiresAt) - now : 0;
  const expired = !!prop && left <= 0;

  const toErr = (e: unknown): Err => {
    if (!(e instanceof ApiErr)) return { msg: "Something went wrong. Try again." };
    const d = (e.details ?? {}) as { suggestions?: string[]; status?: string; runStatus?: string };
    if (e.code === "unsupported_prompt") return { msg: e.message, suggestions: d.suggestions };
    if (e.code === "strategy_invalid" || e.code === "validation_failed") {
      const issues = issuesOf(e.details); // one issue whose message equals the headline adds nothing
      return { msg: e.message || "This change would make the strategy invalid.", issues: issues.length === 1 && issues[0].message === e.message && !ISSUE_HINT[issues[0].code] ? [] : issues };
    }
    if (e.code === "compile_quota_exceeded" || e.status === 429) return { msg: e.code === "compile_quota_exceeded" ? "You’ve used today’s AI requests (compiles and changes share one daily quota)." : "Too many requests.", retryAt: Date.now() + (e.retryAfterSec ?? 60) * 1000 };
    if (e.status === 409) return { msg: CONFLICT[d.status ?? ""] ?? (d.runStatus ? CONFLICT.stopped : e.message) };
    if (e.code === "mode_not_enabled") return { msg: "Instructions work on paper runs only." };
    return { msg: e.message };
  };
  const ask = (t = text) => {
    const v = t.trim(); if (v.length < 3 || busy || waiting) return;
    setBusy("ask"); setErr(null); setApplied(null); onAsk?.();
    api.instruct(runId, v).then((p) => { setProp(p); setNow(Date.now()); setBusy(null); }, (e) => { setProp(null); setErr(toErr(e)); setNow(Date.now()); setBusy(null); });
  };
  const apply = () => {
    if (!prop || busy) return;
    setBusy("apply"); setErr(null);
    api.applyInstruct(runId, prop.id).then((r) => { setProp(null); setApplied(r.strategyVersion); setText(""); setBusy(null); onApplied(r.strategyVersion); }, (e) => { setErr(toErr(e)); setBusy(null); });
  };
  const pick = (s: string) => { setText(s); setErr(null); input.current?.focus(); };

  return (
    <Card className="mt-5 overflow-hidden" data-testid="instruct" data-motion="instruct">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-medium">Change this strategy</h2>
        <Pill tone="paper">Paper only</Pill>
      </div>
      <form className="flex flex-col gap-2.5 p-5 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <label htmlFor="instruct-text" className="sr-only">Describe a change</label>
        <textarea id="instruct-text" ref={input} rows={1} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
          placeholder="e.g. stop loss 5% take profit 12%" className="min-h-[42px] min-w-0 flex-1 resize-y rounded-lg border border-line-2 bg-bg px-3.5 py-2.5 text-[14px] text-ink placeholder:text-muted" data-testid="instruct-input" />
        <button type="submit" disabled={text.trim().length < 3 || !!busy || waiting} className="btn rounded-full bg-accent px-5 py-2.5 text-[14px] font-medium text-bg disabled:opacity-50">{busy === "ask" ? "Reading…" : "Preview change"}</button>
      </form>
      <p className="-mt-2 px-5 pb-4 text-[12.5px] text-muted">Nothing changes until you press Apply. Size, leverage, exits, cooldowns, daily loss limit, or pausing a rule.</p>

      {err && (
        <div className="border-t border-line px-5 py-3.5" role="alert" data-testid="instruct-error">
          <p className="text-[13.5px] text-short">{err.msg}</p>
          {!!err.issues?.length && (
            <ul className="mt-2 space-y-1.5 text-[13px]" data-testid="instruct-invalid">
              {err.issues.map((i, k) => (
                <li key={k} className="flex gap-2" data-code={i.code}><span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-short" />
                  <span className="min-w-0">{i.message !== err.msg && <span className="text-ink">{i.message}</span>}{ISSUE_HINT[i.code] && <span className={i.message !== err.msg ? "block text-ink-2" : "text-ink"}>{ISSUE_HINT[i.code]}</span>}</span></li>))}
            </ul>
          )}
          {err.issues && <p className="mt-2 text-[12.5px] text-muted">Nothing was changed. Try a different wording.</p>}
          {err.retryAt && (
            <p className="mt-1.5 text-[13px] text-ink-2" data-testid="instruct-quota" aria-live="off">
              {waiting ? <>You can try again in <span className="tnum font-mono text-ink" data-testid="instruct-countdown">{mmss(waitMs)}</span>.</> : "You can try again now."}
            </p>
          )}
          {!!err.suggestions?.length && (
            <div className="mt-2.5 flex flex-wrap gap-2" data-testid="instruct-suggestions">
              <span className="sr-only">Try one of these:</span>
              {err.suggestions.map((s) => <button key={s} type="button" onClick={() => pick(s)} className="btn rounded-full border border-line-2 px-3 py-1 text-[12.5px] text-ink-2 hover:border-white/30 hover:text-ink">{s}</button>)}
            </div>
          )}
        </div>
      )}

      {prop && (
        <div className="border-t border-line" data-testid="instruct-proposal" data-motion="instruct-proposal">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <p className="min-w-0 text-[13px] text-ink-2">“<span data-motion="instruct-typed" data-testid="instruct-typed">{prop.text}</span>”</p>
            <span className={`tnum font-mono text-[12.5px] ${expired ? "text-short" : left < 60_000 ? "text-warn" : "text-muted"}`} data-testid="instruct-expiry" aria-live="off">{expired ? "Expired" : `Expires in ${mmss(left)}`}</span>
          </div>
          {prop.notice && <p className="px-5 pt-2 text-[12.5px] text-muted">{prop.notice}</p>}
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {prop.changes.map((c) => {
              const rm = removesRule(prop, c);
              return (
                <li key={c.path} className="grid gap-1.5 px-5 py-3 sm:grid-cols-[1fr_auto] sm:items-center" data-testid="instruct-change" data-motion="instruct-change" data-kind={rm ? "removes" : "change"}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-ink">{rm && <Pill tone="short">Removes rule</Pill>}<span>{c.summary}</span></div>
                    <div className="tnum mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12.5px]">
                      <del className="min-w-0 break-words text-muted decoration-short/60">{fmtV(c.before)}</del>
                      <span aria-hidden className="text-muted">→</span><span className="sr-only">becomes</span>
                      <ins className={`min-w-0 break-words no-underline ${rm ? "text-short" : "text-long"}`}>{rm ? "removed" : fmtV(c.after)}</ins>
                    </div>
                  </div>
                  <code className="hidden font-mono text-[11.5px] text-muted sm:block">{c.path}</code>
                </li>
              );
            })}
          </ul>
          {prop.issues.length > 0 && (
            <ul className="space-y-1 px-5 pt-3 text-[12.5px]" data-testid="instruct-issues">
              {prop.issues.map((i, k) => <li key={k} className={i.severity === "error" ? "text-short" : "text-warn"}>{i.severity === "error" ? "Blocks apply" : "Note"}: {i.message}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2.5 px-5 py-4">
            <button onClick={apply} disabled={!prop.ok || expired || !!busy} className="btn rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-bg disabled:opacity-50" data-testid="instruct-apply">{busy === "apply" ? "Applying…" : "Apply"}</button>
            <button onClick={() => { setProp(null); setErr(null); }} disabled={busy === "apply"} className="btn rounded-full border border-line-2 px-5 py-2 text-[14px] text-ink-2 hover:border-white/30">Discard</button>
            {!prop.ok && <span className="text-[12.5px] text-short">Fix the blocking issue first. Try a different wording.</span>}
            {expired && <button onClick={() => ask(prop.text)} className="btn text-[12.5px] text-ink-2 underline">Ask again</button>}
          </div>
        </div>
      )}

      {(applied != null || (warning && !prop)) && (
        <p className="border-t border-line bg-bg-2 px-5 py-3 text-[13px] text-ink-2" role="status" data-testid="instruct-applied" data-motion="instruct-applied">
          {warning ?? `Applied as version ${applied}. Waiting for the run to pick it up…`}
        </p>
      )}
    </Card>
  );
}
