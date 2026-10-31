import assert from "node:assert/strict";
import { POST } from "../app/api/preview/compile/route";
import { POST as backtest } from "../app/api/preview/backtest/route";
import { CompileEvent, BacktestRes } from "../lib/contracts";
import { previewDrafts, savePreviewDraft } from "../lib/api/preview-drafts";
import { proxyApi } from "../lib/api-proxy";
import { MARKETS } from "../lib/api/fixtures";
import { MOCK_INSTRUMENTS } from "../services/backend/src/venues/registry";

let checks = 0;
async function draft(thesis: string) {
  const response = await POST(new Request("https://quiver.example/api/preview/compile", { method: "POST", body: JSON.stringify({ thesis }) }));
  assert.equal(response.status, 200);
  const frames = (await response.text()).trim().split("\n").map((s) => CompileEvent.parse(JSON.parse(s)));
  const result = frames.find((x) => x.type === "result");
  return { frames, result };
}

const nvda = await draft("Buy $250 of NVDA if it drops below $120, stop loss 8%, take profit 15%");
assert(nvda.result); assert.equal(nvda.result.strategy.actions[0].size.value, "250");
assert(nvda.result.strategy.actions[0].instrument.startsWith("robinhood:"));
assert(JSON.stringify(nvda.result.strategy.triggers).includes("120"));
assert(nvda.frames.some((x) => x.type === "partial" && x.node.title.includes("NVDA"))); checks++;

const eth = await draft("Long $400 of ETH at 3x when RSI is below 30, stop loss 5%");
assert(eth.result); assert.equal(eth.result.strategy.actions[0].instrument, "hl:perp:ETH");
assert.equal(eth.result.strategy.actions[0].leverage, 3); assert.equal(eth.result.strategy.actions[0].size.value, "400");
assert.notDeepEqual(nvda.result.strategy, eth.result.strategy);
assert(!eth.frames.some((x) => x.type === "partial" && x.node.detail.includes("NVDA"))); checks++;

const scheduled = await draft("Buy $100 of BTC every Monday at 9am");
assert(scheduled.result?.strategy.signals.some((x) => x.kind === "timer")); checks++;
const unknown = await draft("Please trade a completely unknown unicorn asset");
assert(!unknown.result); assert(unknown.frames.some((x) => x.type === "error" && x.code === "unsupported_prompt")); checks++;

const invalid = await POST(new Request("https://quiver.example/api/preview/compile", { method: "POST", body: "{}" }));
assert.equal(invalid.status, 422); checks++;
const oversize = await POST(new Request("https://quiver.example/api/preview/compile", { method: "POST", body: "x".repeat(25_000) }));
assert.equal(oversize.status, 413); checks++;
const refine = await POST(new Request("https://quiver.example/api/preview/compile", { method: "POST", body: JSON.stringify({ thesis: "change stop loss", baseStrategy: eth.result.strategy, instruction: "stop loss 2%" }) }));
assert.equal(refine.status, 200); assert((await refine.text()).includes("ai_required")); checks++;

const memory = new Map<string, string>();
Object.assign(globalThis, { window: {}, localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v) } });
const saved = savePreviewDraft(eth.result.strategy);
assert.equal(previewDrafts()[0].id, saved.id);
assert.equal(previewDrafts()[0].strategy.actions[0].instrument, "hl:perp:ETH");
assert(previewDrafts()[0].nodes.some((x) => x.detail.includes("ETH")));
assert(!previewDrafts()[0].nodes.some((x) => x.detail.includes("NVDA"))); checks++;
const test = async (strategy: unknown, more = {}) => backtest(new Request("https://quiver.example/api/preview/backtest", { method: "POST", body: JSON.stringify({ strategy, from: "2026-10-01T00:00:00Z", to: "2026-10-28T00:00:00Z", resolution: "1h", startingEquityUsd: "10000", ...more }) }));
const btc = (await draft("Long $400 of BTC if price is above $1, stop loss 5%")).result!.strategy;
const active = await test(btc); assert.equal(active.status, 200);
const activeResult = BacktestRes.parse(await active.json()); assert(activeResult.result!.trades > 0);
assert(activeResult.dataCoverage.every((c) => c.synthetic)); checks++;
const never = structuredClone(btc); never.triggers[0].when = { op: "gt", left: { ref: `${btc.signals[0].id}.value` }, right: { lit: 1e12 } };
const idle = BacktestRes.parse(await (await test(never)).json()); assert.equal(idle.result!.trades, 0);
assert.notEqual(activeResult.result!.endingEquityUsd, idle.result!.endingEquityUsd); checks++;
const altered = structuredClone(btc); altered.actions[0].size.value = "100";
const smaller = BacktestRes.parse(await (await test(altered)).json()); assert.notEqual(smaller.result!.fills[0].qty, activeResult.result!.fills[0].qty); checks++;
assert.equal((await test(btc, { resolution: "1m" })).status, 422); checks++;
assert.equal((await test(btc, { to: "2099-01-01T00:00:00Z" })).status, 422); checks++;
assert.equal((await backtest(new Request("https://quiver.example/api/preview/backtest", { method: "POST", body: "x".repeat(33_000) }))).status, 413); checks++;
for (const market of MARKETS) assert.equal(MOCK_INSTRUMENTS.find((m) => m.id === market.id)?.symbol, market.symbol); checks++;
let captured: { url?: string; headers?: Headers } = {};
const upstream = (async (url, init) => { captured = { url: String(url), headers: new Headers(init?.headers) }; return new Response("event: status\ndata: {}\n\n", { headers: { "content-type": "text/event-stream", "set-cookie": "quiver_rt=next; Path=/v1/auth; Secure; HttpOnly; SameSite=Strict" } }); }) as typeof fetch;
const proxied = await proxyApi(new Request("https://quiver.example/v1/auth/refresh", { method: "POST", headers: { origin: "https://quiver.example", cookie: "unrelated=private; quiver_rt=session", "x-forwarded-for": "pretend-ip" } }), ["auth", "refresh"], "https://quiver-api.example/v1", upstream);
assert.equal(captured.url, "https://quiver-api.example/v1/auth/refresh"); assert.equal(captured.headers?.get("cookie"), "quiver_rt=session");
assert.equal(captured.headers?.get("x-forwarded-for"), null); assert(proxied.headers.get("set-cookie")?.startsWith("quiver_rt=")); checks++;
assert.equal((await proxyApi(new Request("https://quiver.example/v1/auth/refresh", { method: "POST", headers: { origin: "https://other.example" } }), ["auth", "refresh"], "https://api.example/v1", upstream)).status, 403); checks++;
assert.equal((await proxyApi(new Request("https://quiver.example/v1/ops/shutdown"), ["ops", "shutdown"], "https://api.example/v1", upstream)).status, 404); checks++;
assert.equal((await proxyApi(new Request("https://quiver.example/v1/status"), ["..", "status"], "https://api.example/v1", upstream)).status, 400); checks++;
assert.equal((await proxyApi(new Request("https://quiver.example/v1/status"), ["status"], undefined, upstream)).status, 503); checks++;
const streamResult = await proxyApi(new Request("https://quiver.example/v1/runs/run_test/events/stream?ticket=example"), ["runs", "run_test", "events", "stream"], "https://api.example/v1", upstream);
assert.equal(await streamResult.text(), "event: status\ndata: {}\n\n"); checks++;
console.log(`PASS: ${checks} preview integration checks (compiler, saved drafts, rule simulation, registry parity, Render bridge and cookie isolation).`);
