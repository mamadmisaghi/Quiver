"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, LoaderCircle } from "lucide-react";
import type { DraftContext, DraftQuestion } from "@/lib/contracts";

export type DraftPhase = "idle" | "drafting" | "clarifying" | "done" | "error";
export type DraftStep = { step: string; label: string };
export type Clarification = { draft: DraftContext; questions: DraftQuestion[] };
export default function DraftProgress({ phase, steps, clarification, error, summary, persian, onContinue }: {
  phase: DraftPhase; steps: DraftStep[]; clarification: Clarification | null; error: string | null; summary: string;
  persian: boolean; onContinue: (answers: Record<string, string>) => void;
}) {
  const busy = phase === "drafting";
  const title = phase === "clarifying" ? "A few details to finish" : busy ? "Drafting your strategy" : phase === "done" ? "Your draft is ready" : phase === "error" ? "Let's try that again" : "Strategy draft";
  return <section className="mt-10 overflow-hidden rounded-[14px] border border-line bg-bg-2" aria-labelledby="draft-progress-title">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
      <h2 id="draft-progress-title" className="text-[15px] font-medium">{title}</h2>
      <span role="status" className="flex items-center gap-2 text-[12px] text-muted">{busy ? <><LoaderCircle size={14} className="q-draft-spin text-accent" />Working on your rules</> : phase === "clarifying" ? <><CircleHelp size={14} className="text-accent" />Waiting for your answer</> : phase === "done" ? summary : ""}</span>
    </div>
    <div className={`grid ${clarification ? "md:grid-cols-[minmax(220px,.8fr)_minmax(0,1.2fr)]" : ""}`}>
      <ol className={`grid content-start gap-4 p-5 sm:p-6 ${clarification ? "md:border-r md:border-line" : "sm:grid-cols-2"}`} aria-label="Draft progress">
        {(steps.length ? steps.slice(-6) : [{ step: "start", label: busy ? "Understanding your intent" : phase === "clarifying" ? "Your requested rules are kept" : phase === "done" ? "Saved draft loaded" : "Ready for your idea" }]).map((s, i, list) => {
          const active = busy && i === list.length - 1, done = phase === "done" || phase === "clarifying" || busy && !active;
          return <li key={`${s.step}-${i}`} className="flex min-w-0 items-start gap-3 text-[13px] leading-5">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>{active ? <LoaderCircle size={16} className="q-draft-spin text-accent" /> : done ? <span className="grid h-4 w-4 place-items-center rounded-full bg-accent text-bg"><Check size={11} strokeWidth={2.5} /></span> : <span className="h-3.5 w-3.5 rounded-full border border-line-2" />}</span>
            <span className={active ? "text-ink" : "text-ink-2"}>{s.label}</span>
          </li>;
        })}
      </ol>
      {clarification && <Questions key={`${clarification.draft.history.length}:${clarification.questions.map((q) => q.id).join(",")}`} data={clarification} busy={busy} persian={persian} onContinue={onContinue} />}
    </div>
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
    setInvalid(""); if (last) onContinue(answers); else go(index + 1);
  };
  return <div className="border-t border-line p-5 sm:p-6 md:border-t-0" dir={fa ? "rtl" : "ltr"}>
    <div className="mb-4 flex items-center justify-between text-[12px] text-muted"><span>{fa ? "تکمیل جزئیات" : "Complete the details"}</span><span aria-live="polite" aria-atomic="true" className="font-mono tabular-nums">{index + 1} / {data.questions.length}</span></div>
    <div ref={shell} className="q-question-shell"><form ref={content} onSubmit={(e) => { e.preventDefault(); if (!busy && !switching.current) next(); }}>
      <label id="draft-question-label" htmlFor={`answer-${q.id}`} className="block text-[16px] font-medium leading-relaxed">{q.label}</label>
      <p id="draft-question-help" className="mt-2 text-[12.5px] leading-relaxed text-muted">{q.help}</p>
      <fieldset disabled={busy} className="mt-5" aria-labelledby="draft-question-label">
        <div ref={focus}>
          {q.kind === "choice" ? <div className="space-y-2">{q.options!.map((o) => <label key={o.value} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed transition-colors hover:border-accent/40 ${value === o.value ? "border-accent/60 bg-accent/[.04]" : "border-line-2"}`}><input type="radio" name={q.id} value={o.value} checked={value === o.value} onChange={() => { setAnswers({ ...answers, [q.id]: o.value }); setInvalid(""); }} className="mt-1 shrink-0 accent-accent" /><span>{o.label}{o.detail && <span className="block text-[12px] text-muted">{o.detail}</span>}</span></label>)}</div>
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
