import assert from "node:assert/strict";
import { updateDraftSteps, type DraftStep } from "../lib/api/draft-progress";
import { planCompile } from "../services/backend/src/compile/planner";
import { Registry, MOCK_INSTRUMENTS } from "../services/backend/src/venues/registry";
import { POST } from "../app/api/preview/compile/route";
import { CompileEvent, Risk, Strategy, type DraftContinuation, type Workflow } from "../lib/contracts";
import { previewRecord } from "../lib/preview/records";
import { activeSessionMs, checkpointPaperSession, createPaperSession, readPaperSession } from "../lib/paper/sessions";
import { observedNodes, quoteUpdates } from "../lib/paper/observations";
import { paperGraphPulses } from "../lib/paper/graph-events";
import { basketDraft, checkBoundClauses } from "../services/backend/src/compile/basket";
import { continueDraft, draftQuestions } from "../services/backend/src/compile/clarifications";
import { workflowView } from "../services/backend/src/engine/workflow-view";
import { createPaper, paperProblems, stepPaper, type PaperQuote, type PaperStepEvent } from "../services/backend/src/workflows/paper";

const thesis = "buy neet and troll and solana when price of neet dropps10% and troll drops 28% and solana rise 20% after that open btc long with 7x leverage and short XMR with 28x";
async function send(clarification?: DraftContinuation) {
  const response = await POST(new Request("https://quiver.example/api/preview/compile", { method: "POST", body: JSON.stringify({ thesis, clarification }) }));
  assert.equal(response.status, 200);
  return (await response.text()).trim().split("\n").map(line => CompileEvent.parse(JSON.parse(line)));
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("hyperliquid")) return Response.json({ universe: [{ name: "BTC", maxLeverage: 40 }, { name: "XMR", maxLeverage: 20 }] });
  if (String(url).includes("dexscreener")) return Response.json({ pairs: [] });
  throw Error("Unexpected remote request " + init?.method);
};
let finished: Workflow;
try {
  const first = (await send()).at(-1);
  assert(first?.type === "clarification");
  assert.deepEqual(first.draft.workflow.assets.map(x => x.query), ["NEET", "TROLL", "SOL", "BTC", "XMR"]);
  assert.deepEqual(first.draft.workflow.stages.map(s => s.leverage), [1, 1, 1, 7, 28]);
  assert.equal(first.questions[0].id, "entry_group");
  assert.equal(first.draft.workflow.stages.filter(s => s.amount.value === null).length, 5);
  const grouped = (await send({ ...first.draft, answers: { entry_group: "all" } })).at(-1);
  assert(grouped?.type === "clarification");
  assert.deepEqual(grouped.draft.workflow.stages.slice(0,3).map(s => s.when?.op), ["and", "and", "and"]);
  const independently = continueDraft({ ...first.draft, answers: { entry_group: "each" } }, thesis).draft.workflow;
  assert.deepEqual(independently.stages.slice(0,3).map(s => s.when?.op), ["lte","lte","gte"]);
  const reference = (await send({ ...grouped.draft, answers: { move_reference: "start" } })).at(-1);
  assert(reference?.type === "clarification");
  const amounts = Object.fromEntries(reference.questions.map(q => [q.id, "10"]));
  const events = await send({ ...reference.draft, answers: amounts });
  const result = events.at(-1);
  assert(result?.type === "result", JSON.stringify(result));
  assert.equal(result.usage.attempts,0);
  finished = result.strategy.workflow!;
  assert.deepEqual(finished.stages.slice(3).map(s => [s.side, s.after.map(d => d.stageId)]), [["long", ["buy_1","buy_2","buy_3"]], ["short", ["buy_1","buy_2","buy_3"]]]);
  assert(paperProblems(finished,true).some(x => x.includes("20×")));
  const completed = events.filter(x => x.type === "progress" && x.status === "done").map(e => e.type === "progress" && e.operation);
  assert.deepEqual(completed, ["interpret","markets","rules","risk"]);
  console.log("PASS exact request through HTTP, intact 3 conditions / 5 orders, grouping, all follow-ups, market limits and verified progress.");
} finally { globalThis.fetch = originalFetch; }

for (const variant of [
  "If ADA falls by 5%, FOO rises 12% and SOL drops 3%, buy FOO, ADA and SOL; then long ETH at 4x and short LTC at 12x",
  "Buy $33 of FOO and $22 of BAR when BAR falls 18% and FOO rises 6% together, then open a 2× BTC long with $4 margin",
  "Buy NEET, TR0LL and SOL when NEET dips 9%, TR0LL gains 2% and SOL falls 3% independently",
]) {
  const w=basketDraft(variant); assert(w,variant); assert(w.stages.every(s=>s.sourceText.length));
}
assert.equal(basketDraft(thesis + " only on Mondays"),null);
assert.equal(basketDraft(thesis.replace("and troll drops", "or troll drops")),null);
assert.equal(basketDraft(thesis.replace("buy neet and troll","buy $100 of neet and troll")),null);
assert.equal(basketDraft(thesis.replace("short XMR with 28x","short XMR with 28x for one day")),null);
assert.equal(basketDraft(thesis.replace("and troll drops 28%", "and unmatched drops 28%")),null);

const w = structuredClone(finished!);
w.budgetUsd = 5000;
// Deliberate market fixture for execution math. The previous test separately checked the real leverage gate.
for (const a of w.assets) {
  const venue = a.kind === "perp" ? "hyperliquid" : "solana", id = a.id + "_selected";
  a.resolution = { status:"matched", selectedId:id, checkedAt:"2026-01-01", message:"",candidates:[{id,name:a.query,symbol:a.query,venue,kind:a.kind!,source:venue === "solana"?"dexscreener":"hyperliquid",address:null,url:null,maxLeverage:a.kind === "perp"?40:1,endDate:null,outcome:null}] };
}
const at=1700000000000;
const quotes=(prices:number[], t:number):PaperQuote[] => prices.map((price,i)=>({assetId:w.assets[i].id,price,observedAt:t,source:"unit",synthetic:false}));
assert.deepEqual(checkBoundClauses(w,thesis),[]);
const swapped=structuredClone(w);
swapped.stages[3].leverage=28; swapped.stages[4].leverage=7;
assert.equal(checkBoundClauses(swapped,thesis).filter(msg=>msg.includes("leverage")).length,2);
for (const stage of swapped.stages.slice(0,3)) {
  if (stage.when && "args" in stage.when) { const drop=stage.when.args[0]; if ("right" in drop) drop.right={lit:28}; }
}
assert(checkBoundClauses(swapped,thesis).some(message=>message.includes("NEET")));
const firstState=stepPaper(w,createPaper(w,at),quotes([100,100,100,100,100],at),at);
const partialQuotes=quotes([90,72,119,100,100],at+20_000);
let trace:PaperStepEvent[]=[];
const partial=stepPaper(w,firstState,partialQuotes,at+20_000,Risk.parse({}),trace);
assert.equal(partial.events.length,0);
assert.deepEqual(partial.checks?.buy_1,{result:false,met:2,total:3,unknown:0});
assert(!paperGraphPulses(w,trace,partial.lastAt).some(p=>p.to.startsWith("wf_do_")));
const items=partialQuotes.map(q=>({assetId:q.assetId,quote:q,message:""})), updates=quoteUpdates(items,firstState,partial.lastAt);
assert.equal(Object.keys(updates).length,5);
assert.deepEqual(quoteUpdates(items,partial,partial.lastAt),{});
const nodes=observedNodes(workflowView(w).nodes,w,partial,items,updates,partial.lastAt);
assert.equal(nodes.find(n=>n.id==="wf_when_buy_1")?.value,"2/3 met");
assert(nodes.find(n=>n.id==="wf_sig_move_1")?.quoteFlashAt);
const stale=stepPaper(w,partial,[],at+160_001);
assert.equal(stale.checks?.buy_1.unknown,3);
assert.equal(stale.events.length,0);
assert.equal(observedNodes(workflowView(w).nodes,w,stale,items,{},stale.lastAt).find(n=>n.id==="wf_sig_move_1")?.value,"Stale quote");
trace=[];
const filled=stepPaper(w,partial,quotes([90,72,120,100,100],at+40_000),at+40_000,Risk.parse({}),trace);
assert.deepEqual(filled.events.map(e=>e.stageId),w.stages.map(s=>s.id));
assert.equal(paperGraphPulses(w,trace,filled.lastAt).filter(e=>e.to.startsWith("wf_do_")).length,5);
assert.equal(stepPaper(w,filled,quotes([90,72,120,100,100],at+60_000),at+60_000).events.length,5);
const earlier = stepPaper(w,partial,quotes([1,1,1,1,1],at),at+22_000);
assert.equal(earlier.quotes[w.assets[0].id].price,90);
const independentW=structuredClone(w);
for (const [i,s] of independentW.stages.slice(0,3).entries()) if (s.when && "args" in s.when) s.when=s.when.args[i];
const independent=stepPaper(independentW,stepPaper(independentW,createPaper(independentW,at),quotes([100,100,100,100,100],at),at),partialQuotes,at+20_000);
assert.deepEqual(independent.events.map(e=>e.stageId),["buy_1","buy_2"]);
const later=stepPaper(independentW,independent,quotes([110,90,120,100,100],at+40_000),at+40_000);
assert.deepEqual(later.events.map(e=>e.stageId),independentW.stages.map(s=>s.id));
const windowW=structuredClone(w);
windowW.signals.forEach(sig=>{sig.change={reference:"lookback",lookbackMinutes:1}});
const warm=stepPaper(windowW,createPaper(windowW,at),quotes([100,100,100,100,100],at),at);
assert.equal(warm.checks?.buy_1.unknown,3);
assert.equal(stepPaper(windowW,warm,quotes([90,72,120,100,100],at+60_000),at+60_000).events.length,5);
console.log("PASS both grouping modes, delayed dependencies, signed changes, stale/duplicate quotes, last-observation counts and no repeated fills.");

const map=new Map<string,string>();
const storage:Storage={get length(){return map.size},clear(){map.clear()},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v)},removeItem:k=>{map.delete(k)}};
const record=previewRecord(Strategy.parse({schemaVersion:1,name:"Basket",thesis,signals:[],triggers:[],actions:[],risk:{},workflow:w}),"stg_papertimer00001","usr_papertimer00001");
const oldNow=Date.now;
try {
  let now=at;Date.now=()=>now;
  const s=createPaperSession(record,storage);
  let row=checkpointPaperSession(s.id,firstState,"running",storage,true);
  now+=10_000;row=checkpointPaperSession(s.id,partial,"running",storage);
  assert.equal(row.activeMs,10_000);
  now+=1500;row=checkpointPaperSession(s.id,partial,"paused",storage);
  now+=120_000;assert.equal(activeSessionMs(row,now,false),11500);
  row=checkpointPaperSession(s.id,partial,"running",storage,true);now+=3000;
  assert.equal(activeSessionMs(row,now,true),14500);
  row=checkpointPaperSession(s.id,partial,"running",storage);now+=100_000;
  row=checkpointPaperSession(s.id,partial,"running",storage,true);assert.equal(row.activeMs,14500);
  now+=1000;row=checkpointPaperSession(s.id,partial,"paused",storage);
  assert.equal(readPaperSession(s.id,storage)?.activeMs,15500);
  const legacy={...row};delete legacy.activeMs;storage.setItem("quiver.paper-session.v1."+s.id,JSON.stringify(legacy));
  assert.equal(readPaperSession(s.id,storage)?.activeMs,undefined);
  row=checkpointPaperSession(s.id,partial,"running",storage,true);
  assert.equal(row.activeMs,0);
} finally {Date.now=oldNow;}
assert.equal(draftQuestions(w,thesis).length,0);
console.log("PASS active time across pause, resume, reload, an interrupted driver and pre-timer sessions.");


// A real audit retry in the planner has two provider passes but just one visible row per operation.
const phrase="Open a BTC long at 7x with $10 margin at market price";
const simple: Workflow={version:1,name:"BTC long",summary:phrase,budgetUsd:null,questions:[],assumptions:[],
  assets:[{id:"btc",query:"BTC",sourceText:"BTC",venue:"hyperliquid",kind:"perp",outcome:null}],
  signals:[],stages:[{...w.stages[3], id:"long",assetId:"btc",sourceText:phrase,conditionText:"At market",after:[]}]};
let audits=0, interpretations=0;
globalThis.fetch=async()=>Response.json({universe:[{name:"BTC",maxLeverage:40}]});
try {
  let rows:DraftStep[]=[];
  const frames=[];
  for await (const e of planCompile({thesis:phrase},{registry:new Registry(MOCK_INSTRUMENTS),stockTokensAllowed:true,retainWorkflow:true,
    openrouter:{apiKey:"test-placeholder",model:"unit",budget:{capUsd:1,spentToday:()=>0,add:()=>{}},call:async opts=>{
      const verify=opts.schema?.name==="IntentAudit";
      if (verify) audits++; else interpretations++;
      return {json:verify ? (audits===1?{faithful:false,issues:["Recheck the order sequence"],clarification:null}:{faithful:true,issues:[],clarification:null}):simple,
        inputTokens:1,outputTokens:1,costUsd:0};
    }}})) {
    frames.push(e);
    if (e.type==="progress") rows=updateDraftSteps(rows,e);
  }
  assert.equal(frames.at(-1)?.type,"result");assert.equal(audits,2);assert.equal(interpretations,2);
  assert(frames.some(e=>e.type==="progress" && e.label==="Rechecking the order sequence"));
  assert.deepEqual(rows.map(r=>r.step),["interpret","audit","markets","rules","risk"]);
  assert(rows.every(r=>r.done));
} finally {globalThis.fetch=originalFetch;}
console.log("PASS real planner repair and independent verification update existing progress rows.");
