import { DraftContinuation, type DraftContext, type DraftQuestion } from "../../contracts/src/clarification";
import type { PlanExpr, Workflow } from "../../contracts/src/workflow";

export const isPersian = (text: string) => /[\u0600-\u06ff]/.test(text);
export function draftQuestions(w: Workflow, text: string): DraftQuestion[] {
  const fa = isPersian(text), q: DraftQuestion[] = [];
  const name = (id: string) => (w.assets.find((a) => a.id === id)?.query ?? id).slice(0, 80);
  if (w.entryGrouping) {
    const count = w.entryGrouping.length === 3 ? "three" : String(w.entryGrouping.length);
    q.push({ id: "entry_group", kind: "choice", label: fa ? "خریدها چه زمانی انجام شوند؟" : `When should the ${count} buys trigger?`,
      help: fa ? "شرط‌های قیمت هر دارایی را حفظ می‌کنیم." : "The percentage move for each market stays the same.",
      options: [{ value: "all", label: fa ? "با برقرارشدن همهٔ شرط‌ها با هم" : `All ${count} conditions together` },
        { value: "each", label: fa ? "هر دارایی به‌صورت مستقل" : "Each asset independently" }] });
  }
  const changes = w.signals.filter(s => s.kind === "price_change");
  if (changes.some(s => !s.change || s.change.reference === "needs_choice"))
    q.push({ id: "move_reference", kind: "choice", label: fa ? "این تغییرات درصدی را از کدام قیمت بسنجیم؟" : "Which prices should these percentage moves be measured from?",
      help: fa ? "این انتخاب برای درصدهایی است که هنوز مرجع ندارند." : "This applies to the price moves that still need a reference.",
      options: [{ value: "start", label: fa ? "اولین قیمت معتبر سشن" : "First observed price in the session" },
        { value: "lookback", label: fa ? "قیمت در بازه‌ای مشخص در گذشته" : "Prices a fixed time ago" }] });
  if (changes.some(s => s.change?.reference === "lookback" && !s.change.lookbackMinutes))
    q.push({ id: "move_lookback", kind: "number", label: fa ? "قیمت چند دقیقه قبل مبنا باشد؟" : "How many minutes back should the price comparison start?",
      help: fa ? "تا ثبت تاریخچهٔ کافی، این شرط منتظر می‌ماند." : "The condition waits until the session has observations for that time window.", unit: "minutes", max: 525600 });
  for (const s of w.stages) if (s.amount.value === null) {
    const margin = s.leverage > 1 && s.amount.unit === "usd";
    q.push({ id: `amount.${s.id}`, kind: "number",
      label: fa ? `برای ${name(s.assetId)} ${margin ? "چند دلار سرمایهٔ اولیه اختصاص بدهیم؟" : "چه مقداری معامله کنیم؟"}` : margin ? `How much margin for the ${name(s.assetId)} ${s.side}?` : `How much should this step ${s.side} in ${name(s.assetId)}?`,
      help: margin ? (fa ? `اهرم ${s.leverage}× مشخص است. مبلغ واردشده سرمایهٔ اولیه است؛ ارزش پوزیشن ${s.leverage} برابر آن می‌شود.` : `${s.leverage}× leverage is set. Enter your margin; position value will be ${s.leverage} times that amount.`) : (fa ? "فقط مبلغ این مرحله تکمیل می‌شود؛ بقیهٔ قوانین حفظ می‌شوند." : "Only this step's amount will change. Your other rules are kept."),
      unit: s.amount.unit === "usd" ? "USD" : s.amount.unit === "native" ? name(s.assetId).slice(0, 40) : s.amount.unit.replace("pct_", "% "), max: s.amount.unit.startsWith("pct_") ? 100 : 1e12 });
  }
  const drops = w.signals.filter((s) => s.kind === "drawdown" && (!s.drawdown || s.drawdown.reference === "needs_choice"));
  const dropNames = drops.slice(0, 3).map((s) => name(s.assetId!)).join(fa ? " و " : " & ") + (drops.length > 3 ? (fa ? " و بقیه" : " and others") : "");
  if (drops.length) q.push({ id: "reference", kind: "choice", label: fa ? `افت ${dropNames} را از چه قیمتی بسنجیم؟` : `Measure the ${dropNames} drop from which price?`,
    help: fa ? "این انتخاب فقط روی افت‌هایی اعمال می‌شود که مرجعشان مشخص نشده است." : "This applies only to the drops whose reference is still unspecified.", options: [
      { value: "peak", label: fa ? "بالاترین قیمت از شروع یا خرید قبلی" : "Peak since start / last purchase" },
      { value: "last_fill", label: fa ? "قیمت شروع یا آخرین خرید" : "Price at start / last purchase" },
      { value: "lookback", label: fa ? "قیمت در یک بازهٔ زمانی قبل" : "Price a fixed time ago" },
    ] });
  const lookbacks = w.signals.filter((s) => s.drawdown?.reference === "lookback" && !s.drawdown.lookbackMinutes);
  if (lookbacks.length) q.push({ id: "lookback", kind: "number", label: fa ? "قیمت چند دقیقهٔ قبل را مقایسه کنیم؟" : "How many minutes back should we compare?", help: fa ? "برای مثال ۶۰ دقیقه یعنی مقایسه با یک ساعت قبل." : "For example, 60 minutes compares against one hour ago.", unit: fa ? "دقیقه" : "minutes", max: 525600 });
  for (const s of w.stages) if (s.repeat?.conditionMode === "needs_choice") q.push({ id: `repeat.${s.id}`, kind: "choice", label: fa ? `شرط ${name(s.assetId)} را در هر تکرار بررسی کنیم؟` : `When should we check the ${name(s.assetId)} condition?`, help: fa ? "تعداد و فاصلهٔ تکرارهایی که گفتی حفظ می‌شوند." : "The requested repeat interval and count stay the same.", options: [
    { value: "each_time", label: fa ? "قبل از هر سفارش" : "Before every order" },
    ...(s.repeat.intervalMinutes ? [{ value: "once_then_repeat", label: fa ? "فقط برای شروع تکرارها" : "Once, to start repeating" }] : []),
  ] });
  if (!w.budgetUsd && w.stages.some((s) => s.funding.kind === "budget" && s.repeat)) q.push({ id: "budget", kind: "number", label: fa ? "بودجهٔ کل این استراتژی چقدر باشد؟" : "What is this strategy's total budget?", help: fa ? "این مبلغ بین سفارش‌ها و هزینه‌ها تقسیم می‌شود. خرید بعدی اگر در بودجه نگنجد انجام نمی‌شود." : "Orders and modeled fees share this allocation. Purchases stop when the next full order no longer fits.", unit: "USD", max: 1e12 });
  w.questions.forEach((label, i) => q.push({ id: `question.${i}`, kind: "text", label, help: fa ? "یک پاسخ کوتاه کافی است؛ آن را به همین پیش‌نویس اضافه می‌کنیم." : "A short answer is enough. We'll apply it to this draft." }));
  return q;
}

const number = (v: string) => Number(v.trim().replace(/[۰-۹]/g, (n) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(n))).replace(/[٠-٩]/g, (n) => String("٠١٢٣٤٥٦٧٨٩".indexOf(n))).replace(/[,٬]/g, "").replace(/٫/g, "."));
export function continueDraft(raw: DraftContinuation, thesis: string): { draft: DraftContext; replan: boolean } {
  const input = DraftContinuation.parse(raw), w = structuredClone(input.workflow), questions = draftQuestions(w, thesis);
  const history = [...input.history], answeredText = new Set<number>(); let replan = history.some((a) => a.id.startsWith("question."));
  for (const [id, answer] of Object.entries(input.answers)) {
    const q = questions.find((x) => x.id === id); if (!q) throw new Error("This question changed. Draft again to review the latest details.");
    const value = answer.trim(); if (!value) throw new Error("Please answer the highlighted question.");
    if (q.kind === "number") {
      const n = number(value); if (!Number.isFinite(n) || n <= 0 || n > (q.max ?? 1e12)) throw new Error(`Enter a positive amount up to ${q.max ?? 1e12}.`);
      if (id === "budget") w.budgetUsd = n;
      else if (id === "move_lookback") w.signals.forEach(s => { if (s.change?.reference === "lookback" && !s.change.lookbackMinutes) s.change.lookbackMinutes = n; });
      else if (id === "lookback") w.signals.forEach((s) => { if (s.drawdown?.reference === "lookback" && !s.drawdown.lookbackMinutes) s.drawdown.lookbackMinutes = n; });
      else w.stages.find((s) => `amount.${s.id}` === id)!.amount.value = n;
    } else if (q.kind === "choice") {
      if (!q.options?.some((o) => o.value === value)) throw new Error("Choose one of the available options.");
      if (id === "entry_group" && w.entryGrouping) {
        const stages = w.entryGrouping.map(key => w.stages.find(stage => stage.id === key));
        if (!stages.every(stage => stage?.when)) throw new Error("The entry conditions changed. Open the draft again.");
        if (value === "all") {
          const joint: PlanExpr = { op: "and", args: stages.map(stage => stage!.when!) };
          const label = stages.map(stage => stage!.conditionText).join(" AND ");
          for (const stage of stages) { stage!.when = structuredClone(joint); stage!.conditionText = label; }
        }
        delete w.entryGrouping;
      } else if (id === "move_reference") {
        for (const sig of w.signals) if (sig.kind === "price_change" && (!sig.change || sig.change.reference === "needs_choice"))
          sig.change = { reference: value as "start" | "lookback", lookbackMinutes: null };
      } else if (id === "reference") w.signals.forEach((s) => { if (s.kind === "drawdown" && (!s.drawdown || s.drawdown.reference === "needs_choice")) s.drawdown = { reference: value as "peak" | "last_fill" | "lookback", lookbackMinutes: null }; });
      else w.stages.find((s) => `repeat.${s.id}` === id)!.repeat!.conditionMode = value as "each_time" | "once_then_repeat";
    } else { replan = true; answeredText.add(Number(id.split(".")[1])); }
    history.push({ id, question: q.label, answer: q.kind === "choice" ? `${value}: ${q.options!.find((o) => o.value === value)!.label}` : value });
  }
  w.questions = w.questions.filter((_, i) => !answeredText.has(i));
  if (history.length > 80) throw new Error("Too many clarifications. Start a fresh draft with your completed description.");
  return { draft: { workflow: w, history }, replan };
}
export const clarifiedRequest = (thesis: string, history: DraftContext["history"]) => history.length ? `${thesis}\n\nUser's answers to missing details:\n${history.map((a) => `${a.question}\nAnswer: ${a.answer}`).join("\n")}` : thesis;
