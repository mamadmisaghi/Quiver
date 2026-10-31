"use client";
import { canonicalizeWorkflow } from "@/lib/contracts";
import WorkflowReview from "./WorkflowReview";
import { workflowView } from "@/services/backend/src/engine/workflow-view";
import { useEffect, useRef, useState } from "react";
import StrategyGraph from "./StrategyGraph";
import Link from "./Link";
import dynamic from "next/dynamic";
import VenueMark from "./VenueMark";
import { useRouter } from "next/navigation";
import { HUMANIZED } from "@/lib/api/fixtures";
import { API_MODE, api, ApiErr, reasonOf, errCopy, errOf, strategyEdges, demoNodes, DEMO_LABEL, type GNode, type Humanized, type Strategy, type ValidationIssue } from "@/lib/api";
import { onSession } from "@/lib/api/session";
// QA P2 LCP: the backtest panel only renders after a draft, so keep it out of the initial chunk
const WorkflowLab = dynamic(() => import("./WorkflowLab"), { ssr: false });
const BacktestPanel = dynamic(() => import("./BacktestPanel"), { ssr: false });
import SignInButton from "./SignInButton";
import { SAMPLE_PROMPT, SUGGESTIONS } from "@/lib/copy";
import PreviewWorkspaceNotice from "./PreviewWorkspaceNotice";
import { previewSaveLocation } from "@/lib/api/preview-workspace";
import { strategyNodes as deriveNodes } from "@/lib/api/graph";

type Phase = "idle" | "drafting" | "done" | "error";
type Step = { step: string; label: string };

const sugg = (d: unknown): string[] => { const s = (d as { suggestions?: unknown } | null)?.suggestions; return Array.isArray(s) ? s.filter((x): x is string => typeof x === "string") : []; };

// M5.6 (+M5.10 reasons): what each image_invalid reason means for the person who attached the chart.
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp"] as const; const IMG_MAX = 2_000_000;
const IMAGE_COPY: Record<string, string> = {
  bad_dimensions: "That image is too small or too large. Use a screenshot between 64 and 4096 px on each side.",
  type_mismatch: "The file’s contents don’t match its type. Re-save it as PNG, JPEG or WebP and attach it again.",
  corrupt: "That image looks damaged and couldn’t be read. Take a fresh screenshot and try again.",
  unsupported_type: "Use a PNG, JPEG or WebP screenshot.", bad_encoding: "That image couldn’t be read. Attach it again.", too_large: "That image is over 2 MB. Crop or compress it.",
};
const imgErr = (x: unknown) => x instanceof ApiErr && x.code === "image_invalid" ? IMAGE_COPY[reasonOf(x) ?? ""] ?? "That image couldn’t be used. Try another screenshot."
  : x instanceof ApiErr && x.code === "payload_too_large" ? IMAGE_COPY.too_large : null;
type Img = { name: string; mime: (typeof IMG_TYPES)[number]; b64: string; bytes: number; url: string };
const PREVIEW_PROMPTS = [
  "Buy $250 of NVDA if it drops below $120, stop loss 8%, take profit 15%",
  "Long $400 of ETH at 3x when RSI is below 30, stop loss 5%",
  "Buy $100 of BTC every Monday at 9am",
];
const STEP_SLOTS = 6;
// Reserve the sample graph's height (values on, so the tallest variant) before the draft streams in.
const RESERVE: GNode[] = demoNodes.map((n) => ({ ...n, value: n.kind === "watch" ? "0" : n.value }));
export default function Builder({ initialPrompt }: { initialPrompt?: string } = {}) {
  const [text, setText] = useState(initialPrompt || SAMPLE_PROMPT);
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [humanized, setHumanized] = useState<Humanized | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [took, setTook] = useState(0);
  const [compiledText, setCompiledText] = useState<string | null>(null);
  const [compiledImage, setCompiledImage] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<{ id: string; version: number } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [previewAiReady, setPreviewAiReady] = useState(false);
  const [demo, setDemo] = useState<string | null>(null); // compiler === "demo" → notice text
  const [suggest, setSuggest] = useState<string[]>([]); // unsupported_prompt suggestions
  const ctl = useRef<AbortController | null>(null);
  const [img, setImg] = useState<Img | null>(null); // held in memory only; never stored
  const dirty = compiledText !== null && (compiledText !== text || compiledImage !== (img?.url ?? null));
  const [imgMsg, setImgMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { if (img) URL.revokeObjectURL(img.url); }, [img]);
  const pick = (f: File | undefined) => {
    setImgMsg(null); if (!f) return;
    if (!(IMG_TYPES as readonly string[]).includes(f.type)) { setImgMsg(IMAGE_COPY.unsupported_type); return; }
    if (f.size > IMG_MAX) { setImgMsg(IMAGE_COPY.too_large); return; }
    const r = new FileReader();
    r.onload = () => { const b64 = String(r.result).replace(/^data:[^;,]+;base64,/, ""); setImg({ name: f.name, mime: f.type as Img["mime"], b64, bytes: f.size, url: URL.createObjectURL(f) }); };
    r.onerror = () => setImgMsg(IMAGE_COPY.bad_encoding); r.readAsDataURL(f);
  };
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [confirmEach, setConfirmEach] = useState(false); // M4.2 approvalMode
  const [ttl, setTtl] = useState(300);
  const paperTrade = async () => {
    if (!strategy || dirty) return; setStarting(true); setErr(null);
    try { const rec = await api.createStrategy(strategy); const r = await api.startRun({ strategyId: rec.id, mode: "paper", ...(confirmEach ? { approvalMode: "confirm_each" as const, approvalTtlSec: ttl } : {}) }); router.push(`/app/run/${r.id}`); }
    catch (x) { setErr(errOf(x, "Couldn't start the paper run.")); setStarting(false); }
  };

  const run = async (instruction?: string, thesis = text) => {
    const baseForRefine = strategy;
    const old = { strategy, humanized, nodes, issues, demo, savedId };
    const effectiveInstruction = instruction ?? (strategy && /^\s*(add|change|edit|tighten|remove|adjust|increase|decrease|set|only trade|اضافه|تغییر|حذف|ویرایش)(?:\s|$)/i.test(thesis) ? thesis : undefined);
    ctl.current?.abort(); const c = (ctl.current = new AbortController()); const t0 = performance.now();
    setSavedId(null); setSaveNotice(null); setStrategy(null); setIssues([]); setPhase("drafting"); setSteps([]); setErr(null); setSuggest([]); setDemo(null); setNodes([]); setHumanized(null);
    const fresh: GNode[] = [];
    try {
      const useImg = img && !effectiveInstruction;
      const onEv = (e: Parameters<Parameters<typeof api.compile>[1]>[0]) => {
        if (c.signal.aborted) return;
        if (e.type === "progress") setSteps((s) => [...s.filter((x) => x.step !== e.step), { step: e.step, label: e.label }]);
        else if (e.type === "partial") { fresh.push(e.node); setNodes([...fresh]); }
        else if (e.type === "result") { if (effectiveInstruction) setText(e.strategy.thesis); setCompiledText(effectiveInstruction ? e.strategy.thesis : thesis); setCompiledImage(img?.url ?? null); setStrategy(e.strategy); setHumanized(e.humanized); setIssues(e.issues); setDemo(e.compiler === "demo" ? e.notice ?? "Rules come from keyword matching, not AI. Check every value." : null); setPhase("done"); setTook(performance.now() - t0); }
        else if (e.type === "error") { if (old.strategy) { setStrategy(old.strategy); setHumanized(old.humanized); setNodes(old.nodes); setIssues(old.issues); setDemo(old.demo); setSavedId(old.savedId); } setErr(e.message.replace(/^Demo compile:\s*/, "")); setSuggest(e.suggestions ?? []); setPhase(old.strategy ? "done" : "error"); }
      };
      if (useImg) await api.compileImage({ mimeType: img.mime, imageBase64: img.b64, ...(thesis.trim() ? { note: thesis.trim().slice(0, 500) } : {}) }, onEv, c.signal);
      else await api.compile({ thesis, ...(effectiveInstruction && baseForRefine ? { baseStrategy: baseForRefine, instruction: effectiveInstruction } : {}) }, onEv, c.signal);
    } catch (x) { if ((x as Error).name !== "AbortError") { setErr(imgErr(x) ?? errOf(x, "Compile failed")); setSuggest(x instanceof ApiErr ? sugg(x.details) : []); if (old.strategy) { setStrategy(old.strategy); setHumanized(old.humanized); setNodes(old.nodes); setIssues(old.issues); setDemo(old.demo); setSavedId(old.savedId); } setPhase(old.strategy ? "done" : "error"); } }
  };
  const [guest, setGuest] = useState(API_MODE !== "mock");
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const prompt = initialPrompt ?? sp.get("idea") ?? sp.get("q");
    if (prompt) setText(prompt.slice(0, 2000));
    const id = sp.get("strategy"); let on = true;
    if (id) api.strategy(id).then((rec) => {
      if (!on) return;
      if (rec.strategy.workflow) rec.strategy.workflow = canonicalizeWorkflow(rec.strategy.workflow);
      setText(rec.strategy.thesis); setCompiledText(rec.strategy.thesis); setStrategy(rec.strategy);
      setEditingRecord({ id: rec.id, version: rec.version });
      setHumanized(rec.humanized); setNodes(deriveNodes(rec.strategy, Object.fromEntries(rec.nodes.map((node) => [node.id, node])))); setIssues(rec.issues); setSavedId(rec.id); setPhase("done");
      setDemo(null);
      if (API_MODE === "mock") setSaveNotice("Saved preview draft. Continuous paper runs are pending activation.");
    }).catch((e) => on && setErr(errOf(e, "Could not open this draft.")));
    return () => { on = false; ctl.current?.abort(); };
  }, [initialPrompt]);
  const saveDraft = async () => {
    if (!strategy || dirty) return;
    setSaving(true); setErr(null);
    try { const record = editingRecord ? await api.updateStrategy(editingRecord.id, strategy, editingRecord.version) : await api.createStrategy(strategy); setEditingRecord({ id: record.id, version: record.version }); setSavedId(record.id); if (API_MODE === "mock") setSaveNotice(previewSaveLocation() === "online" ? "Saved online and in this browser." : "Saved in this browser. Export a backup from Strategies to keep a portable copy."); }
    catch (e) { setErr(errOf(e, "Could not save this draft.")); }
    finally { setSaving(false); }
  };

  useEffect(() => onSession(() => setGuest(false)), []);

  const edges = strategy ? strategyEdges(strategy).map((e) => ({ ...e, hot: false })) : [];
  const graphNodes = phase === "done" || nodes.length ? nodes : [];
  const venues = [...new Set(nodes.map((n) => n.venue).filter(Boolean))] as NonNullable<GNode["venue"]>[];
  const drafting = phase === "drafting";

  return (
    <div className="mx-auto max-w-[1040px] px-5 py-10 sm:px-8 sm:py-14">
      <h1 className="text-[clamp(1.9rem,3.4vw,2.6rem)] font-medium tracking-[-0.035em]">{editingRecord ? "Edit strategy" : "New strategy"}</h1>
      <p className="mt-2 max-w-[56ch] text-[14.5px] text-muted">Describe the strategy in your own words. Quiver drafts the rules and the graph. Nothing runs until you press start.</p>

      {API_MODE === "mock" && <PreviewWorkspaceNotice onReady={setPreviewAiReady} />}
      {/* 1 — Prompt */}
      <form className="mt-8 rounded-[14px] border border-line-2 bg-card p-1.5 transition-colors focus-within:border-accent/50" data-motion="prompt"
        onSubmit={(e) => { e.preventDefault(); if (text.trim() || img) run(); }}>
        <label htmlFor="thesis" className="sr-only">Your strategy</label>
        <textarea id="thesis" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3}
          onKeyDown={(e) => { if (!drafting && text.trim().length >= 8 && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } }}
          placeholder="e.g. Buy $200 of AAPL on Robinhood Chain when it opens 2% red."
          className="block max-h-[45vh] min-h-[96px] w-full resize-none bg-transparent px-3.5 pb-2 pt-3 text-[15px] [field-sizing:content] leading-relaxed text-ink placeholder:text-muted focus:outline-none" />
        <div className="flex items-center justify-between gap-3 px-2 pb-1.5">
          <div className="flex items-center gap-3 text-[12px] text-muted">
            <input ref={fileRef} type="file" accept={IMG_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-hidden data-testid="chart-file"
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            {img ? <span className="flex min-w-0 items-center gap-2 rounded-full border border-accent/40 py-0.5 pl-0.5 pr-1 text-ink-2" data-testid="chart-chip">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-6 w-6 rounded-full object-cover" />
                <span className="max-w-[12ch] truncate sm:max-w-[22ch]" title={img.name}>{img.name}</span><span className="tnum shrink-0">{img.bytes < 1e6 ? `${Math.max(1, Math.round(img.bytes / 1e3))} KB` : `${(img.bytes / 1e6).toFixed(1)} MB`}</span>
                <button type="button" onClick={() => setImg(null)} aria-label="Remove chart" className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/10" data-testid="chart-remove">×</button></span>
              : <button type="button" disabled={API_MODE === "mock" && !previewAiReady} title={API_MODE === "mock" && !previewAiReady ? "Sign in with ChatGPT for configured chart AI" : undefined} onClick={() => fileRef.current?.click()} className="btn min-h-11 rounded-full border border-line-2 px-2.5 py-1 hover:border-white/30 hover:text-ink disabled:opacity-40" data-testid="chart-attach">Attach chart</button>}
            <span className="hidden font-mono sm:inline">Ctrl / ⌘ Enter</span>
          </div>
          <button type="submit" disabled={drafting || (text.trim().length < 8 && !img)}
            className={`btn rounded-full px-4 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${phase === "done" ? "border border-line-2 text-ink hover:border-white/30 hover:bg-white/5" : "bg-accent font-medium text-bg hover:brightness-110 active:bg-accent-press"}`}>
            {drafting ? "Drafting…" : phase === "done" && !dirty ? "Redraft" : "Draft strategy"}
          </button>
        </div>
      </form>
      {imgMsg && <p role="alert" className="mt-2 px-1 text-[13px] text-short" data-testid="chart-msg">{imgMsg}</p>}
      {img && <p className="mt-2 px-1 text-[12.5px] text-muted" data-testid="chart-note">The chart is sent to the AI provider to draft rules, using your text as a hint. Quiver does not keep the uploaded image.</p>}
      {guest && phase === "idle" && (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line px-4 py-3 text-[13.5px] text-ink-2">
          <span>Sign in to save drafts and paper-trade them, or press Draft strategy to try it first.</span>
          <SignInButton onDone={() => { setGuest(false); run(); }} />
        </div>)}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" tabIndex={0} role="region" aria-label="Example prompts">
        {(API_MODE === "mock" ? PREVIEW_PROMPTS : SUGGESTIONS).map((s) => (
          <button key={s} type="button" onClick={() => setText(s)}
            className="btn shrink-0 rounded-full border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-line-2 hover:text-ink">{s}</button>
        ))}
      </div>

      {dirty && <p role="status" className="mt-4 text-[13px] text-accent">The description changed. Press Draft strategy to update the graph before saving or running.</p>}
      {/* 2 — AI draft */}
      <section aria-live="polite" className="mt-10 grid gap-4" data-motion="draft">
        <ol className="grid grid-cols-1 items-center gap-x-6 gap-y-2.5 md:grid-cols-2 rounded-[14px] border border-line bg-bg-2 px-5 py-4">
          <li className="col-span-full font-mono text-[12px] uppercase tracking-[.14em] text-muted">Strategy draft</li>
          {steps.length === 0 && <li className="flex h-5 min-w-0 items-start gap-2.5 text-[13px] leading-5 text-muted"><span className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-full border border-line-2" />{phase === "idle" ? "Waiting for your thesis" : phase === "done" ? "Saved draft loaded" : "Starting…"}</li>}
          {steps.map((s, i) => {
            const done = phase === "done" || (phase === "drafting" && i < steps.length - 1), now = phase === "drafting" && !done;
            return (
              <li key={s.step} className="flex h-5 min-w-0 items-start gap-2.5 text-[13px] leading-5">
                <span className={`mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${done ? "border-accent bg-accent-soft" : "border-line-2"}`}>
                  {done && <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden><path d="M1.5 4.2 3.2 5.8 6.5 2.2" fill="none" stroke="var(--q-amber)" strokeWidth="1.4" /></svg>}
                </span>
                <span className={`truncate ${done ? "text-ink-2" : ""}`} title={s.label} data-motion={now ? "shimmer" : undefined}>{s.label}</span>
              </li>
            );
          })}
          {/* fixed slot count: the box keeps its height while steps stream in and after the draft lands (CLS) */}
          {Array.from({ length: Math.max(0, STEP_SLOTS - Math.max(1, steps.length)) }, (_, i) => (
            <li key={`slot${i}`} aria-hidden className="invisible flex h-5 min-w-0 items-start gap-2.5 text-[13px] leading-5"><span className="mt-[3px] h-3.5 w-3.5 rounded-full" />Resolving markets on 3 venues</li>))}
          <li className="col-span-full flex min-h-[26px] min-w-0 flex-wrap items-center justify-end gap-2 font-mono text-[12px] text-muted">
            {phase === "error" ? <span role="alert" className="text-short">{err}</span>
              : phase === "done" ? <><span className="min-w-0 truncate text-ink-2">Drafted · {nodes.length} nodes · {venues.length} venues · {(took / 1000).toFixed(1)}s</span>{demo && <span className="shrink-0 rounded-full border border-line-2 px-2.5 py-0.5 font-sans text-[12px]" title={demo}>Demo compile</span>}</>
              : phase === "idle" ? "" : "Working…"}
          </li>
        </ol>
        <p className="-mt-2 min-h-[54px] px-1 text-[12px] text-muted sm:min-h-[36px]">{phase === "done" ? demo : null}</p>
        {phase === "error" && suggest.length > 0 && (
          <div className="-mt-1 flex flex-wrap items-center gap-2 px-1">
            <span className="text-[12.5px] text-muted">Try one of these:</span>
            {suggest.map((t) => <button key={t} type="button" onClick={() => { setText(t); run(undefined, t); }} className="btn rounded-full border border-line-2 px-3 py-1 text-[12.5px] text-ink-2 hover:border-accent/50 hover:text-ink">{t}</button>)}
          </div>)}

        <div className="rounded-[14px] border border-line bg-bg-2 p-5 sm:p-6 [content-visibility:auto] [contain-intrinsic-size:auto_560px]">{/* QA P2 LCP: below the fold at load; skip its paint until near view */}
          <div className="mb-6 flex items-center justify-between">
            <span className="font-mono text-[12px] uppercase tracking-[.14em] text-muted">Graph</span>
            <span className="rounded-full border border-line-2 px-2.5 py-1 text-[12px] text-muted">{DEMO_LABEL}</span>
          </div>
          <StrategyGraph nodes={graphNodes} edges={edges} revealed={graphNodes.length} ghosts={phase === "drafting" ? 1 : 0} reserve={RESERVE} />
        </div>
      </section>

      {strategy?.workflow && phase !== "drafting" && <WorkflowReview workflow={strategy.workflow} onChange={(workflow) => {
        const view = workflowView(workflow); setStrategy({ ...strategy, workflow, risk: { ...strategy.risk, ...(workflow.risk ?? {}) } }); setHumanized(view.humanized); setNodes(view.nodes); setSavedId(null); setSaveNotice(null);
      }} />}

      {strategy?.workflow && phase === "done" && !dirty && <WorkflowLab key={JSON.stringify(strategy)} strategy={strategy} />}

      {/* 3 — Readable rules */}
      <section className={`mt-6 grid gap-px overflow-hidden rounded-[14px] border border-line bg-line md:grid-cols-4`} data-motion="rules">
        {(["watch", "when", "do", "exit"] as const).map((k) => (
          <div key={k} className="bg-bg p-5">
            <div className={`font-mono text-[12px] uppercase tracking-[.14em] text-muted`}>{{ watch: "Signals", when: "Trigger", do: "Actions", exit: "Exits" }[k]}</div>
            <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-2">
              {(humanized ?? (phase === "done" ? null : HUMANIZED))?.[k]?.map((it) => <li key={it} aria-hidden={!humanized || undefined} className={humanized ? undefined : "invisible"}>{it}</li>)}
            </ul>
          </div>
        ))}
      </section>

      {/* M5 fix (Robin gate 4ab4ad6): refine is CompileReq {baseStrategy, instruction} on the same compile stream. */}
      {strategy && phase !== "drafting" && !dirty && <RefineBar onRefine={(t) => run(t)} />}
      <div data-reserve="after" className="min-h-[160px] md:min-h-[96px]">
      {issues.length > 0 && <ul className="mt-4 space-y-1 text-[13px]">{issues.map((i) => <li key={i.path + i.code} className={i.severity === "error" ? "text-short" : "text-muted"}>{i.severity === "error" ? "" : "Note: "}{i.message}</li>)}</ul>}
      {phase === "done" && strategy && !strategy.workflow && <div className="mt-6"><BacktestPanel key={JSON.stringify(strategy)} strategy={strategy} /></div>}
      </div>
      <p className="mt-8 pb-24 text-[12px] text-muted">{DEMO_LABEL}. Stock tokens are not available to US persons. Trading can lose money.</p>

      {/* Action bar pinned to the viewport bottom; Paper-trade it is the only amber primary on the page once drafted */}
      <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-10 -mx-5 border-t border-line bg-bg/90 px-5 py-3 backdrop-blur-md lg:bottom-0 sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">{venues.map((v) => <VenueMark key={v} venue={v} />)}<span className="ml-1 truncate">{phase === "done" ? strategy?.workflow ? "Workflow draft · execution pending" : API_MODE === "mock" ? "Preview draft" : "Ready for paper trading" : drafting ? "Drafting…" : ""}</span></span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {err && phase === "done" && <span role="status" className="text-[12.5px] text-short">{err}</span>}
            {phase === "done" && API_MODE !== "mock" && <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={confirmEach} onChange={(e) => setConfirmEach(e.target.checked)} className="accent-[var(--color-accent)]" data-testid="confirm-each" />Ask before each trade</label>
              {confirmEach && <label className="flex items-center gap-1 text-muted"><span className="sr-only">Approval window</span><select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="rounded-[6px] border border-line-2 bg-bg px-1 py-0.5 text-ink-2">{[[60, "1 min"], [300, "5 min"], [900, "15 min"], [3600, "1 hour"]].map(([v, l]) => <option key={v} value={v}>{l} to answer</option>)}</select></label>}
            </span>}
            <button type="button" onClick={() => run()} disabled={drafting || !text.trim()} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-white/30 hover:bg-white/5 disabled:opacity-40">Redraft</button>
            <button type="button" onClick={saveDraft} disabled={phase !== "done" || dirty || saving || !!savedId || issues.some((i) => i.severity === "error")} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-white/30 disabled:opacity-40">{saving ? "Saving…" : savedId ? "Saved" : "Save draft"}</button>
            {savedId && <Link href="/app/strategies" className="text-[13px] text-accent underline underline-offset-4">View drafts</Link>}
            <button type="button" onClick={() => strategy?.workflow ? document.getElementById("workflow-lab")?.scrollIntoView({ behavior: "smooth", block: "start" }) : paperTrade()} title={strategy?.workflow ? "Open the workflow test lab" : API_MODE === "mock" ? "Connect the paper engine to run your own rules" : undefined} disabled={(!strategy?.workflow && API_MODE === "mock") || dirty || phase !== "done" || starting || issues.some((i) => i.severity === "error")} className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:brightness-110 active:bg-accent-press disabled:opacity-40">{strategy?.workflow ? "Test workflow →" : API_MODE === "mock" ? "Paper engine not connected" : starting ? "Starting…" : "Paper-trade it →"}</button>
          </div>
        </div>
      </div>
      {saveNotice && <p role="status" className="mt-3 text-[13px] text-accent">{saveNotice}</p>}
    </div>
  );
}

const REFINE_CHIPS = ["Add a weekend-only filter", "Tighten the stop to 3%", "Only trade during US market hours"];
function RefineBar({ onRefine }: { onRefine: (instruction: string) => void }) {
  const [t, setT] = useState("");
  const go = (x: string) => { const v = x.trim(); if (v) { onRefine(v); setT(""); } };
  return (
    <form className="mt-4" data-testid="refine" onSubmit={(e) => { e.preventDefault(); go(t); }}>
      <label htmlFor="refine-in" className="text-[12.5px] text-muted">Refine this draft in plain English</label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input id="refine-in" value={t} maxLength={500} onChange={(e) => setT(e.target.value)} placeholder="e.g. Exit if it drops 5% in a day"
          className="min-w-0 flex-1 basis-56 rounded-full border border-line-2 bg-bg-2 px-4 py-2 text-[13.5px] outline-none focus:border-accent" />
        <button type="submit" disabled={!t.trim()} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-white/30 disabled:opacity-40">Refine</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">{REFINE_CHIPS.map((c) => <button key={c} type="button" onClick={() => go(c)} className="btn rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 hover:border-white/30">{c}</button>)}</div>
    </form>
  );
}
