"use client";
import { useRef, useState } from "react";
import { api, API_MODE, type StrategyRecord } from "@/lib/api";
import { draftBackup, draftFingerprint, parseDraftBackup } from "@/lib/api/draft-backup";
import { listPreviewDrafts } from "@/lib/api/preview-workspace";

const button = "btn inline-flex min-h-11 items-center justify-center rounded-full border border-line-2 px-4 text-[13px] hover:bg-white/5 disabled:opacity-40";
async function ownDrafts(): Promise<StrategyRecord[]> {
  if (API_MODE === "mock") return listPreviewDrafts();
  const records = await api.strategies({ limit: 50 });
  if (records.nextCursor) throw new Error("This export supports up to 50 strategies. Narrow the collection before exporting.");
  return Promise.all(records.items.map((r) => api.strategy(r.id)));
}
export default function DraftTransfer({ onChange }: { onChange: () => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage(null); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Could not finish. Try again."); }
    finally { setBusy(false); }
  };
  const download = () => act(async () => {
    const records = await ownDrafts(); if (!records.length) throw new Error("Save a draft first, then export a backup.");
    const url = URL.createObjectURL(new Blob([JSON.stringify(draftBackup(records), null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `quiver-drafts-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`Exported ${records.length} draft${records.length === 1 ? "" : "s"}. Keep this file for the move to the permanent workspace.`);
  });
  const importFile = (picked?: File) => { if (!picked) return; void act(async () => {
    if (picked.size > 1_000_000) throw new Error("Use a Quiver backup under 1 MB.");
    const drafts = parseDraftBackup(await picked.text()), existing = await ownDrafts();
    const seen = new Set(existing.map((r) => draftFingerprint(r.strategy)));
    let imported = 0, skipped = 0;
    for (const d of drafts) {
      const fingerprint = draftFingerprint(d.strategy); if (seen.has(fingerprint)) { skipped++; continue; }
      try { await api.createStrategy(d.strategy); }
      catch (e) { onChange(); throw new Error(`${imported} imported, ${skipped} duplicates skipped. Import stopped: ${e instanceof Error ? e.message : "try again"}. The existing drafts are kept.`); }
      imported++; seen.add(fingerprint);
    }
    setMessage(`${imported} imported, ${skipped} duplicates skipped. ${API_MODE === "mock" ? "No paper run was started." : "Drafts are saved in your signed-in workspace; no run was started."}`); onChange();
  }); };
  const migrate = () => act(async () => {
    const source = await listPreviewDrafts(), target = await ownDrafts();
    const seen = new Set(target.map((r) => draftFingerprint(r.strategy)));
    if (!source.length) throw new Error("No preview drafts were found. Choose a downloaded backup to import.");
    let imported = 0, skipped = 0;
    for (const record of source) {
      const fingerprint = draftFingerprint(record.strategy); if (seen.has(fingerprint)) { skipped++; continue; }
      try { await api.createStrategy(record.strategy); }
      catch (e) { onChange(); throw new Error(`${imported} moved, ${skipped} duplicates skipped. ${e instanceof Error ? e.message : "Try again."} Preview copies are kept.`); }
      imported++; seen.add(fingerprint);
    }
    setMessage(`${imported} preview drafts moved, ${skipped} duplicates skipped. Preview copies are kept; no paper run was started.`); onChange();
  });
  return <section aria-label="Draft backup and transfer" className="mt-6 rounded-[14px] border border-line bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-[64ch] text-[13px] leading-relaxed">
        <h2 className="font-medium text-ink">Draft backups</h2>
        <p className="mt-1 text-muted">{API_MODE === "mock" ? "Export your drafts to keep a copy or move them to another device." : "Import a backup or move drafts saved in this browser to your account."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={download}>Export backup</button>
        <button className={button} disabled={busy} onClick={() => file.current?.click()}>Import backup</button>
        {API_MODE !== "mock" && <button className={button} disabled={busy} onClick={migrate}>Move preview drafts</button>}
        <input ref={file} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Quiver draft backup" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </div>
    {busy && <p role="status" className="mt-3 text-[13px] text-muted">Working… Keep this page open.</p>}
    {message && <p role="status" className="mt-3 text-[13px] text-accent">{message}</p>}
    {error && <p role="alert" className="mt-3 text-[13px] text-short">{error}</p>}
  </section>;
}
