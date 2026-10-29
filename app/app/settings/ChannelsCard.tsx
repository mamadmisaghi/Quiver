"use client";
// M5.8 chat alert channels: GET /alerts/channels, PUT /alerts/channels/:name { target | null }.
// Telegram is primary; X sends as a DM. M5.14: real senders; status "ok" = server token set, "not_configured" = no token yet
// ("stub" stays in the enum for old rows and reads the same as not_configured).
// M5.10: X target = @ + 4–15 [A-Za-z0-9_], no "twitter"/"admin", not all digits. Checked here first; a 422 with
// details.field === "target" from the server is shown on the same field.
import { useState } from "react";
import { Card, Pill } from "@/components/ui";
import { api, ApiErr, errOf, type AlertChannel } from "@/lib/api";
import { normTarget } from "@/lib/api/channel-mock";
import { useQ } from "@/lib/api/useQ";

const btn = "btn min-h-10 rounded-full border border-line-2 px-4 text-[13px] hover:bg-white/5 disabled:opacity-40";
const STATUS: Record<AlertChannel["status"], [string, "long" | "muted" | "accent"]> = { ok: ["Sending", "long"], stub: ["Not set up on this server", "muted"], not_configured: ["Not set up on this server", "muted"] };
const fieldOf = (x: unknown) => (x instanceof ApiErr ? (x.details as { field?: unknown } | undefined)?.field : undefined);

function Channel({ c0 }: { c0: AlertChannel }) {
  const [c, setC] = useState(c0); const [v, setV] = useState(c0.target ?? "");
  const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const id = `ch-${c.name}`;
  const save = async (target: string | null) => {
    setErr(null); setMsg(null);
    if (target !== null && !normTarget(c.name, target)) { setErr(`Enter a valid ${c.label} destination: ${c.targetHint}.`); return; }
    setBusy(true);
    try { const r = await api.putAlertChannel(c.name, target); setC(r); setV(r.target ?? ""); setMsg(r.target ? "Saved." : "Removed."); }
    catch (x) { const m = x instanceof ApiErr && x.code === "validation_failed" ? x.message : errOf(x, "Couldn’t save."); if (fieldOf(x) === "target" || !(x instanceof ApiErr)) setErr(m); else setMsg(m); }
    finally { setBusy(false); }
  };
  const [sl, tone] = STATUS[c.status];
  return (
    <li className="py-4" data-testid={`channel-${c.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.label}</span>{c.primary && <Pill tone="muted">Primary</Pill>}<Pill tone={tone}>{sl}</Pill>
        {c.target && <span className="min-w-0 break-all text-[13px] text-ink-2" data-testid="ch-current">→ {c.target}</span>}
      </div>
      <form className="mt-2 flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); save(v.trim()); }}>
        <div className="min-w-0 flex-1 basis-[220px]">
          <label htmlFor={id} className="sr-only">{c.label} destination</label>
          <input id={id} value={v} maxLength={64} onChange={(e) => { setV(e.target.value); setErr(null); }} placeholder={c.name === "x" ? "@yourhandle" : "123456789 or @channel"}
            aria-invalid={!!err} aria-describedby={`${id}-hint${err ? ` ${id}-err` : ""}`} autoComplete="off" spellCheck={false}
            className="min-h-10 w-full rounded-[8px] border border-line-2 bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent aria-[invalid=true]:border-short" data-testid="ch-input" />
          <p id={`${id}-hint`} className="mt-1 text-[12.5px] text-muted" data-testid="ch-hint">{c.name === "x" ? "Your X handle, 4–15 letters, digits or _. Alerts arrive as a DM, max 280 characters." : `A numeric chat id or @channelname. Max ${c.maxMessageLength.toLocaleString()} characters per alert.`}</p>
          {err && <p id={`${id}-err`} role="alert" className="mt-1 text-[12.5px] text-short" data-testid="ch-err">{err}</p>}
        </div>
        <button type="submit" className={btn} disabled={busy || !v.trim()} data-testid="ch-save">{busy ? "Saving…" : "Save"}</button>
        {c.target && <button type="button" className={btn} disabled={busy} onClick={() => save(null)} data-testid="ch-clear">Remove</button>}
      </form>
      {c.status !== "ok" && <p className="mt-1 text-[12.5px] text-muted" data-testid="ch-off">{c.label} sending isn’t switched on here yet. You can save a destination now; nothing is sent until it is.</p>}
      {msg && <p role="status" className="mt-1 text-[12.5px] text-ink-2" data-testid="ch-msg">{msg}</p>}
    </li>
  );
}

export default function ChannelsCard() {
  const q = useQ(() => api.alertChannels());
  return (
    <Card className="p-6" data-testid="alert-channels" id="channels">
      <h2 className="font-medium">Chat alerts</h2>
      <p className="mt-1 text-[13.5px] text-muted">Get the same alerts as your webhook in Telegram or as an X DM. Uses your alert rules above.</p>
      {!q.data ? <p className="mt-3 text-[13.5px] text-muted">{q.error ?? "Loading…"}</p>
        : <ul className="mt-2 divide-y divide-line">{q.data.items.map((c) => <Channel key={c.name} c0={c} />)}</ul>}
    </Card>
  );
}
