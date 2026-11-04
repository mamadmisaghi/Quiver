"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Plus, FlaskConical } from "lucide-react";
import { api, API_MODE } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import { importHosted, loadHostedSessions } from "@/lib/paper/hosted";
import { listPaperSessions, PAPER_SESSION_EVENT, sessionStatus, type PaperSession } from "@/lib/paper/sessions";
import { paperEquity } from "@/services/backend/src/workflows/paper";
import Wrap from "@/components/Wrap";
import PageHeader from "@/components/PageHeader";
import Link from "@/components/Link";
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export default function PaperTrades() {
  const [sessions, setSessions] = useState<PaperSession[]>([]), [loaded, setLoaded] = useState(false);
  const hosted = useQ(() => API_MODE === "live" ? loadHostedSessions() : Promise.resolve([] as PaperSession[]));
  const [transfer,setTransfer] = useState(""), [moving,setMoving] = useState(false);
  const visible = API_MODE === "live" ? hosted.data ?? [] : sessions;
  const migrate = async () => {
    setMoving(true); let count=0;
    try { for(const s of sessions.filter(s=>s.strategy.workflow)){ await importHosted(s); count++; } setTransfer(count+" browser sessions archived on this account."); }
    catch(e){setTransfer(e instanceof Error?e.message:"Could not import history.");}
    finally {setMoving(false);hosted.reload();}
  };
  const remote = useQ(() => API_MODE !== "mock" ? api.runs() : Promise.resolve({ items: [], nextCursor: null }));
  useEffect(() => { const update = () => { setSessions(listPaperSessions()); setLoaded(true); }; update(); window.addEventListener("storage", update); window.addEventListener(PAPER_SESSION_EVENT, update); window.addEventListener("focus", update); return () => { window.removeEventListener("storage", update); window.removeEventListener(PAPER_SESSION_EVENT, update); window.removeEventListener("focus", update); }; }, []);
  return <Wrap><PageHeader title="Paper trades" sub="Each session keeps its own balance, positions and trade log." right={<Link href="/app/new" className="q-action q-primary"><Plus size={15} />New strategy</Link>} />
    {!loaded || API_MODE === "live" && !hosted.data && !hosted.error ? <div className="mt-8 h-48 animate-pulse rounded-[14px] border border-line bg-card" /> : visible.length ? <div className="mt-8 overflow-hidden rounded-[14px] border border-line bg-card"><div className="hidden grid-cols-[minmax(0,1fr)_130px_120px_90px_28px] gap-5 border-b border-line px-6 py-3 text-[12px] text-muted lg:grid"><span>Strategy / session</span><span>Status</span><span>Equity</span><span>Fills</span><span /></div>{visible.map((s) => <Link key={s.id} href={`/app/run/${s.id}`} className="q-linked-row grid items-center gap-3 border-b border-line px-5 py-5 transition-colors last:border-b-0 hover:bg-white/[.025] sm:px-6 lg:grid-cols-[minmax(0,1fr)_130px_120px_90px_28px] lg:gap-5"><span className="min-w-0"><span className="block truncate text-[14px] font-medium">{s.name}</span><span className="mt-1.5 block text-[12px] text-muted">{s.provenance === "imported" ? "Imported history" : s.provenance === "server" ? "Server paper" : s.mode === "scenario" ? "Archived simulation" : "Live quote paper"} · v{s.strategyVersion} · {new Date(s.createdAt).toLocaleString()}</span></span><span className="flex items-center gap-2 text-[12px] capitalize text-muted"><span className={`h-1.5 w-1.5 rounded-full ${sessionStatus(s) === "running" ? "bg-accent" : "bg-muted"}`} />{s.mode === "scenario" ? "Archived" : sessionStatus(s)}</span><span className="font-mono text-[14px]">{money(s.state ? paperEquity(s.state) : s.legacyResult?.result ? Number(s.legacyResult.result.endingEquityUsd) : (s.startingBalance ?? s.strategy.workflow?.budgetUsd ?? 0))}</span><span className="text-[12px] text-muted">{s.state?.events.length ?? s.legacyResult?.result?.fills.length ?? 0} fills</span><ArrowUpRight size={16} className="hidden text-muted lg:block" /></Link>)}</div> : hosted.error || !!remote.data?.items.length ? null : <div className="mt-8 rounded-[14px] border border-line bg-card px-6 py-12"><FlaskConical size={24} strokeWidth={1.5} className="text-muted" /><h2 className="mt-4 text-[18px] font-medium">Start your first paper session</h2><p className="mt-2 max-w-lg text-[14px] leading-relaxed text-muted">Build your rules, complete the settings and choose Run paper trade. Your session will appear here.</p><Link href="/app/new" className="q-action mt-6">Create a strategy<ArrowUpRight size={14} /></Link></div>}
    {hosted.error && <p role="alert" className="mt-4 text-muted">{hosted.error}</p>}
    {API_MODE === "live" && sessions.some(s=>s.strategy.workflow) && <section className="q-monitor-panel mt-5 p-5"><h2>Browser history</h2><p className="my-2 text-muted">Import a read-only copy of the paper history on this device.</p><button disabled={moving} className="q-action" onClick={()=>void migrate()}>{moving?"Importing…":"Import browser history"}</button><p role="status">{transfer}</p></section>}
    {remote.error && <p role="alert" className="mt-5 text-[13px] text-short">{remote.error}</p>}{!!remote.data?.items.length && <div className="mt-6 divide-y divide-line rounded-[14px] border border-line">{remote.data.items.map((r) => <Link key={r.id} href={`/app/run/${r.id}`} className="flex justify-between gap-3 p-5 text-[13px]"><span>{r.strategyId}</span><span className="text-muted">{r.status}</span></Link>)}</div>}
    {API_MODE === "mock" && sessions.length > 0 && <p className="mt-6 text-[12px] text-muted">Sessions are saved in this browser. Quote updates pause when you leave a session.</p>}
  </Wrap>;
}
