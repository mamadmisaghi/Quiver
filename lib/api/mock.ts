import { publicChartHistory } from "./chart-history";
import { readKeyDefaults } from "./browser-settings";
import { listPaperSessions, sessionStatus } from "@/lib/paper/sessions";
import { isQuoteSession } from "@/lib/paper/account";
import { previewCompile, previewCompileImage } from "./preview-compile";
import { previewBacktest } from "./preview-backtest";
import { listPreviewDrafts, persistPreviewDraft, updatePreviewDraft } from "./preview-workspace";

// MOCK adapter: implements QuiverApi from contract fixtures. Swap for live.ts via NEXT_PUBLIC_API_MODE=live.
import * as C from "@/lib/contracts";

import * as F from "./fixtures";
import { mockExt } from "./ext-mock";
import { mockSocial } from "./social-mock";
import { mockShare } from "./share-mock";
import { mockChannels } from "./channel-mock";


import { previewAlerts } from "./preview-alerts";
import { previewConnections } from "./preview-connections";
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
const emptyAutopilot = { ...autopilotState, configured: false, enabled: false, strategyIds: [],
  state: { currentRunId: null, currentStrategyId: null, currentStrategyName: null, nextRotationAt: null, rotationsToday: 0, dayPnlUsd: "0", platformKillSwitch: false, lastDecision: null } };
let mockAp: unknown = null; // MOCK autopilot state (in-memory)
let mockKillTried = false; // MOCK
import { ApiErr, type QuiverApi, type RunEvent, type Run, type StrategyRecord } from "./types";
// Strict fixture checks that used to live in demo.ts (demo graph stays zod-free for first paint).
F.PARTIAL_NODES.forEach((node) => C.CompileEvent.parse({ type: "partial", node }));
C.Humanized.parse(F.HUMANIZED);

const parse = <T>(schema: { parse: (x: unknown) => T }, x: unknown): T => schema.parse(x); // drift fails loudly
const unavailableRun = () => new ApiErr("not_found", "This paper session is unavailable. Open a session from Paper trades.", 404);
const runOf = async (_id: string): Promise<Run> => { throw unavailableRun(); };

let marketRequest: Promise<ReturnType<typeof C.Market.parse>[]> | null = null;
let marketRequestAt = 0;
function observedMarkets() {
  if (!marketRequest || Date.now() - marketRequestAt > 30_000) {
    marketRequestAt = Date.now();
    marketRequest = fetch("/api/preview/markets").then(async response => {
      if (!response.ok) throw new Error("Market directory unavailable.");
      return C.Page(C.Market).parse(await response.json()).items;
    }).catch(error => { marketRequest = null; throw error; });
  }
  return marketRequest;
}
const mockLink: { pending: { nonce: string; address: string } | null; items: { address: string; linkedAt: string; primary: boolean }[] } = { pending: null, items: [] }; // MOCK
// MOCK M5.4: deterministic plan over the user's mock strategies.
async function mockPlan(req: import("./types").AutopilotPlanReq, on?: (f: import("./types").PlanFrame) => void, signal?: AbortSignal) {
  const goal = req.goal ?? "balanced", lookbackDays = req.lookbackDays ?? 7;
  const list = (await mockApi.strategies()).items.filter(s => !req.strategyIds || req.strategyIds.includes(s.id)).slice(0, 10);
  const sessions = typeof window === "undefined" ? [] : listPaperSessions().filter(isQuoteSession);
  const from = Date.now() - lookbackDays * 86_400_000;
  on?.({ event: "status", data: { stage: "loading", message: `Loading ${list.length} strategies` } });
  on?.({ event: "status", data: { stage: "scoring", message: `Reading recorded paper sessions from the last ${lookbackDays} days` } });
  const cands = [] as import("./types").AutopilotPlanCandidate[];
  for (const [i, st] of list.entries()) {
    if (signal?.aborted) return null;
    const session = sessions.find(s => s.strategyId === st.id && s.strategyVersion === st.version && s.state?.curve.some(([t]) => t >= from));
    const state = session?.state;
    const earlier = state?.curve.filter(([t]) => t < from).at(-1);
    const baseline = earlier?.[1] ?? (state && state.startedAt >= from ? state.budget : null);
    const curve = state?.curve.filter(([t]) => t >= from) ?? [];
    const trades = state?.events.filter(e => e.at >= from).length ?? 0;
    let metrics = null;
    if (baseline !== null && baseline > 0 && curve.length && trades) {
      let peak = baseline, maxDrawdown = 0;
      for (const [, equity] of curve) { peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, 100 * (peak - equity) / peak); }
      metrics = { returnPct: ((curve[curve.length - 1][1] / baseline - 1) * 100).toFixed(2), maxDrawdownPct: maxDrawdown.toFixed(2), trades, sharpe: null };
    }
    const ok = !!metrics && Number(metrics.maxDrawdownPct) <= 25;
    const score = ok && metrics ? Number((Number(metrics.returnPct) - Number(metrics.maxDrawdownPct) / 2).toFixed(2)) : null;
    const c = { strategyId: st.id, name: st.name, index: i, total: list.length, ok, error: metrics ? null : "No recorded fills and equity for this period.", metrics, score };
    cands.push(c); on?.({ event: "candidate", data: c });
  }
  on?.({ event: "status", data: { stage: "ranking", message: "Ranking recorded results" } });
  const ranked = cands.filter((c) => c.ok).sort((a, b) => (b.score! - a.score!) || a.strategyId.localeCompare(b.strategyId)).slice(0, 5);
  const worst = Math.max(0, ...ranked.map((c) => Number(c.metrics!.maxDrawdownPct)));
  const plan = parse(C.AutopilotPlan, { goal, lookbackDays, ranked, excluded: cands.filter((c) => !ranked.includes(c)), source: "deterministic", synthetic: false, notice: "Uses the latest recorded quote session for each strategy version.",
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
  async marketDetail(id) {
    const market = (await observedMarkets()).find(m => m.id === id);
    if (!market) throw new ApiErr("not_found", "That market isn’t listed.", 404);
    return { market, returns: { "1d": null, "7d": null, "30d": null }, high30d: null, low30d: null, volatility30dPct: null, synthetic: false, notice: null };
  },
  marketHistory(id, { tf, range }) { return publicChartHistory(id,tf,range); },
  ...mockExt(runOf),
  ...mockSocial,
  ...mockShare,
  ...mockChannels,
  ...previewConnections,
  ...mockTestnet,
  async settings() {
    const settings = await mockExt(runOf).settings();
    const sessions = typeof window !== "undefined" ? listPaperSessions() : [];
    const drafts = await listPreviewDrafts();
    return {
      ...settings, asOf: new Date().toISOString(), sessionKeyDefaults: readKeyDefaults(),
      usage: { ...settings.usage, strategies: drafts.length, activeRuns: sessions.filter(s => sessionStatus(s) === "running").length },
    };
  },
  async me() { return parse(C.Me, F.ME); },
  async venues() { return F.VENUES.map((v) => parse(C.VenueInfo, v)); },
  async markets(q = {}) {
    const items = (await observedMarkets()).filter((m) =>
      (!q.venue || m.venue === q.venue) && (!q.assetClass || m.assetClass === q.assetClass) &&
      (!q.q || (m.symbol + m.name).toLowerCase().includes(q.q.toLowerCase())));
    return parse(C.Page(C.Market), { items, nextCursor: null });
  },
  async strategies(q = {}) {
    const drafts = await listPreviewDrafts();
    return parse(C.ListStrategiesRes, { items: drafts.filter(s => !q.status || s.status === q.status), nextCursor: null });
  },
  async strategy(id) {
    const draft = (await listPreviewDrafts()).find(s => s.id === id);
    if (draft) return draft;
    throw new ApiErr("not_found", "Draft not found in this browser. Open it on the original device or import a backup.", 404);
  },
  compileImage: previewCompileImage,
  compile: previewCompile,
  async runs() { return { items: [], nextCursor: null }; },
  run: runOf,
  async createStrategy(strategy) { return persistPreviewDraft(strategy); },
  async updateStrategy(id, strategy, expectedVersion) {
    const current = await mockApi.strategy(id);
    if (current.activeRunId) throw new ApiErr("conflict", "Stop the active run before changing its saved limits.", 409);
    return updatePreviewDraft(current, strategy, expectedVersion);
  },
  backtest: previewBacktest,
  async backtestStatus() { throw new ApiErr("not_found", "Completed rule simulations are available in the builder.", 404); },
  async startRun() { throw new ApiErr("mode_not_enabled", "Open your strategy and choose Run paper trade to start a session.", 403); },
  async control() { throw unavailableRun(); },
  streamRun() { return () => {}; },
  async portfolio(mode = "paper") { return parse(C.Portfolio, { mode, equityUsd: "0", cashUsd: "0", realizedPnlUsd: "0", unrealizedPnlUsd: "0", positions: [], asOf: new Date().toISOString() }); },
  async sessionKeys() { return parse(C.Page(C.SessionKey), { items: [], nextCursor: null }); },
  async sessionKeyDefaults() { return parse(C.SessionKeyDefaults, readKeyDefaults()); }, // MOCK: backend fixture session-key.defaults.json
  // MOCK: mirrors the backend before testnet routers are verified (fail closed).
  async prepareSessionKey() { throw new ApiErr("mode_not_enabled", "No verified swap routers for this chain yet.", 403); },
  // MOCK (M3.9–M4.2): Sage's fixtures; signing stays unavailable in mock mode, like a testnet server without ALCHEMY_API_KEY.
  async submitSessionKey() { throw new ApiErr("signing_unavailable", "Wallet signing isn’t available in this workspace.", 503); },
  async sessionKey() { throw new ApiErr("not_found", "No session keys in this workspace.", 404); },
  ...previewAlerts,
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
  async positions() { return { mode: "paper", items: [], asOf: new Date().toISOString() }; }, // MOCK
  async runPositions(id: string) { const r = parse(C.PositionsRes, M4.positionsPaper); return { ...r, items: r.items.filter((p) => p.runId === id) }; }, // MOCK
  async publicLeaderboard(q = {}) { return parse(C.PublicLeaderboardRes, { ...pubLeaderboard, period: q.period ?? "7d", items: [], notice: "", synthetic: false, asOf: new Date().toISOString() }); }, // MOCK
  async publicCard() { throw new ApiErr("not_found", "This card is unavailable.", 404); }, // MOCK
  async shareCard() { return parse(C.CardShareRes, cardShare); }, // MOCK
  async revokeCard() { return { revoked: 1 }; }, // MOCK
  async instruct(_id, text) { // MOCK: "pause all" → 422 strategy_invalid; "quota" → 429 compile_quota_exceeded (Retry-After 90)
    if (/pause (all|every)/i.test(text)) throw new ApiErr("strategy_invalid", "A strategy needs at least one active rule", 422, [{ path: "/triggers", code: "strategy_needs_rule", message: "A strategy needs at least one active rule" }]);
    if (/quota/i.test(text)) throw new ApiErr("compile_quota_exceeded", "Daily compile limit reached.", 429, undefined, 90);
    return parse(C.InstructProposal, instructProp); }, // MOCK
  async applyInstruct() { return parse(C.InstructApplyRes, instructApply); }, // MOCK
  async replay() { throw unavailableRun(); }, // MOCK
  async autopilot() { return parse(C.Autopilot, mockAp ?? emptyAutopilot); }, // MOCK
  async putAutopilot(b) { const cur = parse(C.Autopilot, mockAp ?? emptyAutopilot); if (cur.killed && b.enabled && !b.acknowledgeKill) throw new ApiErr("conflict", "Autopilot was killed; send acknowledgeKill: true to re-enable.", 409); const r = C.PutAutopilotReq.parse(b); mockAp = { ...cur, configured: true, enabled: r.enabled, killed: r.enabled ? false : cur.killed, strategyIds: r.strategyIds, rotateEveryMin: r.rotateEveryMin, approvalMode: r.approvalMode, startingEquityUsd: r.startingEquityUsd, guardrails: r.guardrails }; return parse(C.Autopilot, mockAp); }, // MOCK
  async killAutopilot() { const cur = parse(C.Autopilot, mockAp ?? emptyAutopilot); const run = cur.state.currentRunId;
    // MOCK: ?mock=kill_partial → the first kill reports the current run as failed to stop (207); a retry succeeds.
    const fail = !mockKillTried && typeof location !== "undefined" && new URLSearchParams(location.search).get("mock") === "kill_partial"; mockKillTried = true;
    mockAp = { ...cur, enabled: false, killed: true, state: { ...cur.state, currentRunId: fail ? run : null, currentStrategyId: fail ? cur.state.currentStrategyId : null, nextRotationAt: null } };
    return parse(C.AutopilotKillRes, { ...(mockAp as object), kill: fail ? { stopped: 0, failed: [{ runId: run ?? "run_mock_stuck", reason: "Stop timed out after 5 s" }] } : { stopped: run ? 1 : 0, failed: [] } }); }, // MOCK
  async autopilotLog() { return { items: [], nextCursor: null }; }, // MOCK
  async approvals() { return { items: [], nextCursor: null }; },
  async decideApproval() { throw new ApiErr("not_found", "Approval not found.", 404); },
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
