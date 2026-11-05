import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { raw } from "@/lib/api/live";
import type { PaperSession } from "@/lib/paper/sessions";
import { editFields, EditOps, preparePaperEdit } from "@/lib/paper/changes";

type Proposal = { revision: number; ops: EditOps; changes: ReturnType<typeof preparePaperEdit>["changes"] };
export default function PaperChangePanel({ session, onApply }: { session: PaperSession; onApply: (ops: EditOps, base: number) => Promise<void> }) {
  const fields = useMemo(() => editFields(session), [session.strategy, session.pausedRules]);
  const groups = [...new Map(fields.map(f => [f.group, f.rule])).entries()];
  const [group, setGroup] = useState(""), [text, setText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null), [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState(""), [receipt, setReceipt] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const revision = session.editRevision ?? 0;
  const stale = !!proposal && proposal.revision !== revision;
  function invalidate() {
    request.current?.abort(); request.current = null;
    setProposal(null); setError(""); setReceipt(""); setBusy(null);
  }
  async function preview() {
    if (busy || text.trim().length < 3) return;
    invalidate();
    const controller = new AbortController(); request.current = controller; setBusy("preview");
    try {
      const options = group ? fields.filter(f => f.group === group) : fields;
      const res = session.id.startsWith("srvpaper_") ? await raw("/workflow-sessions/"+encodeURIComponent(session.id)+"/edit-preview",{method:"POST",signal:controller.signal,body:JSON.stringify({text:text.trim(),group})}) : await fetch("/api/preview/paper-change", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ text: text.trim(), fields: options }) });
      const body = await res.json() as { message?: string; ops?: unknown };
      if (!res.ok) throw Error(body.message || "Could not preview the change.");
      const ops = EditOps.parse(body.ops);
      if (ops.some(op => !options.some(f => f.key === op.key))) throw Error("The proposed field is outside the selected rule.");
      const { changes } = preparePaperEdit(session, ops);
      if (!controller.signal.aborted) setProposal({ revision, ops, changes });
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not preview the change."); }
    finally { if (request.current === controller) { request.current = null; setBusy(null); } }
  }
  async function apply() {
    if (!proposal || stale || busy) return;
    setBusy("apply"); setError("");
    try {
      await onApply(proposal.ops, proposal.revision);
      setProposal(null); setText(""); setReceipt("Applied to this paper session. The next check uses the updated rules.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the change."); }
    finally { setBusy(null); }
  }
  return <section className="q-monitor-panel q-monitor-section" aria-labelledby="run-change-title">
    <div className="q-monitor-heading"><h2 id="run-change-title">Change this strategy</h2><span className="q-paper-tag">Paper session only</span></div>
    <form className="q-edit-form" onSubmit={e => { e.preventDefault(); void preview(); }}>
      <label>Rule<select value={group} disabled={busy === "apply"} onChange={e => { invalidate(); setGroup(e.target.value); }}>
        <option value="">From instruction</option>
        {groups.map(([id, label]) => <option key={id} value={id}>{label}{groups.filter(g => g[1] === label).length > 1 ? " · Step " + (groups.findIndex(g => g[0] === id) + 1) : ""}</option>)}
      </select></label>
      <label>Describe a change<input maxLength={500} value={text} disabled={busy === "apply"} onChange={e => { invalidate(); setText(e.target.value); }} placeholder={group === "$risk" ? "Set daily loss limit to 5%" : "e.g. Set stop loss to 5%"} /></label>
      <button type="submit" className="q-action" disabled={!!busy || text.trim().length < 3}>{busy === "preview" ? "Reading change…" : "Preview change"}<ArrowRight size={14} /></button>
    </form>
    <p className="q-edit-note">Preview a rule, order size, exit or risk limit before applying it to this session.</p>
    {error && <p className="q-edit-notice" role="alert">{error}</p>}
    {receipt && <p className="q-edit-receipt" role="status"><Check size={15} />{receipt}</p>}
    {proposal && <div className="q-edit-preview">
      <h3>Preview changes</h3><ul>{proposal.changes.map((c, i) => <li key={i}><span>{c.rule} · {c.label}</span><span className="q-edit-diff"><del>{c.before}</del><ArrowRight size={13} /><strong>{c.after}</strong></span></li>)}</ul>
      {stale && <p role="status">This session was edited elsewhere. Preview the latest rules again.</p>}
      <div className="q-edit-actions"><button className="q-action" type="button" onClick={invalidate} disabled={busy === "apply"}>Cancel</button><button className="q-action q-primary" type="button" onClick={() => void apply()} disabled={!!busy || stale}>{busy === "apply" ? "Applying…" : "Apply change"}</button></div>
    </div>}
  </section>;
}
