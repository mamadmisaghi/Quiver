import { previewCompile, previewCompileImage } from "./preview-compile";
import { previewBacktest } from "./preview-backtest";
import { listPreviewDrafts, persistPreviewDraft } from "./preview-workspace";
import { mockDetail, mockHistory } from "./market-mock";
// MOCK adapter: implements QuiverApi from contract fixtures. Swap for live.ts via NEXT_PUBLIC_API_MODE=live.
import * as C from "@/lib/contracts";
import skDefaultsJson from "./fixtures/session-key.defaults.json";
import * as F from "./fixtures";
import { mockExt } from "./ext-mock";
import { mockSocial } from "./social-mock";
import { mockShare } from "./share-mock";
import { mockChannels } from "./channel-mock";
import { mockSecrets } from "./secrets-mock";
import { mockTestnet } from "./testnet-mock";
import alertSettings from "./fixtures/m4/alerts.settings.json"; // MOCK fixtures (M4)
import alertRule from "./fixtures/m4/alerts.rule.json";
import alertDeliveries from "./fixtures/m4/alerts.deliveries.json";
import positionClose from "./fixtures/m4/runs.position-close.json";
import approvalsPending from "./fixtures/m4/approvals.pending.json";
import portfolioRuns from "./fixtures/m4/portfolio.runs.json";
import portfolioAllocation from "./fixtures/m4/portfolio.allocation.json";
import portfolioHistory from "./fixtures/m4/portfolio.history.json";
import runReplay from "./fixtures/m4/runs.replay.json";
import positionsPaper from "./fixtures/m4/positions.paper.json";
import pubLeaderboard from "./fixtures/m4/public.leaderboard.json";
import pubCard from "./fixtures/m4/public.card.json";
import cardShare from "./fixtures/m4/runs.card-share.json";
import instructProp from "./fixtures/m4/runs.instruct.json";
import instructApply from "./fixtures/m4/runs.instruct-apply.json";
import autopilotState from "./fixtures/m4/autopilot.state.json";
import autopilotLog from "./fixtures/m4/autopilot.log.json";
const M4 = { alertSettings, alertRule, alertDeliveries, positionClose, approvalsPending, portfolioRuns, portfolioAllocation, portfolioHistory, runReplay, autopilotState, autopilotLog, positionsPaper };
let mockAp: unknown = null; // MOCK autopilot state (in-memory)
let mockKillTried = false; // MOCK
import { ApiErr, type QuiverApi, type RunEvent, type Run, type StrategyRecord } from "./types";
// Strict fixture checks that used to live in demo.ts (demo graph stays zod-free for first paint).
F.PARTIAL_NODES.forEach((node) => C.CompileEvent.parse({ type: "partial", node }));
C.Humanized.parse(F.HUMANIZED);

const parse = <T>(schema: { parse: (x: unknown) => T }, x: unknown): T => schema.parse(x); // drift fails loudly
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("aborted", "AbortError")); });
});
const strategy = parse(C.Strategy, F.STRATEGY_RAW);
const runs = F.RUNS.map((r) => parse(C.Run, r));
const runState = new Map<string, Run>(runs.map((r) => [r.id, r]));

function record(id: string): StrategyRecord {
  const s = F.STRATEGIES.find((x) => x.id === id) ?? F.STRATEGIES[0];
  return parse(C.StrategyRecord, {
    id: s.id, ownerId: F.USER_ID, name: s.name, version: s.version, status: s.status,
    strategy: { ...strategy, name: s.name }, humanized: F.HUMANIZED, issues: [], venues: s.venues,
    createdAt: "2026-10-27T09:00:00Z", updatedAt: s.updatedAt, activeRunId: s.activeRunId, nodes: F.PARTIAL_NODES,
  });
}

// QA P1: only "demo" maps to the demo run; any other unknown id is not_found (same as live).
const runOf = async (id: string) => { const r = id === "demo" ? runState.get(F.RUN_ID) : runState.get(id); if (!r) throw new ApiErr("not_found", "Run not found.", 404); return r; };
const mockLink: { pending: { nonce: string; address: string } | null; items: { address: string; linkedAt: string; primary: boolean }[] } = { pending: null, items: [] }; // MOCK
// MOCK M5.4: deterministic plan over the user's mock strategies.
async function mockPlan(req: import("./types").AutopilotPlanReq, on?: (f: import("./types").PlanFrame) => void, signal?: AbortSignal) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const goal = req.goal ?? "balanced", lookbackDays = req.lookbackDays ?? 7;
  const list = (await mockApi.strategies()).items.slice(0, 10);
  on?.({ event: "status", data: { stage: "loading", message: `Loading ${list.length} strategies` } }); await wait(250);
  on?.({ event: "status", data: { stage: "scoring", message: `Backtesting the last ${lookbackDays} days on 1h bars` } });
  const cands = [] as import("./types").AutopilotPlanCandidate[];
  for (const [i, st] of list.entries()) {
    if (signal?.aborted) return null;
    const h = [...st.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const ret = ((h % 1800) / 100 - 4).toFixed(2), dd = ((h >> 5) % 2200 / 100 + 2).toFixed(2), trades = (h >> 9) % 14;
    const ok = trades > 0 && Number(dd) <= 25;
    const c = { strategyId: st.id, name: st.name, index: i, total: list.length, ok, error: null, metrics: { returnPct: ret, maxDrawdownPct: dd, sharpe: (Number(ret) / Math.max(1, Number(dd))).toFixed(2), trades }, score: ok ? Math.round((Number(ret) - Number(dd) / 2) * 100) / 100 : null };
    cands.push(c); on?.({ event: "candidate", data: c }); await wait(300);
  }
  on?.({ event: "status", data: { stage: "ranking", message: "Ranking" } }); await wait(200);
  const ranked = cands.filter((c) => c.ok).sort((a, b) => (b.score! - a.score!) || a.strategyId.localeCompare(b.strategyId)).slice(0, 5);
  const worst = Math.max(0, ...ranked.map((c) => Number(c.metrics!.maxDrawdownPct)));
  const plan = parse(C.AutopilotPlan, { goal, lookbackDays, ranked, excluded: cands.filter((c) => !ranked.includes(c)), source: "deterministic", synthetic: true, notice: "Example data — backtests run on synthetic bars.",
    rationale: ranked.length ? [`Kept ${ranked.length} of ${cands.length} that traded and stayed under 25% drawdown.`, `Rotate every ${{ balanced: 120, return: 60, low_risk: 240 }[goal]} minutes.`] : ["None of your strategies qualified."],
    proposal: ranked.length ? { enabled: false, mode: "paper", strategyIds: ranked.map((c) => c.strategyId), rotateEveryMin: { balanced: 120, return: 60, low_risk: 240 }[goal], startingEquityUsd: req.startingEquityUsd ?? "10000", approvalMode: "auto", acknowledgeKill: false,
      guardrails: { maxDrawdownPct: Math.min(50, Math.max(5, Math.round(worst * 1.5))), maxDailyLossUsd: Number(req.startingEquityUsd ?? 10000) * (goal === "low_risk" ? 0.02 : 0.05), maxRotationsPerDay: 12 } } : null });
  on?.({ event: "plan", data: plan }); return plan;
}

export const mockApi: QuiverApi = {
  async autopilotPlanStream(req, onFrame, signal) { await mockPlan(req, onFrame, signal); },
  async autopilotPlan(req) { return (await mockPlan(req))!; },
  // M5.2 MOCK: Privy off, dev login on. The signature isn't checked here (the server does that with EIP-191).
  async authConfig() { return parse(C.AuthConfigRes, { privy: { enabled: false, appId: null }, devLogin: true, walletLink: { enabled: true, method: "personal_sign", maxWallets: 5 } }); },
  async walletLinkChallenge(address) {
    const nonce = "mock" + Math.random().toString(16).slice(2, 14); mockLink.pending = { nonce, address: address.toLowerCase() };
    return parse(C.WalletLinkChallengeRes, { nonce, message: `Quiver wants you to link this wallet.\n\nAddress: ${address}\nNonce: ${nonce}\n\nThis signature doesn’t move funds.`, expiresAt: new Date(Date.now() + 300000).toISOString(), domain: "localhost:3000", uri: "http://localhost:3000", chainId: 46630, version: "1" }); // MOCK
  },
  async walletLinkVerify(b) {
    const p = mockLink.pending; mockLink.pending = null;
    if (!p || p.nonce !== b.nonce) throw new ApiErr("wallet_link_invalid", "That link request expired. Start again.", 422);
    if (!mockLink.items.some((w) => w.address === p.address)) mockLink.items.push({ address: p.address, linkedAt: new Date().toISOString(), primary: mockLink.items.length === 0 });
    return parse(C.LinkedWalletsRes, { items: mockLink.items });
  },
  async myWallets() { return parse(C.LinkedWalletsRes, { items: mockLink.items }); },
  async unlinkWallet(a) {
    const i = mockLink.items.findIndex((w) => w.address === a.toLowerCase()); if (i < 0) throw new ApiErr("not_found", "That wallet isn’t linked.", 404);
    mockLink.items.splice(i, 1); return parse(C.LinkedWalletsRes, { items: mockLink.items });
  },
  // M5.1: deterministic MOCK of GET /markets/:id/detail and /history (same shapes, parsed by the contracts).
  async marketDetail(id) {
    const m = (await mockApi.markets()).items.find((x) => x.id === id);
    if (!m) throw new ApiErr("not_found", "That market isn’t listed.", 404);
    return parse(C.MarketDetailRes, mockDetail(m));
  },
  async marketHistory(id, q) {
    const m = (await mockApi.markets()).items.find((x) => x.id === id);
    if (!m) throw new ApiErr("not_found", "That market isn’t listed.", 404);
    return parse(C.MarketHistoryRes, mockHistory(m, q.tf, q.range));
  },
  ...mockExt(runOf),
  ...mockSocial,
  ...mockShare,
  ...mockChannels,
  ...mockSecrets,
  ...mockTestnet,
  async me() { return parse(C.Me, F.ME); },
  async venues() { return F.VENUES.map((v) => parse(C.VenueInfo, v)); },
  async markets(q = {}) {
    const items = F.MARKETS.map((m) => parse(C.Market, m)).filter((m) =>
      (!q.venue || m.venue === q.venue) && (!q.assetClass || m.assetClass === q.assetClass) &&
      (!q.q || (m.symbol + m.name).toLowerCase().includes(q.q.toLowerCase())));
    return parse(C.Page(C.Market), { items, nextCursor: null });
  },
  async strategies(q = {}) {
    return parse(C.ListStrategiesRes, { items: [...await listPreviewDrafts(), ...F.STRATEGIES].filter((s) => !q.status || s.status === q.status), nextCursor: null });
  },
  async strategy(id) { const draft = (await listPreviewDrafts()).find((s) => s.id === id); if (draft) return draft; if (F.STRATEGIES.some((s) => s.id === id)) return record(id); throw new ApiErr("not_found", "That draft was not found. Import its backup or sign in to its workspace.", 404); },
  compileImage: previewCompileImage,
  compile: previewCompile,
  async runs(q = {}) { return parse(C.Page(C.Run), { items: [...runState.values()].filter((r) => !q.strategyId || r.strategyId === q.strategyId), nextCursor: null }); },
  async run(id) { const r = runState.get(id); if (!r) throw new ApiErr("not_found", "Run not found", 404); return r; },
  async createStrategy(strategy) { return persistPreviewDraft(strategy); },
  backtest: previewBacktest,
  async backtestStatus() { throw new ApiErr("not_found", "Preview tests complete immediately and are not saved on a server.", 404); },
  async startRun(req) {
    const r = parse(C.StartRunReq, req);
    if (!F.STRATEGIES.some((s) => s.id === r.strategyId)) throw new ApiErr("mode_not_enabled", "Your draft is saved. Connect the continuous paper engine before starting a custom run.", 403);
    if (r.mode !== "paper") throw new ApiErr("mode_not_enabled", "Coming after paper beta", 403);
    const existing = [...runState.values()].find((x) => x.strategyId === r.strategyId && x.status !== "stopped");
    if (existing) return existing;
    const base = runState.get(F.RUN_ID)!;
    const id = `run_${r.strategyId.replace(/^stg_/, "").slice(0, 12).padEnd(12, "0")}MOCK` as Run["id"];
    const fresh = parse(C.Run, { ...base, id, strategyId: r.strategyId, status: "running", startedAt: new Date().toISOString() });
    runState.set(id, fresh); return fresh;
  },
  async control(id, action) {
    const r = await this.run(id);
    const status = action === "pause" ? "paused" : action === "resume" ? "running" : "stopped";
    const next = parse(C.Run, { ...r, status });
    runState.set(id, next); return next;
  },
  streamRun(id, onEvent) {
    // Replays events.paper.ndjson with ts gaps compressed to 1–2 s, then loops jittered ticks.
    const evs = F.EVENTS_RAW.filter((e) => !["heartbeat", "resync"].includes((e as { type: string }).type)).map((e) => parse(C.RunEvent, e)) as RunEvent[]; // frames are transport, not run events
    let i = 0, alive = true, timer: ReturnType<typeof setTimeout>;
    let seq = evs.at(-1)!.seq, cycle = 100;
    const base: Record<string, number> = { fed_odds: 0.724, nvda_px: 181.42, nvda_sma20: 185.3, sol_funding: 0.000041 };
    const step = () => {
      if (!alive) return;
      if (i < evs.length) { onEvent({ ...evs[i], runId: id as RunEvent["runId"] }); i++; timer = setTimeout(step, i === 1 ? 300 : 1000 + Math.random() * 1000); return; }
      seq++; cycle++;
      const j = (k: string, s: number, dp: number) => +(base[k] = base[k] * (1 + (Math.random() - 0.5) * s)).toFixed(dp);
      const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      onEvent(parse(C.RunEvent, {
        v: 1, seq, runId: id, mode: "paper", ts: now, type: "tick", cycle,
        signals: [
          { signalId: "fed_odds", field: "value", value: j("fed_odds", 0.004, 3), observedAt: now, source: "mock_polymarket", stale: false },
          { signalId: "nvda_px", field: "value", value: j("nvda_px", 0.002, 2), observedAt: now, source: "mock_chainlink", stale: false },
          { signalId: "sol_funding", field: "value", value: j("sol_funding", 0.05, 6), observedAt: now, source: "mock_hyperliquid", stale: false },
        ],
        triggers: [{ triggerId: "t1", state: "done", conditionTrue: true, heldForSec: 900, cooldownUntil: null, fires: 1 }],
      }) as RunEvent);
      timer = setTimeout(step, 2500);
    };
    timer = setTimeout(step, 200);
    return () => { alive = false; clearTimeout(timer); };
  },
  async portfolio(mode = "paper") { return parse(C.Portfolio, { ...F.PORTFOLIO, mode }); },
  async sessionKeys() { return parse(C.Page(C.SessionKey), { items: [], nextCursor: null }); },
  async sessionKeyDefaults() { return parse(C.SessionKeyDefaults, skDefaultsJson); }, // MOCK: backend fixture session-key.defaults.json
  // MOCK: mirrors the backend before testnet routers are verified (fail closed).
  async prepareSessionKey() { throw new ApiErr("mode_not_enabled", "No verified swap routers for this chain yet (mock).", 403); },
  // MOCK (M3.9–M4.2): Sage's fixtures; signing stays unavailable in mock mode, like a testnet server without ALCHEMY_API_KEY.
  async submitSessionKey() { throw new ApiErr("signing_unavailable", "Wallet signing isn’t available in the mock build.", 503); },
  async sessionKey() { throw new ApiErr("not_found", "No session keys in the mock build.", 404); },
  async alertSettings() { return parse(C.AlertSettings, M4.alertSettings); },
  async putAlertSettings(b) { return parse(C.PutAlertSettingsRes, { ...M4.alertSettings, webhookUrl: b.webhookUrl, signingSecretSet: !!b.webhookUrl, signingSecret: null }); },
  async alertRules() { return [parse(C.AlertRule, M4.alertRule)]; },
  async createAlertRule(b) { return parse(C.AlertRule, { ...M4.alertRule, runId: b.runId, events: b.events, enabled: b.enabled ?? true }); },
  async deleteAlertRule() {},
  async alertDeliveries() { return parse(C.AlertDeliveryList, M4.alertDeliveries); },
  async testAlert() { return parse(C.AlertDeliveryList, M4.alertDeliveries).items[0]; },
  // MOCK M5.3: positions without a mark are "stuck" (no_price); others are still closable.
  async writeOffPreview(runId, instrument) {
    const stuck = /USDC|DOGE/i.test(instrument) || instrument.endsWith("-stuck");
    return parse(C.WriteOffPreviewRes, { runId, instrument, eligible: stuck, reasons: stuck ? ["no_price"] : [], basis: "zero_recovery",
      message: stuck ? "No price has arrived for this instrument, so it can’t be closed. Writing it off books it at $0." : "This position can still be closed normally.",
      position: { qty: "10", avgEntry: "12.5", kind: "spot" }, lossUsd: stuck ? "125.00" : null });
  },
  async writeOff(runId, b) {
    const p = await this.writeOffPreview(runId, b.instrument);
    if (!p.eligible) throw new ApiErr("conflict", p.message, 409);
    return parse(C.WriteOffRes, { runId, instrument: b.instrument, writtenOff: true, reasons: p.reasons, qty: "10", avgEntry: "12.5", lossUsd: p.lossUsd, basis: "zero_recovery", at: new Date().toISOString() });
  },
  async closePosition() { return parse(C.ClosePositionRes, M4.positionClose); },
  async runEvents() { return []; }, // MOCK: mock runs stream their history
  async portfolioRuns() { return parse(C.PortfolioRuns, M4.portfolioRuns); }, // MOCK
  async portfolioAllocation(q = {}) { return { ...parse(C.PortfolioAllocation, M4.portfolioAllocation), by: q.by ?? "venue" }; }, // MOCK: one fixture for every grouping
  async portfolioHistory() { return parse(C.PortfolioHistory, M4.portfolioHistory); }, // MOCK
  async positions() { return parse(C.PositionsRes, M4.positionsPaper); }, // MOCK
  async runPositions(id: string) { const r = parse(C.PositionsRes, M4.positionsPaper); return { ...r, items: r.items.filter((p) => p.runId === id) }; }, // MOCK
  async publicLeaderboard() { return parse(C.PublicLeaderboardRes, pubLeaderboard); }, // MOCK
  async publicCard() { return parse(C.PublicCard, pubCard); }, // MOCK
  async shareCard() { return parse(C.CardShareRes, cardShare); }, // MOCK
  async revokeCard() { return { revoked: 1 }; }, // MOCK
  async instruct(_id, text) { // MOCK: "pause all" → 422 strategy_invalid; "quota" → 429 compile_quota_exceeded (Retry-After 90)
    if (/pause (all|every)/i.test(text)) throw new ApiErr("strategy_invalid", "A strategy needs at least one active rule", 422, [{ path: "/triggers", code: "strategy_needs_rule", message: "A strategy needs at least one active rule" }]);
    if (/quota/i.test(text)) throw new ApiErr("compile_quota_exceeded", "Daily compile limit reached.", 429, undefined, 90);
    return parse(C.InstructProposal, instructProp); }, // MOCK
  async applyInstruct() { return parse(C.InstructApplyRes, instructApply); }, // MOCK
  async replay() { return parse(C.Replay, M4.runReplay); }, // MOCK
  async autopilot() { return parse(C.Autopilot, mockAp ?? M4.autopilotState); }, // MOCK
  async putAutopilot(b) { const cur = parse(C.Autopilot, mockAp ?? M4.autopilotState); if (cur.killed && b.enabled && !b.acknowledgeKill) throw new ApiErr("conflict", "Autopilot was killed; send acknowledgeKill: true to re-enable.", 409); const r = C.PutAutopilotReq.parse(b); mockAp = { ...cur, configured: true, enabled: r.enabled, killed: r.enabled ? false : cur.killed, strategyIds: r.strategyIds, rotateEveryMin: r.rotateEveryMin, approvalMode: r.approvalMode, startingEquityUsd: r.startingEquityUsd, guardrails: r.guardrails }; return parse(C.Autopilot, mockAp); }, // MOCK
  async killAutopilot() { const cur = parse(C.Autopilot, mockAp ?? M4.autopilotState); const run = cur.state.currentRunId;
    // MOCK: ?mock=kill_partial → the first kill reports the current run as failed to stop (207); a retry succeeds.
    const fail = !mockKillTried && typeof location !== "undefined" && new URLSearchParams(location.search).get("mock") === "kill_partial"; mockKillTried = true;
    mockAp = { ...cur, enabled: false, killed: true, state: { ...cur.state, currentRunId: fail ? run : null, currentStrategyId: fail ? cur.state.currentStrategyId : null, nextRotationAt: null } };
    return parse(C.AutopilotKillRes, { ...(mockAp as object), kill: fail ? { stopped: 0, failed: [{ runId: run ?? "run_mock_stuck", reason: "Stop timed out after 5 s" }] } : { stopped: run ? 1 : 0, failed: [] } }); }, // MOCK
  async autopilotLog() { return parse(C.AutopilotLog, M4.autopilotLog); }, // MOCK
  async approvals(q = {}) { const l = parse(C.ApprovalList, M4.approvalsPending); return { ...l, items: l.items.filter((a) => (!q.status || a.status === q.status) && (!q.runId || a.runId === q.runId)) }; },
  async decideApproval(id, d) { const a = parse(C.ApprovalList, M4.approvalsPending).items.find((x) => x.id === id); if (!a) throw new ApiErr("not_found", "Approval not found.", 404); return { ...a, status: d === "approve" ? "approved" : "rejected", resolvedAt: new Date().toISOString() }; },
};

// Demo backtest (mock mode only; every field is from C.BacktestRes, values are illustrative).
function mockBacktest() {
  const t0 = Date.parse("2026-09-27T00:00:00Z"), day = 86_400_000;
  const eq = Array.from({ length: 31 }, (_, i) => 10000 + i * 14 + Math.round(Math.sin(i / 3) * 90));
  return parse(C.BacktestRes, {
    id: "bkt_demo0000000000000000", status: "done", dataSource: "fallback", progress: 1, error: null,
    dataCoverage: [
      { instrument: "robinhood:token:0x00000000000000000000000000000000000000a1", source: "chainlink_mainnet_readonly", from: new Date(t0 + 12 * day).toISOString(), to: new Date(t0 + 30 * day).toISOString(), gaps: 2, synthetic: false },
      { instrument: "robinhood:token:0x00000000000000000000000000000000000000a1", source: "modeled_eod_tiingo", from: new Date(t0).toISOString(), to: new Date(t0 + 12 * day).toISOString(), gaps: 0, synthetic: false },
      { instrument: "pm:outcome:fed-cut-december:YES", source: "none", from: new Date(t0).toISOString(), to: new Date(t0 + 30 * day).toISOString(), gaps: 0, synthetic: false },
    ],
    result: {
      endingEquityUsd: "10412.36", returnPct: "4.12", maxDrawdownPct: "-2.31", sharpe: "1.42", trades: 6, winRatePct: "66.67", feesUsd: "3.10",
      equityCurve: eq.map((v, i) => [new Date(t0 + i * day).toISOString(), v.toFixed(2)]),
      fills: [], triggerFires: [], caveats: ["Past results are not a promise of future returns.", "Before the on-chain feed starts, prices are modeled from end-of-day data."],
      stats: { sortino: "2.05", volatilityAnnPct: "11.8", maxDrawdownDurationHours: "58", closedTrades: 3, profitFactor: "2.4", avgWinUsd: "184.20", avgLossUsd: "-76.75", conventions: "Sharpe/Sortino: sample sd, rf=0, annualised over 365 days." },
      costs: { feesUsd: "3.10", gasUsd: "0.42", spreadUsd: "1.85", impactUsd: "0.96" },
    },
  });
}
