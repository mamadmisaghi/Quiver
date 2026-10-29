"use client";
// M4.5: GET/PUT /v1/autopilot, POST /v1/autopilot/kill, GET /v1/autopilot/log. PAPER ONLY — no keys, funds or signing.
import PlanPanel from "./PlanPanel";
import { useState } from "react";
import Link from "@/components/Link";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import Loading from "@/components/Loading";
import { Card, Pill } from "@/components/ui";
import { api, ApiErr, fieldErrors, isValidation, fmtUsd, type Autopilot, type AutopilotDecision, type AutopilotDecisionView, type AutopilotKill, type ErrorCode, errOf } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";

const ACTION: Record<AutopilotDecision["action"], string> = { started: "Started", rotated: "Rotated", skipped: "Skipped", guardrail_stop: "Guardrail stop", killed: "Killed", disabled: "Turned off", start_failed: "Couldn’t start" };
// skipped = current run paused/halted; disabled = turned off (by you, or "run was stopped outside autopilot"). Calm, not alarming.
const CALM = new Set<AutopilotDecision["action"]>(["skipped", "disabled"]);
const TONE: Record<AutopilotDecision["action"], string> = { started: "text-ink", rotated: "text-ink", skipped: "w-fit rounded-full border border-line-2 px-2 text-[12px] leading-[20px] text-muted", disabled: "w-fit rounded-full border border-dashed border-line-2 px-2 text-[12px] leading-[20px] text-ink-2", killed: "text-short", guardrail_stop: "text-short", start_failed: "text-short" };
/** M4.6 names (nullable). "A → B" for rotations, else the one strategy involved. */
function who(d: AutopilotDecisionView): string | null {
  if (d.fromStrategyName && d.toStrategyName && d.fromStrategyName !== d.toStrategyName) return `${d.fromStrategyName} → ${d.toStrategyName}`;
  return d.toStrategyName ?? d.strategyName ?? d.fromStrategyName ?? null;
}
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const inp = "w-full rounded-lg border border-line-2 bg-bg px-3 py-2 font-mono text-[13.5px] tabular-nums text-ink aria-[invalid=true]:border-short";
type Form = { strategyIds: string[]; rotateEveryMin: string; startingEquityUsd: string; maxDrawdownPct: string; maxDailyLossUsd: string; maxRotationsPerDay: string; approvalMode: "auto" | "confirm_each" };
/** M4.9.2: kill.failed[].reason is an ErrorCode (or "stop_failed"). Record<ErrorCode> keeps this complete when contracts grow. */
const KILL_REASON: Record<ErrorCode, string> = {
  service_unavailable: "The service could not save the stop. Retry shortly and check the run status.",
  unauthorized: "Your session expired before it could be stopped. Sign in and retry.", forbidden: "You don’t have permission to stop this run.",
  not_found: "The run wasn’t found. It may already be gone.", conflict: "The run changed state while stopping. Retry to finish.",
  validation_failed: "The stop request was rejected.", rate_limited: "Too many requests at once. Retry in a moment.", payload_too_large: "The stop request was rejected.",
  compile_failed: "Couldn’t stop it.", unsupported_prompt: "Couldn’t stop it.", compile_quota_exceeded: "Couldn’t stop it.", secrets_unavailable: "Couldn’t stop it.", rpc_url_blocked: "Couldn’t stop it.", wallet_link_unavailable: "Couldn’t stop it.", vision_unavailable: "Couldn’t stop it.", image_invalid: "Couldn’t stop it.", auth_unavailable: "Sign-in isn’t available right now.", wallet_link_invalid: "Couldn’t stop it.", compile_cost_cap: "Couldn’t stop it.",
  strategy_invalid: "The strategy is in an invalid state.", geo_restricted: "Not available in your region.", eligibility_required: "Eligibility check required.",
  venue_unavailable: "The venue didn’t respond, so positions couldn’t be closed yet.", venue_read_only: "The venue is read-only right now.",
  market_closed: "The market is closed, so positions couldn’t be closed yet.", quote_unavailable: "No price quote to close positions at.",
  oracle_stale: "The price feed is stale, so positions couldn’t be closed safely.", sequencer_down: "The chain is paused, so positions couldn’t be closed yet.",
  session_key_missing: "Session key problem.", session_key_expired: "Session key problem.", session_key_revoked: "Session key problem.", session_key_policy_violation: "Session key problem.",
  session_key_cap_ratio: "Session key problem.", session_key_slippage_above_cap: "Session key problem.", session_key_expiry_too_long: "Session key problem.", session_key_policy_hash_mismatch: "Session key problem.",
  signing_unavailable: "Signing is unavailable right now.", alert_url_blocked: "Couldn’t stop it.", mode_not_enabled: "That mode isn’t enabled.",
  backtest_data_unavailable: "Couldn’t stop it.", backtest_range_invalid: "Couldn’t stop it.", limit_exceeded: "A usage limit was hit. Retry in a moment.",
  run_already_active: "The run is busy. Retry in a moment.", insufficient_balance: "Couldn’t stop it.", internal: "Something went wrong on our side.", not_available: "Couldn’t stop it.",
};
const KILL_EXTRA: Record<string, string> = { stop_failed: "The stop didn’t complete.", flatten_timeout: "Closing positions took too long (over 5 s).", timeout: "The stop took too long.", venue_down: "The venue didn’t respond, so positions couldn’t be closed yet." };
const killReason = (code: string) => (KILL_REASON as Record<string, string>)[code] ?? KILL_EXTRA[code] ?? (/^[a-z0-9_]+$/.test(code) ? "Couldn’t stop it for an unexpected reason." : code);
const FORM_KEYS = ["strategyIds", "rotateEveryMin", "startingEquityUsd", "maxDrawdownPct", "maxDailyLossUsd", "maxRotationsPerDay", "approvalMode"] as const satisfies readonly (keyof Form)[];
const fromAp = (a: Autopilot): Form => ({ strategyIds: a.strategyIds, rotateEveryMin: String(a.rotateEveryMin), startingEquityUsd: a.startingEquityUsd, maxDrawdownPct: String(a.guardrails.maxDrawdownPct), maxDailyLossUsd: String(a.guardrails.maxDailyLossUsd), maxRotationsPerDay: String(a.guardrails.maxRotationsPerDay), approvalMode: a.approvalMode });
function check(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {}; const n = (s: string) => Number(s);
  if (f.strategyIds.length < 1) e.strategyIds = "Pick at least one strategy."; else if (f.strategyIds.length > 10) e.strategyIds = "Pick up to 10 strategies.";
  if (!Number.isInteger(n(f.rotateEveryMin)) || n(f.rotateEveryMin) < 15 || n(f.rotateEveryMin) > 1440) e.rotateEveryMin = "15 to 1440 minutes.";
  if (!/^\d+(\.\d{1,2})?$/.test(f.startingEquityUsd) || n(f.startingEquityUsd) < 100 || n(f.startingEquityUsd) > 10_000_000) e.startingEquityUsd = "$100 to $10,000,000.";
  if (!(n(f.maxDrawdownPct) >= 1 && n(f.maxDrawdownPct) <= 50)) e.maxDrawdownPct = "1% to 50%.";
  if (!(n(f.maxDailyLossUsd) > 0 && n(f.maxDailyLossUsd) <= 100_000)) e.maxDailyLossUsd = "Above $0, up to $100,000.";
  if (!Number.isInteger(n(f.maxRotationsPerDay)) || n(f.maxRotationsPerDay) < 1 || n(f.maxRotationsPerDay) > 48) e.maxRotationsPerDay = "1 to 48.";
  return e;
}

export default function AutopilotView() {
  const ap = useQ(() => api.autopilot(), []);
  const log = useQ(() => api.autopilotLog({ limit: 50 }), []);
  const strats = useQ(() => api.strategies(), []);
  const [a, setA] = useState<Autopilot | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "kill">(null);
  const [confirmKill, setConfirmKill] = useState(false);
  const [failed, setFailed] = useState<AutopilotKill["kill"]["failed"] | null>(null); // M4.9.1 207 partial kill
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [seen, setSeen] = useState<Autopilot | undefined>(undefined);
  if (ap.data && ap.data !== seen) { setSeen(ap.data); setA(ap.data); setF(fromAp(ap.data)); }
  const [srv, setSrv] = useState<{ key: string; fields: Partial<Record<keyof Form, string>> } | null>(null); // M4.9.1 server 422 → inline
  const srvErr = srv && f && srv.key === JSON.stringify(f) ? srv.fields : {};
  const errs = f ? check(f) : {}; const bad = Object.keys(errs).length > 0;
  const set = (k: keyof Form, v: string) => setF((x) => (x ? { ...x, [k]: v } : x));
  const save = async (enabled: boolean) => {
    if (!f || (enabled && bad)) return; setBusy("save"); setMsg(null);
    try {
      const r = await api.putAutopilot({ enabled, mode: "paper", strategyIds: f.strategyIds, rotateEveryMin: Number(f.rotateEveryMin), startingEquityUsd: f.startingEquityUsd, guardrails: { maxDrawdownPct: Number(f.maxDrawdownPct), maxDailyLossUsd: Number(f.maxDailyLossUsd), maxRotationsPerDay: Number(f.maxRotationsPerDay) }, approvalMode: f.approvalMode, acknowledgeKill: ack });
      setA(r); setAck(false); if (enabled && !r.enabled) { setMsg({ tone: "err", text: `Autopilot couldn’t start${r.state.lastDecision?.reason ? `: ${r.state.lastDecision.reason.replace(/[.\s]+$/, "")}.` : "."} Check the log below.` }); log.reload(); return; } setMsg({ tone: "ok", text: enabled ? (a?.enabled ? "Settings saved." : "Autopilot is on. It started the first strategy.") : "Autopilot is off. The current paper run was stopped and flattened." }); log.reload();
    } catch (x) {
      if (isValidation(x)) { const fe = fieldErrors(x, FORM_KEYS); setSrv({ key: JSON.stringify(f), fields: fe.fields });
        setMsg({ tone: "err", text: fe.rest.length ? fe.rest.map((i) => i.message).join(" ") : Object.keys(fe.fields).length ? "Fix the highlighted fields." : errOf(x, "Couldn’t save.") }); return; }
      setMsg({ tone: "err", text: x instanceof ApiErr && x.status === 409 ? "Autopilot was killed. Tick the box to confirm you want it back on." : errOf(x, "Couldn’t save.") }); }
    finally { setBusy(null); }
  };
  const kill = async () => {
    setBusy("kill"); setMsg(null);
    try {
      const r = await api.killAutopilot(); setA(r); setConfirmKill(false); log.reload();
      if (r.kill.failed.length) { setFailed(r.kill.failed); return; }
      setFailed(null); setMsg({ tone: "ok", text: r.kill.stopped ? `Autopilot killed. ${r.kill.stopped === 1 ? "The paper run was" : `${r.kill.stopped} paper runs were`} stopped and flattened.` : "Autopilot killed. No paper run was active." });
    }
    catch (x) { setMsg({ tone: "err", text: errOf(x, "Couldn’t kill autopilot.") }); }
    finally { setBusy(null); }
  };
  const field = (k: keyof Form, label: string, unit: string, hint: string) => (
    <label className="grid gap-1 text-[12.5px] text-muted">{label}
      <span className="flex items-center gap-2"><input id={`ap-${k}`} inputMode="decimal" value={f![k] as string} onChange={(e) => set(k, e.target.value)} aria-invalid={!!(errs[k] ?? srvErr[k])} aria-describedby={`ap-${k}-h`} className={inp} /><span className="shrink-0 text-ink-2">{unit}</span></span>
      <span id={`ap-${k}-h`} className={errs[k] ?? srvErr[k] ? "text-short" : ""} data-testid={srvErr[k] ? `ap-${k}-srv` : undefined}>{errs[k] ?? srvErr[k] ?? hint}</span>
    </label>);
  const s = a?.state; const items = strats.data?.items ?? [];
  return (
    <Wrap>
      <PageHeader title="Autopilot" sub="Rotates through your own strategies on a schedule, one paper run at a time, inside guardrails you set." />
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-paper/40 bg-paper/5 px-4 py-3 text-[13px] text-ink-2" data-testid="ap-paper-only">
        <Pill tone="paper">Paper only</Pill> Simulated money. Autopilot never uses a wallet, session key or real funds, and there’s no live or testnet autopilot.
      </div>
      {!a || !f ? <Loading h={260} q={ap} /> : (<>
        <PlanPanel cur={a} names={Object.fromEntries((strats.data?.items ?? []).map((x) => [x.id, x.name]))} onApplied={(x) => { setA(x); setF(fromAp(x)); setMsg({ tone: "ok", text: "Plan applied. Autopilot is still off." }); }} />
        <Card className="mt-4 p-5" data-testid="ap-status" data-state={a.killed ? "killed" : a.enabled ? "on" : "off"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><span className={`size-2 rounded-full ${a.killed ? "bg-short" : a.enabled ? "bg-long" : "bg-muted"}`} aria-hidden /><h2 className="font-medium">{a.killed ? "Killed" : a.enabled ? "On" : a.configured ? "Off" : "Not set up"}</h2>
              {s?.platformKillSwitch && <Pill tone="short">Platform kill switch on</Pill>}</div>
            {a.enabled && !confirmKill && <button onClick={() => setConfirmKill(true)} className="btn rounded-full border border-short/50 px-4 py-2 text-[13px] text-short hover:bg-short/10" data-testid="ap-kill">Kill autopilot…</button>}
          </div>
          {failed && (
            <div role="alert" className="mt-4 rounded-[12px] border border-warn/50 bg-warn/5 p-4 text-[13.5px]" data-testid="ap-kill-partial">
              <p className="font-medium text-ink">Autopilot is off, but {failed.length === 1 ? "1 paper run didn’t stop" : `${failed.length} paper runs didn’t stop`}.</p>
              <p className="mt-1 text-ink-2">Autopilot won’t start anything new. {failed.length === 1 ? "This run is" : "These runs are"} still open — retry, or stop {failed.length === 1 ? "it" : "them"} from the run page.</p>
              <ul className="mt-2.5 space-y-1.5" data-testid="ap-kill-failed">
                {failed.map((f) => <li key={f.runId} className="flex min-w-0 flex-wrap items-baseline gap-x-2"><a href={`/app/run/${encodeURIComponent(f.runId)}`} className="break-all font-mono text-[12.5px] text-ink underline decoration-white/30 hover:decoration-white">{f.runId}</a><span className="text-[12.5px] text-muted" title={f.reason} data-reason={f.reason}>{killReason(f.reason)}</span></li>)}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2"><button onClick={kill} disabled={busy === "kill"} className="btn rounded-full bg-short px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-40" data-testid="ap-kill-retry">{busy === "kill" ? "Retrying…" : "Retry stopping"}</button>
                <button onClick={() => setFailed(null)} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5">Dismiss</button></div>
            </div>)}
          {confirmKill && (
            <div role="alertdialog" aria-label="Kill autopilot" className="mt-4 rounded-[12px] border border-short/40 bg-raised p-4 text-[13.5px]" data-testid="ap-kill-confirm">
              <p className="text-ink">Kill autopilot now?</p>
              <p className="mt-1 text-ink-2">This stops and flattens the current paper run and turns autopilot off. Turning it back on needs an extra confirmation.</p>
              <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => setConfirmKill(false)} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5">Cancel</button>
                <button onClick={kill} disabled={busy === "kill"} className="btn rounded-full bg-short px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-40">{busy === "kill" ? "Killing…" : "Kill now"}</button></div>
            </div>)}
          {s && <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <div><dt className="text-[12px] text-muted">Running now</dt><dd className="mt-0.5 min-w-0" data-testid="ap-current">{s.currentRunId ? <Link className="block truncate underline" href={`/app/run/${s.currentRunId}`}>{s.currentStrategyName ?? `Run …${s.currentRunId.slice(-6)}`}</Link> : "—"}</dd></div>
            <div><dt className="text-[12px] text-muted">Next rotation</dt><dd className="mt-0.5 font-mono tabular-nums">{s.nextRotationAt ? when(s.nextRotationAt) : "—"}</dd></div>
            <div><dt className="text-[12px] text-muted">Rotations today</dt><dd className="mt-0.5 font-mono tabular-nums">{s.rotationsToday} / {a.guardrails.maxRotationsPerDay}</dd></div>
            <div><dt className="text-[12px] text-muted">Today’s P&L</dt><dd className={`mt-0.5 font-mono tabular-nums ${s.dayPnlUsd.startsWith("-") ? "text-short" : "text-ink"}`}>{fmtUsd(s.dayPnlUsd, { sign: true })}</dd></div>
          </dl>}
          {s?.lastDecision && <p className="mt-3 text-[12.5px] text-muted">Last: {ACTION[s.lastDecision.action]}{who(s.lastDecision) && <> · <span className="text-ink-2">{who(s.lastDecision)}</span></>} · {s.lastDecision.reason} · {when(s.lastDecision.at)}</p>}
        </Card>
        <Card className="mt-3 p-5" data-testid="ap-settings">
          <h2 className="font-medium">Settings</h2>
          <fieldset className="mt-3"><legend className="text-[12.5px] text-muted">Strategies to rotate (1–10, in this order)</legend>
            {!strats.data ? <p className="mt-2 text-[13px] text-muted">Loading strategies…</p> : items.length === 0 ? <p className="mt-2 text-[13px] text-muted">You don’t have strategies yet. <Link className="underline" href="/app/new">Draft one</Link>.</p> : (
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{items.map((st) => { const on = f.strategyIds.includes(st.id); return (
                <li key={st.id}><label className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 py-2 text-[13.5px] hover:bg-white/5"><input type="checkbox" checked={on} onChange={() => setF({ ...f, strategyIds: on ? f.strategyIds.filter((x) => x !== st.id) : [...f.strategyIds, st.id] })} className="accent-[var(--q-amber)]" />
                  <span className="min-w-0 truncate">{st.name}</span>{on && <span className="ml-auto font-mono text-[11.5px] text-muted">#{f.strategyIds.indexOf(st.id) + 1}</span>}</label></li>); })}</ul>)}
            {errs.strategyIds && <p className="mt-1 text-[12.5px] text-short">{errs.strategyIds}</p>}
          </fieldset>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {field("rotateEveryMin", "Rotate every", "min", "15 to 1440.")}
            {field("startingEquityUsd", "Starting paper equity", "USD", "Each run starts with this.")}
            {field("maxDrawdownPct", "Max drawdown", "%", "From the run’s peak. Stops, flattens and turns off.")}
            {field("maxDailyLossUsd", "Max daily loss", "USD", "Across today’s autopilot runs. Turns off.")}
            {field("maxRotationsPerDay", "Max rotations a day", "", "UTC day. Extra rotations are skipped.")}
            <fieldset className="grid gap-1 text-[12.5px] text-muted" data-testid="ap-approval-mode"><legend className="mb-1">Orders</legend>
              <div role="radiogroup" aria-label="Orders" className="inline-flex w-full rounded-lg border border-line-2 p-0.5">
                {([["auto", "Place automatically"], ["confirm_each", "Ask before each"]] as const).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={f.approvalMode === v} onClick={() => setF({ ...f, approvalMode: v })} className={`flex-1 rounded-md px-2 py-1.5 text-[13px] ${f.approvalMode === v ? "bg-white/10 text-ink" : "text-ink-2 hover:bg-white/5"}`}>{l}</button>))}
              </div>
              <span data-testid="ap-approval-hint">{f.approvalMode === "confirm_each" ? <>Each paper order waits in <Link className="underline text-ink-2" href="/app/approvals">Approvals</Link> until you approve or reject it. Unanswered requests expire.</> : "Paper orders go straight through."}</span></fieldset>
          </div>
          {a.killed && (
            <label className="mt-4 flex items-start gap-2 rounded-md border border-short/40 px-3 py-2.5 text-[13px] text-ink-2" data-testid="ap-ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[var(--q-amber)]" />
              <span>I understand autopilot was killed and I want to turn it back on. It will start the first strategy right away.</span></label>)}
          {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={`mt-3 text-[13px] ${msg.tone === "err" ? "text-short" : "text-muted"}`} data-testid="ap-msg">{msg.text}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {a.enabled ? (<>
              <button onClick={() => save(true)} disabled={!!busy || bad} className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-40" data-testid="ap-save">{busy === "save" ? "Saving…" : "Save settings"}</button>
              <button onClick={() => save(false)} disabled={!!busy} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5 disabled:opacity-40">Turn off</button>
            </>) : <button onClick={() => save(true)} disabled={!!busy || bad || (a.killed && !ack)} className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-40" data-testid="ap-enable">{busy === "save" ? "Turning on…" : "Turn on autopilot (paper)"}</button>}
          </div>
        </Card>
        <Card className="mt-3 p-5">
          <h2 className="font-medium">Log</h2>
          {!log.data ? <p className="mt-2 text-[13px] text-muted">Loading…</p> : log.data.items.length === 0 ? <p className="mt-2 text-[13px] text-muted">Nothing yet.</p> : (
            <ol className="mt-3 grid gap-2" data-testid="ap-log">{log.data.items.map((d, k) => (
              <li key={k} data-action={d.action} className="grid gap-x-3 border-t border-line pt-2 text-[13px] first:border-0 first:pt-0 sm:grid-cols-[150px_120px_1fr]">
                <span className="font-mono text-[12px] tabular-nums text-muted">{when(d.at)}</span>
                <span className={TONE[d.action]}>{ACTION[d.action]}</span>
                <span className={CALM.has(d.action) ? "text-muted" : "text-ink-2"}>{who(d) && <span className="text-ink-2" data-testid="ap-log-who">{who(d)} · </span>}{d.reason}{d.toRunId && <> · <Link className="underline" href={`/app/run/${d.toRunId}`}>run …{d.toRunId.slice(-6)}</Link></>}</span>
              </li>))}</ol>)}
        </Card>
      </>)}
    </Wrap>
  );
}
