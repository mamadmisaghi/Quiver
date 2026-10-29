"use client";
// M5.9 your own RPC URL (testnet 46630) and OpenRouter key. GET /me/secrets, PUT /me/secrets/rpc|ai, DELETE /me/secrets/:id.
// Rules: secret values live only in this component's input state while typing. They are never logged, persisted
// (no localStorage/URL), echoed back, or shown after save; the input is cleared after a successful save. The server
// only returns hints ("https://host/…", "sk-or-…abcd"). 503 secrets_unavailable → banner; 422 rpc_url_blocked → URL field.
import { useState } from "react";
import { Card, Pill } from "@/components/ui";
import { api, ApiErr, errOf, fmtAgo, type UserSecretView } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";

const btn = "btn min-h-10 rounded-full border border-line-2 px-4 text-[13px] hover:bg-white/5 disabled:opacity-40";
const inp = "min-h-10 w-full rounded-[8px] border border-line-2 bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent aria-[invalid=true]:border-short";
const UNAVAIL = "Saving your own endpoints and keys isn’t enabled on this server yet. Quiver’s shared testnet RPC and models are used instead.";
const AI_RE = /^sk-or-[A-Za-z0-9_-]{16,200}$/;
const say = (x: unknown, f: string) => x instanceof ApiErr ? (x.code === "rpc_url_blocked" ? `That URL can’t be used: ${x.message}` : x.code === "validation_failed" ? errOf(x, f) : errOf(x, f)) : f;

function SecretForm({ kind, onSaved, onUnavailable, disabled }: { kind: "rpc" | "ai_key"; onSaved: (v: UserSecretView) => void; onUnavailable: () => void; disabled: boolean }) {
  const [v, setV] = useState(""); const [label, setLabel] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const rpc = kind === "rpc"; const id = rpc ? "sec-rpc" : "sec-ai";
  const save = async () => {
    setErr(null); const t = v.trim();
    if (rpc && !/^https:\/\/\S+$/.test(t)) { setErr("Use a public https:// RPC URL."); return; }
    if (!rpc && !AI_RE.test(t)) { setErr("That doesn’t look like an OpenRouter key (sk-or-…)."); return; }
    setBusy(true);
    try {
      const r = rpc ? await api.putRpcSecret({ chainId: 46630, url: t, ...(label.trim() ? { label: label.trim() } : {}) }) : await api.putAiSecret({ provider: "openrouter", apiKey: t, ...(label.trim() ? { label: label.trim() } : {}) });
      setV(""); setLabel(""); onSaved(r);
    } catch (x) { if (x instanceof ApiErr && x.code === "secrets_unavailable") { setV(""); onUnavailable(); } else setErr(say(x, "Couldn’t save.")); }
    finally { setBusy(false); }
  };
  return (
    <form className="mt-4 grid gap-2" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid={`${id}-form`} autoComplete="off">
      <label htmlFor={id} className="text-[13px] text-ink-2">{rpc ? "RPC URL for Robinhood Chain testnet (46630)" : "OpenRouter API key"}</label>
      <input id={id} type={rpc ? "text" : "password"} inputMode={rpc ? "url" : undefined} value={v} maxLength={rpc ? 512 : 210}
        onChange={(e) => { setV(e.target.value); setErr(null); }} placeholder={rpc ? "https://…" : "sk-or-…"} autoComplete={rpc ? "off" : "new-password"} spellCheck={false} autoCapitalize="off"
        aria-invalid={!!err} aria-describedby={`${id}-hint${err ? ` ${id}-err` : ""}`} className={inp} disabled={disabled} data-testid={`${id}-input`} data-1p-ignore data-lpignore="true" />
      <p id={`${id}-hint`} className="text-[12.5px] text-muted">{rpc ? "Must be public https. We check it isn’t a private or local address, and keep only the host visible." : "Stored encrypted. You’ll only ever see the last 4 characters."}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={rpc ? "RPC label (optional)" : "Key label (optional)"} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className={`${inp} min-w-0 flex-1 basis-[160px]`} disabled={disabled} data-testid={`${id}-label`} />
        <button type="submit" className={btn} disabled={disabled || busy || !v.trim()} data-testid={`${id}-save`}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {err && <p id={`${id}-err`} role="alert" className="text-[12.5px] text-short" data-testid={`${id}-err`}>{err}</p>}
    </form>
  );
}

function Item({ x, onGone }: { x: UserSecretView; onGone: () => void }) {
  const [ask, setAsk] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const del = async () => { setBusy(true); setErr(null); try { await api.deleteSecret(x.id); onGone(); } catch (e) { setErr(say(e, "Couldn’t remove it.")); setBusy(false); } };
  return (
    <li className="py-3" data-testid="sec-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-words font-medium" data-testid="sec-label">{x.label}</span>
        <Pill tone="muted">{x.kind === "rpc" ? "RPC" : "AI key"}</Pill>
        {x.status === "undecryptable" && <Pill tone="warn">Re-enter</Pill>}
      </div>
      <p className="mt-1 break-all font-mono text-[12.5px] text-ink-2" data-testid="sec-hint">{x.hint}</p>
      <p className="mt-0.5 text-[12px] text-muted"><span className="tnum">Updated {fmtAgo(x.updatedAt)}</span>{" · "}{x.lastUsedAt ? <span className="tnum">used {fmtAgo(x.lastUsedAt)}</span> : "not used yet"}</p>
      {x.status === "undecryptable" && <p className="mt-1 text-[12.5px] text-warn">The server’s key changed, so this can’t be read. Save it again below.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {!ask ? <button className={btn} onClick={() => setAsk(true)} data-testid="sec-del">Remove</button>
          : <><button className="btn min-h-10 rounded-full bg-short/90 px-4 text-[13px] font-medium text-bg" onClick={del} disabled={busy} data-testid="sec-del-yes">{busy ? "Removing…" : "Yes, remove"}</button><button className={btn} onClick={() => setAsk(false)} disabled={busy}>Cancel</button></>}
      </div>
      {err && <p role="alert" className="mt-1 text-[12.5px] text-short">{err}</p>}
    </li>
  );
}

export default function SecretsCard() {
  const q = useQ(() => api.mySecrets());
  const [extra, setExtra] = useState<{ items: UserSecretView[] | null; unavailable: boolean }>({ items: null, unavailable: false });
  const [msg, setMsg] = useState<string | null>(null);
  const items = extra.items ?? q.data?.items ?? [];
  const unavailable = extra.unavailable || q.data?.vault === "unavailable";
  const saved = (v: UserSecretView) => { setExtra((e) => ({ ...e, items: [...items.filter((i) => i.id !== v.id), v] })); setMsg(`${v.label} saved.`); };
  return (
    <Card className="p-6" id="secrets" data-testid="secrets">
      <h2 className="font-medium">Your own endpoints and keys</h2>
      <p className="mt-1 text-[13.5px] text-muted">Optional. Use your own testnet RPC or OpenRouter key instead of Quiver’s shared ones. Testnet only.</p>
      {!q.data && !extra.unavailable ? <p className="mt-3 text-[13.5px] text-muted">{q.error ?? "Loading…"}</p> : <>
        {unavailable && <p role="status" className="mt-3 rounded-[8px] border border-line-2 bg-white/[.03] p-3 text-[13px] text-ink-2" data-testid="sec-unavailable">{UNAVAIL}</p>}
        {items.length > 0 && <ul className="mt-3 divide-y divide-line border-y border-line text-[13.5px]" data-testid="sec-list">{items.map((x) => <Item key={x.id + x.updatedAt} x={x} onGone={() => { setExtra((e) => ({ ...e, items: items.filter((i) => i.id !== x.id) })); setMsg("Removed."); }} />)}</ul>}
        <SecretForm kind="rpc" onSaved={saved} onUnavailable={() => setExtra((e) => ({ ...e, unavailable: true }))} disabled={unavailable} />
        <SecretForm kind="ai_key" onSaved={saved} onUnavailable={() => setExtra((e) => ({ ...e, unavailable: true }))} disabled={unavailable} />
        {msg && <p role="status" className="mt-3 text-[12.5px] text-ink-2" data-testid="sec-msg">{msg}</p>}
      </>}
    </Card>
  );
}
