"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import type { DraftContext, DraftQuestion, PlanExpr, PlanStage, Workflow } from "@/lib/contracts";

import { conditionText } from "@/services/backend/src/engine/workflow-view";

export type DraftPhase = "idle" | "drafting" | "clarifying" | "done" | "error";
import type { DraftStep } from "@/lib/api/draft-progress";
const joinNames = (items: string[]) => new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
function draftOutline(w: Workflow) {
  const asset = (id: string | null) => w.assets.find(a => a.id === id)?.query ?? "";
  const leaves = new Set<string>();
  function describe(e: PlanExpr): string {
    if ("args" in e) return "(" + e.args.map(describe).join(e.op === "and" ? " AND " : " OR ") + ")";
    if ("arg" in e) return "NOT (" + describe(e.arg) + ")";
    leaves.add(JSON.stringify(e));
    const sigId = "ref" in e.left ? e.left.ref.split(".")[0] : undefined;
    const sig = w.signals.find(s => s.id === sigId);
    if (sig && "lit" in e.right && typeof e.right.lit === "number" && (sig.kind === "price_change" || sig.kind === "drawdown")) {
      const value = sig.kind === "drawdown" ? -e.right.lit : e.right.lit;
      if (sig.kind === "drawdown" && e.op === "gte" || sig.kind === "price_change" && (value < 0 ? e.op === "lte" : e.op === "gte"))
        return `${asset(sig.assetId)} ${value < 0 ? "−" : "+"}${Math.abs(value)}%`;
    }
    return conditionText(w, e);
  }
  const rules = [...new Set(w.stages.flatMap(s => s.when ? [describe(s.when)] : []))];
  const roots = w.stages.filter(s => !s.after.length);
  const downstream = w.stages.filter(s => s.after.length);
  const order = (s: PlanStage) => s.side[0].toUpperCase() + s.side.slice(1) + " " + asset(s.assetId) + (s.leverage > 1 ? " " + s.leverage + "×" : "");
  const first = roots.length && roots.every(s => s.side === "buy" && s.leverage === 1)
    ? "Buy " + joinNames(roots.map(s => asset(s.assetId))) : joinNames(roots.map(order));
  const common = roots.length > 0 && downstream.every(s => s.after.length === roots.length && roots.every(root => s.after.some(d => d.stageId === root.id && d.event === "filled")));
  const sequence = common ? [first, joinNames(downstream.map(order))].filter(Boolean).join(" → ")
    : w.stages.map(s => order(s) + (s.after.length ? " after " + s.after.map(d => (w.stages.find(a => a.id === d.stageId)?.sourceText ?? d.stageId) + " (" + d.event.replaceAll("_", " ") + ")").join(" and ") : "")).join(" · ");
  return { conditions: rules.join(" · "), sequence, count: leaves.size };
}
export type Clarification = { draft: DraftContext; questions: DraftQuestion[] };
export default function DraftProgress({ phase, steps, clarification, error, summary, persian, onContinue }: {
  phase: DraftPhase; steps: DraftStep[]; clarification: Clarification | null; error: string | null; summary: string;
  persian: boolean; onContinue: (answers: Record<string, string>) => void;
}) {
  const busy = phase === "drafting";
  const w = clarification?.draft.workflow, outline = w ? draftOutline(w) : null;
  const log = <ol className="q-draft-log" aria-label="Draft activity">{steps.map(s =>
    <li key={s.step} data-operation={s.step} data-state={s.done ? "done" : busy ? "working" : "stopped"}>
      {s.done ? <Check size={14} aria-hidden /> : busy ? <LoaderCircle size={14} className="q-draft-spin" aria-hidden /> : <span aria-hidden>·</span>}
      <span>{s.label}</span>
    </li>)}</ol>;
  return <section className="q-clarification-card mt-6" aria-labelledby="draft-progress-title">
    <header><h2 id="draft-progress-title">{busy && !w ? "Draft activity" : "Strategy draft"}</h2>
      <span role="status" className="q-draft-status" data-state={error ? "error" : w || busy ? "active" : "idle"}>
        {busy ? "Drafting" : w ? "Needs clarification" : error ? "Needs attention" : phase === "done" ? "Ready for review" : "Ready"}
      </span></header>
    {clarification && w && outline ? <>
      <dl className="q-draft-outline">{outline.conditions && <div><dt>{w.signals.every(s => s.kind === "price_change" || s.kind === "drawdown") ? "Price conditions" : "Conditions"}</dt><dd>{outline.conditions}</dd></div>}
        <div><dt>Order sequence</dt><dd>{outline.sequence}</dd></div></dl>
      <Questions key={`${clarification.draft.history.length}:${clarification.questions.map(q => q.id).join(",")}`} data={clarification} busy={busy} persian={persian} onContinue={onContinue} />
      <footer><span><Check size={13} aria-hidden />{outline.count} condition{outline.count === 1 ? "" : "s"} and {w.stages.length} order{w.stages.length === 1 ? "" : "s"} identified</span>
        <span className="q-draft-wait">{busy ? "Applying answers" : "Waiting for your answer"}</span></footer>
      {steps.length > 0 && <details className="q-draft-history"><summary>Draft activity</summary>{log}</details>}
    </> : steps.length ? log : <p className="q-draft-placeholder">{busy ? "Waiting for the compiler…" : phase === "done" ? summary : "Describe a trade to see its rules here."}</p>}
    {error && <p role="alert" className="border-t border-line px-5 py-4 text-[13px] leading-relaxed text-short sm:px-6">{error}</p>}
  </section>;
}

function Questions({ data, busy, persian: fa, onContinue }: { data: Clarification; busy: boolean; persian: boolean; onContinue: (v: Record<string, string>) => void }) {
  const [index, setIndex] = useState(0), [answers, setAnswers] = useState<Record<string, string>>({}), [invalid, setInvalid] = useState("");
  const focus = useRef<HTMLDivElement>(null), q = data.questions[index], value = answers[q.id] ?? "", last = index === data.questions.length - 1;
  const shell = useRef<HTMLDivElement>(null), content = useRef<HTMLFormElement>(null);
  const previousHeight = useRef(0), switching = useRef(false);
  const go = (target: number) => {
    if (busy || switching.current || target === index) return;
    switching.current = true;
    previousHeight.current = shell.current?.getBoundingClientRect().height ?? 0;
    setInvalid("");
    setIndex(target);
  };
  useLayoutEffect(() => {
    switching.current = false;
    const form = content.current, panel = shell.current, from = previousHeight.current;
    previousHeight.current = 0;
    const animations: Animation[] = [];
    if (from && form?.animate && panel && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animations.push(form.animate([{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" }));
      const to = form.getBoundingClientRect().height;
      if (Math.abs(from - to) > 1) animations.push(panel.animate([{ height: from + "px" }, { height: to + "px" }], { duration: 180, easing: "cubic-bezier(.22,.8,.3,1)" }));
    }
    const control = focus.current?.querySelector<HTMLElement>("input:checked") ?? focus.current?.querySelector<HTMLElement>("input, textarea");
    control?.focus({ preventScroll: true });
    return () => { animations.forEach((a) => a.cancel()); };
  }, [index]);
  const next = () => {
    const n = Number(value.trim().replace(/[۰-۹]/g, (x) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(x))).replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/[,٬]/g, "").replace(/٫/g, "."));
    if (!value.trim() || q.kind === "number" && (!Number.isFinite(n) || n <= 0 || n > (q.max ?? 1e12))) { setInvalid(fa ? "یک مقدار معتبر و بیشتر از صفر وارد کن." : "Enter a valid positive amount before continuing."); return; }
    setInvalid(""); if (last || q.id === "entry_group" || q.id === "move_reference") onContinue(answers); else go(index + 1);
  };
  return <div className="q-draft-questions" dir={fa ? "rtl" : "ltr"}>
    <div className="mb-4 flex items-center justify-between text-[12px] text-muted"><span>{fa ? "تکمیل جزئیات" : "Complete the details"}</span><span aria-live="polite" aria-atomic="true" className="font-mono tabular-nums">{index + 1} / {data.questions.length}</span></div>
    <div ref={shell} className="q-question-shell"><form ref={content} onSubmit={(e) => { e.preventDefault(); if (!busy && !switching.current) next(); }}>
      <label id="draft-question-label" htmlFor={`answer-${q.id}`} className="block text-[16px] font-medium leading-relaxed">{q.label}</label>
      <p id="draft-question-help" className="mt-2 text-[12.5px] leading-relaxed text-muted">{q.help}</p>
      <fieldset disabled={busy} className="mt-5" aria-labelledby="draft-question-label">
        <div ref={focus}>
          {q.kind === "choice" ? <div className="q-draft-choices">{q.options!.map((o) => <label key={o.value} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed transition-colors hover:border-accent/40 ${value === o.value ? "border-accent/60 bg-accent/[.04]" : "border-line-2"}`}><input type="radio" name={q.id} value={o.value} checked={value === o.value} onChange={() => { setAnswers({ ...answers, [q.id]: o.value }); setInvalid(""); }} className="mt-1 shrink-0 accent-accent" /><span>{o.label}{o.detail && <span className="block text-[12px] text-muted">{o.detail}</span>}</span></label>)}</div>
            : q.kind === "text" ? <textarea id={`answer-${q.id}`} aria-describedby="draft-question-help" rows={3} maxLength={1000} value={value} onChange={(e) => { setAnswers({ ...answers, [q.id]: e.target.value }); setInvalid(""); }} placeholder={fa ? "پاسخت را بنویس…" : "Your answer…"} className="q-control w-full resize-y leading-relaxed" />
            : <div className="relative"><input id={`answer-${q.id}`} aria-describedby="draft-question-help" aria-invalid={!!invalid} type="text" inputMode="decimal" autoComplete="off" value={value} maxLength={40} onChange={(e) => { setAnswers({ ...answers, [q.id]: e.target.value }); setInvalid(""); }} placeholder={fa ? "مقدار را وارد کن" : "Enter amount"} className="q-control w-full pe-24 font-mono text-[16px]" /><span className="pointer-events-none absolute end-3 top-3.5 text-[12px] text-muted">{q.unit}</span></div>}
        </div>
        {invalid && <p role="alert" className="mt-2 text-[12px] text-short">{invalid}</p>}
        <div className="mt-5 flex items-center justify-between gap-3">
          {index > 0 ? <button type="button" onClick={() => go(index - 1)} className="q-action"><ArrowLeft size={14} />{fa ? "قبلی" : "Back"}</button> : <span className="text-[12px] text-muted">{fa ? "قوانین قبلی حفظ می‌شوند" : "Your other rules are kept"}</span>}
          <button type="submit" className="q-action q-primary" disabled={busy || !value.trim()}>{busy ? <LoaderCircle size={14} className="q-draft-spin" /> : null}{busy ? (fa ? "در حال تکمیل…" : "Finishing…") : last ? (fa ? "تکمیل پیش‌نویس" : "Finish draft") : (fa ? "ادامه" : "Continue")}{!busy && <ArrowRight size={14} />}</button>
        </div>
      </fieldset>
    </form></div>
    {data.draft.history.length > 0 && <details className="mt-5 border-t border-line pt-3 text-[12px] text-muted"><summary className="py-1">{fa ? "پاسخ‌های قبلی" : "Previous answers"}</summary><dl className="mt-3 space-y-3">{data.draft.history.map((a, i) => <div key={i}><dt>{a.question}</dt><dd className="mt-1 text-ink-2">{a.answer}</dd></div>)}</dl></details>}
  </div>;
}
