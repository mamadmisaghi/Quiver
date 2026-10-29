"use client";
// M4.0 alerts: webhook (GET/PUT /alerts/settings), rules (GET/POST/DELETE /alerts/rules, max 20 → 429),
// deliveries (GET /alerts/deliveries) and a test send (POST /alerts/test → 202). The signing secret comes back only
// when created/rotated: it lives in component state until dismissed, is never logged, stored or put in a URL.
import { useState } from "react";
import { Card } from "@/components/ui";
import { api, ApiErr, errOf as apiErrOf, isValidation, type AlertDelivery, type AlertEventType, type AlertRule, type AlertSettings } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";

const EVENTS: [AlertEventType, string][] = [["fill", "Fills"], ["rejected", "Rejected orders"], ["risk_halt", "Risk halts"], ["error", "Errors"], ["warning", "Warnings"], ["trigger_fired", "Triggers"], ["status", "Status changes"]];
const EV = Object.fromEntries(EVENTS) as Record<string, string>;
const PROV: Record<string, string> = { webhook: "Webhook", email: "Email", telegram: "Telegram", x: "X DM" };
const DS: Record<string, [string, string]> = { queued: ["Queued", "text-muted"], delivered: ["Delivered", "text-long"], failed: ["Failed", "text-short"], not_configured: ["No webhook", "text-muted"], dropped: ["Dropped", "text-muted"] };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const btn = "btn min-h-10 rounded-full border border-line-2 px-4 text-[13px] hover:bg-white/5 disabled:opacity-40";
const errOf = (x: unknown, f: string) => x instanceof ApiErr ? (x.code === "alert_url_blocked" ? `That URL can’t be used: ${x.message}` : x.status === 429 ? "You’ve reached the 20-rule limit. Delete one to add another." : isValidation(x) ? apiErrOf(x, f) : x.message) : f;

export default function AlertsCard() {
  const q = useQ(async () => { const [s, r, d] = await Promise.all([api.alertSettings(), api.alertRules(), api.alertDeliveries({ limit: 10 })]); return { s, r, d: d.items }; });
  if (!q.data) return <Card className="p-6 lg:col-span-2" data-testid="alerts"><h2 className="font-medium">Alerts</h2><p className="mt-3 text-[13.5px] text-muted">{q.error ?? "Loading…"}</p></Card>;
  return <Alerts key={q.data.s.webhookUrl ?? ""} init={q.data} reload={q.reload} />;
}

function Alerts({ init, reload }: { init: { s: AlertSettings; r: AlertRule[]; d: AlertDelivery[] }; reload: () => void }) {
  const [s, setS] = useState(init.s);
  const [rules, setRules] = useState(init.r);
  const [dels, setDels] = useState(init.d);
  const [url, setUrl] = useState(init.s.webhookUrl ?? "");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [urlErr, setUrlErr] = useState<string | null>(null);
  const [ruleErr, setRuleErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<AlertEventType[]>(["fill", "risk_halt", "error"]);
  const urlBad = url !== "" && !/^https:\/\/[^\s]+$/.test(url);

  const save = async (b: { webhookUrl: string | null; rotateSecret?: boolean }, tag: string) => {
    setBusy(tag); setUrlErr(null); setMsg(null);
    try { const r = await api.putAlertSettings(b); const { signingSecret, ...rest } = r; setS(rest); setUrl(rest.webhookUrl ?? ""); setSecret(signingSecret); setCopied(false); setMsg(b.webhookUrl ? "Webhook saved." : "Webhook removed."); }
    catch (x) { setUrlErr(errOf(x, "Couldn’t save the webhook.")); }
    finally { setBusy(null); }
  };
  const addRule = async () => {
    setBusy("rule"); setRuleErr(null);
    try { const r = await api.createAlertRule({ runId: null, events: pick, enabled: true }); setRules((x) => [...x, r]); }
    catch (x) { setRuleErr(errOf(x, "Couldn’t add the rule.")); }
    finally { setBusy(null); }
  };
  const del = async (id: string) => {
    setBusy(id); setRuleErr(null);
    try { await api.deleteAlertRule(id); setRules((x) => x.filter((r) => r.id !== id)); } catch (x) { setRuleErr(errOf(x, "Couldn’t delete the rule.")); } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy("test"); setMsg(null);
    try { const d = await api.testAlert(); setDels((x) => [d, ...x.filter((y) => y.id !== d.id)].slice(0, 10)); setMsg(`Test ${DS[d.status]?.[0].toLowerCase() ?? d.status}.`); }
    catch (x) { setMsg(errOf(x, "Couldn’t send a test.")); } finally { setBusy(null); }
  };
  const copy = async () => { if (!secret) return; try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { setCopied(false); } };

  return (
    <Card className="p-6 lg:col-span-2" data-testid="alerts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Alerts</h2>
        <span className="font-mono text-[12px] text-muted">{s.provider}{s.providerStatus === "not_configured" ? " · not configured on this server" : s.webhookUrl ? " · on" : " · no webhook"}</span>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <label htmlFor="al-url" className="text-[13px] text-ink-2">Webhook URL</label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input id="al-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://example.com/quiver" value={url} onChange={(e) => { setUrl(e.target.value.trim()); setUrlErr(null); }}
              aria-invalid={urlBad || !!urlErr} aria-describedby={urlBad || urlErr ? "al-url-err" : "al-url-help"} className="min-h-10 min-w-0 flex-1 basis-56 rounded-[10px] border border-line-2 bg-transparent px-3 font-mono text-[13px] text-ink focus:border-accent/60 focus:outline-none aria-[invalid=true]:border-short/70" />
            <button className={btn} disabled={!!busy || urlBad || !url || url === s.webhookUrl} onClick={() => save({ webhookUrl: url }, "save")}>{busy === "save" ? "Saving…" : "Save"}</button>
          </div>
          {(urlBad || urlErr) ? <p id="al-url-err" role="alert" className="mt-1.5 text-[12.5px] text-short" data-testid="al-url-err">{urlErr ?? "Use a public https:// URL."}</p>
            : <p id="al-url-help" className="mt-1.5 text-[12.5px] text-muted">Quiver POSTs JSON signed with HMAC-SHA256 (X-Quiver-Signature). Private and local addresses are blocked.</p>}
          <details className="mt-2 text-[12.5px] text-muted" data-testid="al-help"><summary className="cursor-pointer text-ink-2">For your receiver</summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              <li>Verify <code className="font-mono">X-Quiver-Signature</code>: <code className="font-mono">v1=</code> HMAC-SHA256 of <code className="font-mono">timestamp.rawBody</code> with your secret. Reject timestamps more than 5 minutes off.</li>
              <li><b className="font-medium text-ink-2">Dedupe on <code className="font-mono">X-Quiver-Delivery</code>.</b> It stays the same on every retry of one alert (it’s also <code className="font-mono">deliveryId</code> in the body). Retries are re-signed with a new timestamp, so the signature alone won’t spot a repeat.</li>
              <li>Answer 2xx quickly. Slow or failing receivers are retried with backoff.</li>
            </ul></details>
          {secret && (
            <div role="status" className="mt-3 rounded-[10px] border border-warn/40 p-3" data-testid="al-secret">
              <div className="text-[12.5px] text-warn">Copy your signing secret now. It won’t be shown again.</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-[6px] bg-black/30 px-2 py-1.5 font-mono text-[12px] text-ink" data-private>{secret}</code>
                <button className={btn} onClick={copy}>{copied ? "Copied" : "Copy"}</button>
                <button className={btn} onClick={() => setSecret(null)}>I saved it</button>
              </div>
            </div>)}
          <div className="mt-3 flex flex-wrap gap-2">
            {s.webhookUrl && <button className={btn} disabled={!!busy} onClick={() => save({ webhookUrl: s.webhookUrl, rotateSecret: true }, "rotate")}>{busy === "rotate" ? "Rotating…" : "Rotate secret"}</button>}
            {s.webhookUrl && <button className={`${btn} text-short`} disabled={!!busy} onClick={() => save({ webhookUrl: null }, "remove")}>Remove webhook</button>}
            <button className={btn} disabled={!!busy} onClick={test} data-testid="al-test">{busy === "test" ? "Sending…" : "Send test"}</button>
          </div>
          {msg && <p role="status" className="mt-2 text-[12.5px] text-muted">{msg}</p>}
        </div>
        <div>
          <div className="text-[13px] text-ink-2">Rules <span className="font-mono text-muted">{rules.length}/20</span></div>
          <ul className="mt-1.5 grid gap-1.5" data-testid="al-rules">
            {rules.length === 0 && <li className="text-[13px] text-muted">No rules yet. Add one to get alerts for all your runs.</li>}
            {rules.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3 py-2 text-[13px]">
              <span className="min-w-0 text-ink-2">{r.runId ? <span className="font-mono text-muted">{r.runId.slice(0, 12)}… · </span> : "All runs · "}{r.events.map((e) => EV[e] ?? e).join(", ")}{!r.enabled && <span className="text-muted"> · off</span>}</span>
              <button className="btn shrink-0 text-[12.5px] text-muted underline hover:text-short" disabled={busy === r.id} onClick={() => del(r.id)} aria-label={`Delete rule: ${r.events.join(", ")}`}>Delete</button></li>)}
          </ul>
          <fieldset className="mt-3"><legend className="text-[12.5px] text-muted">New rule · all runs</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{EVENTS.map(([e, l]) => { const on = pick.includes(e); return <button key={e} aria-pressed={on} onClick={() => setPick((p) => on ? p.filter((x) => x !== e) : [...p, e])} className={`btn rounded-full border px-3 py-1 text-[12.5px] ${on ? "border-accent/60 text-accent" : "border-line-2 text-ink-2 hover:bg-white/5"}`}>{l}</button>; })}</div>
          </fieldset>
          <button className={`${btn} mt-2`} disabled={!!busy || pick.length === 0 || rules.length >= 20} onClick={addRule} data-testid="al-add">{busy === "rule" ? "Adding…" : "Add rule"}</button>
          {ruleErr && <p role="alert" className="mt-1.5 text-[12.5px] text-short">{ruleErr}</p>}
        </div>
      </div>
      <div className="mt-6">
        <div className="flex items-center justify-between"><div className="text-[13px] text-ink-2">Recent deliveries</div><button className="text-[12.5px] text-muted underline" onClick={reload}>Refresh</button></div>
        <ul className="mt-1.5 divide-y divide-line font-mono text-[12.5px]" data-testid="al-deliveries">
          {dels.length === 0 && <li className="py-2 font-sans text-muted">Nothing sent yet.</li>}
          {dels.map((d) => <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2"><span className="text-ink-2">{d.kind === "test" ? "Test" : EV[d.eventType] ?? d.eventType}<span className="text-muted"> · {PROV[d.provider] ?? d.provider}</span><span className="text-muted"> · {when(d.createdAt)}</span></span>
            <span className={DS[d.status]?.[1]}>{DS[d.status]?.[0] ?? d.status}{d.attempts > 1 ? ` · ${d.attempts} tries` : ""}{d.lastStatusCode ? ` · ${d.lastStatusCode}` : ""}</span>
            {d.status === "failed" && d.lastError && <span className="w-full break-words font-sans text-[12px] text-short/90" data-testid="al-del-err">{d.lastError}</span>}</li>)}
        </ul>
      </div>
    </Card>
  );
}
