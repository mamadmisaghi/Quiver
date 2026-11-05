import assert from "node:assert/strict";
import { Workflow, workflowProblems } from "../services/backend/contracts/src/workflow";
import { CompileEvent } from "../lib/contracts";
import { recurringDraft } from "../services/backend/src/compile/recurring";
import { continueDraft, draftQuestions } from "../services/backend/src/compile/clarifications";
import { planCompile, lowerWorkflow } from "../services/backend/src/compile/planner";
import { MOCK_INSTRUMENTS, Registry } from "../services/backend/src/venues/registry";
import type { CompileDeps } from "../services/backend/src/compile";
import { callOpenRouter } from "../services/backend/src/compile/openrouter";

const thesis = "everime the price of neet and troll drops 10% together buy 100$ of each coins and then long Btc at the current price with 5x leverage";
const fixture = () => {
  const w = Workflow.parse(recurringDraft("if neet price fall below 0.003 buy 100$ of neet every 1 minutes until you out of budget"));
  const stage = w.stages[0];
  w.name = "NEET + TROLL dip, then BTC"; w.summary = thesis;
  w.assets = [
    { id: "neet", query: "NEET", sourceText: "neet", venue: "solana", kind: "token", outcome: null },
    { id: "troll", query: "TROLL", sourceText: "troll", venue: "solana", kind: "token", outcome: null },
    { id: "btc", query: "BTC", sourceText: "Btc", venue: "hyperliquid", kind: "perp", outcome: null },
  ];
  w.signals = ["neet", "troll"].map((id) => ({ id: `${id}_drop`, assetId: id, kind: "drawdown", drawdown: { reference: "needs_choice", lookbackMinutes: null }, indicator: null, schedule: null, description: `${id} price drop` }));
  const when = { op: "and" as const, args: ["neet", "troll"].map((id) => ({ op: "gte" as const, left: { ref: `${id}_drop.value` }, right: { lit: 10 } })) };
  w.stages = ["neet", "troll"].map((id) => ({ ...structuredClone(stage), id: `buy_${id}`, assetId: id, sourceText: "buy 100$ of each coins", when, conditionText: "Both tokens down 10% together", repeat: { intervalMinutes: null, maxTimes: null, conditionMode: "each_time" } }));
  w.stages.push({ ...structuredClone(stage), id: "long_btc", assetId: "btc", side: "long", sourceText: "long Btc at the current price with 5x leverage", when: null, conditionText: "After both purchases fill", after: [{ stageId: "buy_neet", event: "filled" }, { stageId: "buy_troll", event: "filled" }], amount: { unit: "usd", value: null }, leverage: 5, repeat: { intervalMinutes: null, maxTimes: null, conditionMode: "each_time" } });
  w.questions = []; w.assumptions = []; return Workflow.parse(w);
};
const collect = async (req: Parameters<typeof planCompile>[0], deps: CompileDeps) => { const frames = []; for await (const frame of planCompile(req, deps)) frames.push(CompileEvent.parse(frame)); return frames; };
let checks = 0;
const q = draftQuestions(fixture(), thesis);
assert.deepEqual(q.map((v) => v.id), ["amount.long_btc", "reference", "budget"]); assert(q[0].label.includes("margin")); checks++;
const answers = { "amount.long_btc": "۲۰۰", reference: "peak", budget: "۱٬۰۰۰" };
const input = { workflow: fixture(), history: [], answers };
const patched = continueDraft(input, thesis);
assert.equal(patched.draft.workflow.stages[2].amount.value, 200); assert.equal(patched.draft.workflow.budgetUsd, 1000);
assert.deepEqual(patched.draft.workflow.stages.slice(0, 2), input.workflow.stages.slice(0, 2)); assert.equal(input.workflow.stages[2].amount.value, null); checks++;
assert.equal(patched.draft.workflow.stages[2].leverage, 5); assert.deepEqual(patched.draft.workflow.stages[2].after, input.workflow.stages[2].after); assert.equal(patched.draft.workflow.stages[0].when?.op, "and"); checks++;
assert.deepEqual(draftQuestions(patched.draft.workflow, thesis), []); assert.deepEqual(workflowProblems(patched.draft.workflow), []); checks++;
for (const value of ["0", "-5", "NaN", "1e99"]) assert.throws(() => continueDraft({ ...input, answers: { "amount.long_btc": value } }, thesis));
assert.throws(() => continueDraft({ ...input, answers: { unknown: "100" } }, thesis)); assert.throws(() => continueDraft({ ...input, answers: { reference: "invented" } }, thesis)); checks++;
const lookback = continueDraft({ ...input, answers: { ...answers, reference: "lookback" } }, thesis);
assert.deepEqual(draftQuestions(lookback.draft.workflow, thesis).map((v) => v.id), ["lookback"]);
const completed = continueDraft({ ...lookback.draft, answers: { lookback: "۶۰" } }, thesis);
assert.equal(completed.draft.workflow.signals[1].drawdown?.lookbackMinutes, 60); assert.equal(completed.draft.history.length, 4); checks++;
assert(draftQuestions(fixture(), "هر بار نیت و ترول ۱۰ درصد افت کردند").every((v) => /[\u0600-\u06ff]/.test(v.label))); checks++;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => Response.json({ pairs: [], universe: [] })) as typeof fetch;
try {
  const calls: string[] = [];
  const deps: CompileDeps = { registry: new Registry(MOCK_INSTRUMENTS), stockTokensAllowed: true, retainWorkflow: true,
    openrouter: { apiKey: "test-placeholder", model: "openai/gpt-5.6-sol", budget: { capUsd: 5, spentToday: () => 0, add: () => {} },
      call: async (opts) => { calls.push(opts.schema!.name); if (opts.schema!.name === "IntentAudit") assert(opts.user.includes("۲۰۰")); return { json: opts.schema!.name === "IntentAudit" ? { faithful: true, issues: [] } : fixture(), inputTokens: 1, outputTokens: 1, costUsd: .001 }; } } };
  const first = await collect({ thesis }, deps), waiting = first.at(-1);
  assert.equal(waiting?.type, "clarification"); assert.deepEqual(calls, ["QuiverWorkflow"]); assert(!first.some((v) => v.type === "error" || v.type === "result")); checks++;
  if (waiting?.type !== "clarification") throw new Error("Expected questions");
  const baseStrategy = lowerWorkflow(fixture(), thesis, deps); baseStrategy.risk.maxPositionPct = 88;
  const next = await collect({ thesis, baseStrategy, clarification: { ...waiting.draft, answers } }, deps), result = next.at(-1);
  assert.equal(result?.type, "result"); assert.deepEqual(calls, ["QuiverWorkflow", "IntentAudit"]);
  if (result?.type !== "result") throw new Error(JSON.stringify(result));
  assert.equal(result.strategy.risk.maxPositionPct, 88); assert.deepEqual(result.strategy.workflow?.stages.map((s) => s.amount.value), [100, 100, 200]); checks++;
  const waitingAgain = await collect({ thesis, clarification: { ...waiting.draft, answers: { ...answers, reference: "lookback" } } }, deps);
  assert.equal(waitingAgain.at(-1)?.type, "clarification"); assert.equal(calls.length, 2); checks++;
  const offline = await collect({ thesis, clarification: { ...waiting.draft, answers } }, { ...deps, openrouter: undefined });
  assert.equal(offline.at(-1)?.type, "error"); assert(!offline.some((v) => v.type === "result")); checks++;
  const words = fixture(); words.questions = ["Should both conditions hold in the same observation?"];
  const withWords = continueDraft({ workflow: words, history: [], answers: { ...answers, reference: "lookback", "question.0": "Both must be true on the same observation" } }, thesis);
  assert(withWords.replan); const finalWords = continueDraft({ ...withWords.draft, answers: { lookback: "60" } }, thesis); assert(finalWords.replan); assert(finalWords.draft.history.some((a) => a.answer.includes("same observation"))); checks++;
  const semanticDeps = { ...deps, openrouter: { ...deps.openrouter!, call: async (opts: Parameters<typeof callOpenRouter>[0]) => {
    assert(opts.user.includes("Both must be true on the same observation"));
    return { json: opts.schema!.name === "IntentAudit" ? { faithful: true, issues: [] } : finalWords.draft.workflow, inputTokens: 1, outputTokens: 1, costUsd: .001 };
  } } };
  const semanticResult = await collect({ thesis, clarification: { ...withWords.draft, answers: { lookback: "60" } } }, semanticDeps);
  assert.equal(semanticResult.at(-1)?.type, "result"); checks++;
  let wire: any;
  globalThis.fetch = (async (_url, init) => { wire = JSON.parse(String(init?.body)); return Response.json({ choices: [{ message: { content: '{"faithful":true,"issues":[]}' } }], usage: { cost: .004 } }); }) as typeof fetch;
  await callOpenRouter({ apiKey: "test-placeholder", model: "openai/gpt-5.6-sol", maxTokens: 6000, system: "rules", user: thesis });
  assert.equal(wire.model, "openai/gpt-5.6-sol"); assert.equal(wire.temperature, undefined); assert.equal(wire.max_tokens, 6000); assert.equal(wire.reasoning.effort, "low"); assert(wire.provider.require_parameters); checks++;
} finally { globalThis.fetch = originalFetch; }
console.log(`PASS: ${checks} clarification checks (missing margin, exact amounts, AND, dependencies, Persian, validation, conditional questions, preserved risk, semantic answers and GPT-5.6 Sol request).`);
