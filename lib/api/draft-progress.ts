export type DraftStep = { step: string; label: string; done: boolean };
export function updateDraftSteps(steps: DraftStep[], e: { step: string; operation?: string; label: string; status?: "working" | "done" }) {
  const key = e.operation ?? (e.step === "repairing" ? "reading" : e.step);
  const row = { step: key, label: e.label, done: e.status === "done" };
  return steps.some(s => s.step === key) ? steps.map(s => s.step === key ? row : s) : [...steps, row];
}
