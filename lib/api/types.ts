// Types for the web app come only from Sage's contracts (lib/contracts = backend/contracts/src).
import type { z } from "zod";
import type * as C from "@/lib/contracts";
export type { Expr, Strategy, Signal, Trigger, Action, Venue, RunMode, RunEvent, RunStreamFrame, RunEventType, CompileEvent, Instrument, ValidationIssue, ApiError, ErrorCode } from "@/lib/contracts";
export type WriteOffPreview = z.infer<typeof C.WriteOffPreviewRes>;
export type WriteOffRes = z.infer<typeof C.WriteOffRes>;
export type BacktestReq = z.input<typeof C.BacktestReq>;
export type BacktestRes = z.infer<typeof C.BacktestRes>;
export type Humanized = z.infer<typeof C.Humanized>;
export type Me = z.infer<typeof C.Me>;
export type VenueInfo = z.infer<typeof C.VenueInfo>;
export type Market = z.infer<typeof C.Market>;
export type MarketsQuery = z.input<typeof C.MarketsQuery>;
export type StrategyRecord = z.infer<typeof C.StrategyRecord>;
export type StrategySummary = z.infer<typeof C.StrategySummary>;
export type Run = z.infer<typeof C.Run>;
export type RunControl = z.infer<typeof C.RunControlReq>["action"];
export type StartRunReq = z.input<typeof C.StartRunReq>;
export type CompileReq = z.infer<typeof C.CompileReq>;
export type CompileImageReq = z.infer<typeof C.CompileImageReq>;
export type Portfolio = z.infer<typeof C.Portfolio>;
export type Position = z.infer<typeof C.Position>;
export type SessionKey = z.infer<typeof C.SessionKey>;
export type SessionKeyDefaults = z.infer<typeof C.SessionKeyDefaults>;
export type PrepareSessionKeyReq = z.infer<typeof C.PrepareSessionKeyReq>;
export type PrepareSessionKeyRes = z.infer<typeof C.PrepareSessionKeyRes>;
export type Page<T> = { items: T[]; nextCursor: string | null };
/** Compile `partial.node`: the only contract-defined graph-node shape (watch|when|do|exit). */
export type GraphNode = Extract<C.CompileEvent, { type: "partial" }>["node"];

export type Unsubscribe = () => void;
export interface QuiverApi extends QuiverApiExt, QuiverMarketApi, QuiverAuthApi, QuiverPlanApi, QuiverSocialApi, QuiverShareApi, QuiverChannelApi, QuiverSecretsApi, QuiverTestnetApi {
  backtest(req: BacktestReq): Promise<BacktestRes>;
  backtestStatus(id: string): Promise<BacktestRes>;
  me(): Promise<Me>;
  venues(): Promise<VenueInfo[]>;
  markets(q?: MarketsQuery): Promise<Page<Market>>;
  strategies(q?: { status?: StrategySummary["status"] }): Promise<Page<StrategySummary>>;
  strategy(id: string): Promise<StrategyRecord>;
  /** POST /v1/compile — NDJSON stream of CompileEvent. */
  compile(req: CompileReq, onEvent: (e: C.CompileEvent) => void, signal?: AbortSignal): Promise<void>;
  /** M5.6 POST /v1/compile/image — chart screenshot (+ optional note) → same NDJSON CompileEvent stream. 422 image_invalid {reason}, 413 payload_too_large, 503 vision_unavailable. */
  compileImage(req: CompileImageReq, onEvent: (e: C.CompileEvent) => void, signal?: AbortSignal): Promise<void>;
  runs(q?: { strategyId?: string }): Promise<Page<Run>>;
  run(id: string): Promise<Run>;
  /** POST /v1/strategies {strategy} (idempotent). */
  createStrategy(strategy: C.Strategy): Promise<StrategyRecord>;
  startRun(req: StartRunReq): Promise<Run>;
  control(id: string, action: RunControl): Promise<Run>;
  /** GET /v1/runs/:id/events/stream via a stream ticket. */
  streamRun(id: string, onEvent: (e: C.RunStreamFrame) => void, onIssue?: (msg: string | null) => void): Unsubscribe;
  portfolio(mode?: C.RunMode): Promise<Portfolio>;
  sessionKeys(): Promise<Page<SessionKey>>;
  /** GET /v1/session-keys/defaults (M3.6.1) — go-live caps prefill. */
  sessionKeyDefaults(): Promise<SessionKeyDefaults>;
  prepareSessionKey(b: PrepareSessionKeyReq): Promise<PrepareSessionKeyRes>;
  /** M3.9: POST /session-keys/submit after the wallet signed (and installed) the grant. */
  submitSessionKey(b: SubmitSessionKeyReq): Promise<SessionKey>;
  sessionKey(id: string): Promise<SessionKey>;
  // M4.0 alerts
  alertSettings(): Promise<AlertSettings>;
  /** signingSecret is non-null only when just created/rotated — show once, never store or log. */
  putAlertSettings(b: { webhookUrl: string | null; rotateSecret?: boolean }): Promise<PutAlertSettingsRes>;
  alertRules(): Promise<AlertRule[]>;
  createAlertRule(b: { runId: string | null; events: AlertEventType[]; enabled?: boolean }): Promise<AlertRule>;
  deleteAlertRule(id: string): Promise<void>;
  alertDeliveries(q?: { limit?: number; cursor?: string }): Promise<{ items: AlertDelivery[]; nextCursor: string | null }>;
  testAlert(): Promise<AlertDelivery>;
  // M4.1 partial close (paper)
  closePosition(runId: string, b: { instrument: string; pct: number }): Promise<ClosePositionRes>;
  // M5.3 write-off (paper, zero recovery)
  writeOffPreview(runId: string, instrument: string): Promise<WriteOffPreview>;
  writeOff(runId: string, b: { instrument: string; confirm: true }): Promise<WriteOffRes>;
  /** GET /v1/runs/:id/events (history page, used to seed positions before the stream). */
  runEvents(id: string): Promise<C.RunEvent[]>;
  // M4.3 portfolio views
  portfolioRuns(q?: { mode?: C.RunMode; status?: "active" | "stopped" | "all" }): Promise<PortfolioRuns>;
  portfolioAllocation(q?: { mode?: C.RunMode; by?: AllocationBy }): Promise<PortfolioAllocation>;
  portfolioHistory(q?: { mode?: C.RunMode; points?: number }): Promise<PortfolioHistory>;
  // M4.6 open positions (server-marked)
  positions(q?: { mode?: C.RunMode }): Promise<Positions>;
  runPositions(runId: string): Promise<Positions>;
  // M4.4 run replay
  replay(runId: string, q?: { frameMs?: number; maxFrames?: number }): Promise<Replay>;
  // M4.5 autopilot (paper only)
  autopilot(): Promise<Autopilot>;
  putAutopilot(b: PutAutopilotReq): Promise<Autopilot>;
  /** M4.9.1: 200 all stopped, 207 some failed (kill.failed[]); both resolve. */
  killAutopilot(): Promise<AutopilotKill>;
  autopilotLog(q?: { limit?: number; cursor?: string }): Promise<AutopilotLog>;
  // M4.2 approvals
  approvals(q?: { status?: ApprovalStatus; runId?: string; limit?: number }): Promise<{ items: Approval[]; nextCursor: string | null }>;
  decideApproval(id: string, decision: "approve" | "reject"): Promise<Approval>;
  /** M4.8 public (no auth) */
  publicLeaderboard(q?: { period?: "7d" | "30d" | "all"; limit?: number }): Promise<PublicBoard>;
  publicCard(token: string): Promise<PublicCard>;
  shareCard(runId: string): Promise<CardShare>;
  revokeCard(runId: string): Promise<{ revoked: number }>;
  /** M4.9 instruct (paper) */
  instruct(runId: string, text: string): Promise<InstructProposal>;
  applyInstruct(runId: string, proposalId: string): Promise<InstructApply>;
}
export type SubmitSessionKeyReq = z.infer<typeof C.SubmitSessionKeyReq>;
export type AlertSettings = z.infer<typeof C.AlertSettings>;
export type PutAlertSettingsRes = z.infer<typeof C.PutAlertSettingsRes>;
export type AlertRule = z.infer<typeof C.AlertRule>;
export type AlertEventType = z.infer<typeof C.AlertEventType>;
export type AlertDelivery = z.infer<typeof C.AlertDelivery>;
export type ClosePositionRes = z.infer<typeof C.ClosePositionRes>;
export type Approval = z.infer<typeof C.Approval>;
export type ApprovalStatus = z.infer<typeof C.ApprovalStatus>;
export class ApiErr extends Error {
  constructor(public code: C.ErrorCode, message: string, public status: number, public details?: unknown, public retryAfterSec: number | null = null) { super(message); }
}

// ---------- v1.1 extensions (lib/contracts/ext.ts) ----------
export type EquitySeries = z.infer<typeof C.EquitySeries>;
export type PublicStrategySummary = z.infer<typeof C.PublicStrategySummary>;
export type PublicStrategyDetail = z.infer<typeof C.PublicStrategyDetail>;
export type Trader = z.infer<typeof C.Trader>;
export type Leaderboard = z.infer<typeof C.LeaderboardRes>;
export type Rewards = z.infer<typeof C.RewardsRes>;
export type Revenue = z.infer<typeof C.RevenueRes>;
export type Skill = z.infer<typeof C.Skill>;
export type StrategyNode = z.infer<typeof C.StrategyNode>;
// v1.2 (M3.8)
export type Landing = z.infer<typeof C.LandingRes>;
export type AccountSettings = z.infer<typeof C.AccountSettingsRes>;
export type StopAll = z.infer<typeof C.StopAllRes>;
export type RunCard = z.infer<typeof C.RunCard>;
export interface QuiverApiExt {
  equity(runId: string, points?: number): Promise<EquitySeries>;
  publicStrategies(q?: { venue?: C.Venue; sort?: "return_30d" | "forks" | "new" }): Promise<Page<PublicStrategySummary>>;
  /** GET /public/strategies/:id — thesis, rules, graph nodes, lineage. */
  publicStrategy(id: string): Promise<PublicStrategyDetail>;
  /** POST /public/strategies/:id/fork — saves an editable private copy (v1). No run is started. */
  forkPublicStrategy(id: string): Promise<StrategyRecord>;
  traders(window?: "7d" | "30d" | "all"): Promise<Leaderboard>;
  rewards(): Promise<Rewards>;
  revenue(): Promise<Revenue>;
  skills(): Promise<Skill[]>;
  /** Resolve a run id for the paper-run view. Live: if the id isn't the user's, start (or reuse) a paper run of the demo strategy. */
  resolveRun(id: string): Promise<Run>;
  /** v1.2: guest landing data (no auth). */
  landing(): Promise<Landing>;
  settings(): Promise<AccountSettings>;
  stopAll(b?: { flatten?: boolean; mode?: "paper" | "testnet" }): Promise<StopAll>;
  runCard(runId: string): Promise<RunCard>;
}
export type PortfolioRuns = z.infer<typeof C.PortfolioRuns>;
export type PortfolioRunRow = z.infer<typeof C.PortfolioRunRow>;
export type AllocationBy = z.infer<typeof C.AllocationBy>;
export type PortfolioAllocation = z.infer<typeof C.PortfolioAllocation>;
export type PortfolioHistory = z.infer<typeof C.PortfolioHistory>;
export type Replay = z.infer<typeof C.Replay>;
export type ReplayFrame = z.infer<typeof C.ReplayFrame>;
export type Autopilot = z.infer<typeof C.Autopilot>;
export type AutopilotKill = z.infer<typeof C.AutopilotKillRes>;
export type AutopilotDecision = z.infer<typeof C.AutopilotDecision>;
export type AutopilotDecisionView = z.infer<typeof C.AutopilotDecisionView>;
export type Positions = z.infer<typeof C.PositionsRes>;
export type OpenPosition = z.infer<typeof C.OpenPosition>;
export type ApproveConflictDetails = z.infer<typeof C.ApproveConflictDetails>;
export type AutopilotLog = z.infer<typeof C.AutopilotLog>;
export type PutAutopilotReq = z.input<typeof C.PutAutopilotReq>;

export type PublicBoard = z.infer<typeof C.PublicLeaderboardRes>;
export type PublicBoardItem = z.infer<typeof C.PublicLeaderboardItem>;
export type PublicCard = z.infer<typeof C.PublicCard>;
export type CardShare = z.infer<typeof C.CardShareRes>;
export type InstructProposal = z.infer<typeof C.InstructProposal>;
export type InstructApply = z.infer<typeof C.InstructApplyRes>;
export type InstructOp = z.infer<typeof C.InstructOp>;

// ---------------------------------------------------------------------------------------------
// M5.1 market detail: real contracts (backend 82dfa59, contracts/src/market.ts).
export type MarketTf = z.infer<typeof C.MarketTf>;
export type MarketRange = z.infer<typeof C.MarketRange>;
export type MarketBar = z.infer<typeof C.MarketBar>;
export type MarketHistoryRes = z.infer<typeof C.MarketHistoryRes>;
export type MarketDetailRes = z.infer<typeof C.MarketDetailRes>;
// PROPOSED — awaiting Sage (see PROPOSED-API.md): no server index of strategies by instrument yet.
// The web lists your runs holding the instrument plus public strategies on the same venue. // MOCK
export type MarketStrategyRef = { strategyId: string; name: string; runId: string | null; mine: boolean; status: "running" | "paused" | "idle" };
export interface QuiverMarketApi {
  marketDetail(instrument: string): Promise<MarketDetailRes>;
  marketHistory(instrument: string, q: { tf: MarketTf; range: MarketRange }): Promise<MarketHistoryRes>;
}

// M5.2 Privy sign-in config + wallet link (backend f52bee4, contracts/src/auth.ts).
export type AuthConfig = z.infer<typeof C.AuthConfigRes>;
export type LinkedWallet = z.infer<typeof C.LinkedWallet>;
export type LinkedWallets = z.infer<typeof C.LinkedWalletsRes>;
export type WalletLinkChallenge = z.infer<typeof C.WalletLinkChallengeRes>;
export interface QuiverAuthApi {
  authConfig(): Promise<AuthConfig>;
  walletLinkChallenge(address: string): Promise<WalletLinkChallenge>;
  walletLinkVerify(b: { nonce: string; signature: string }): Promise<LinkedWallets>;
  myWallets(): Promise<LinkedWallets>;
  unlinkWallet(address: string): Promise<LinkedWallets>;
}

// M5.4 autopilot plan (paper). The proposal never applies itself: the UI PUTs /autopilot only on an explicit click.
export type AutopilotPlanReq = z.input<typeof C.AutopilotPlanReq>;
export type AutopilotPlan = z.infer<typeof C.AutopilotPlan>;
export type AutopilotPlanCandidate = z.infer<typeof C.AutopilotPlanCandidate>;
export type PlanFrame =
  | { event: "status"; data: z.infer<typeof C.AutopilotPlanStatus> }
  | { event: "candidate"; data: AutopilotPlanCandidate }
  | { event: "plan"; data: AutopilotPlan }
  | { event: "error"; data: { code: string; message: string } };
export interface QuiverPlanApi {
  autopilotPlanStream(req: AutopilotPlanReq, onFrame: (f: PlanFrame) => void, signal?: AbortSignal): Promise<void>;
  autopilotPlan(req: AutopilotPlanReq): Promise<AutopilotPlan>;
}

// M5.5 (+M5.10) profiles, follow, paper-only copy. Handles are used exactly as the server returns them (always with @).
export type Profile = z.infer<typeof C.Profile>;
export type FollowRes = z.infer<typeof C.FollowRes>;
export type FollowingRes = z.infer<typeof C.FollowingRes>;
export type CopyView = z.infer<typeof C.CopyView>;
export type CopyListRes = z.infer<typeof C.CopyListRes>;
export type CopyReq = z.input<typeof C.CopyReq>;
// M5.12 activity feed (GET /v1/activity)
export type ActivityItem = z.infer<typeof C.ActivityItem>;
export type ActivityRes = z.infer<typeof C.ActivityRes>;
export type SearchRes = z.infer<typeof C.SearchRes>;
export type ActivityScope = "all" | "following" | "mine";
export interface QuiverSocialApi {
  profile(handle: string): Promise<Profile>;
  myProfile(): Promise<Profile>;
  putMyProfile(b: { displayName?: string | null; bio?: string | null }): Promise<Profile>;
  follow(handle: string): Promise<FollowRes>;
  unfollow(handle: string): Promise<FollowRes>;
  following(): Promise<FollowingRes>;
  copy(b: CopyReq): Promise<CopyView>;
  copies(): Promise<CopyListRes>;
  syncCopy(strategyId: string): Promise<CopyView>;
  /** M5.16: with `handle` (always "@x"), scope is ignored and only that trader's public items come back (run always null; limited = withheld; 404 unknown). */
  activity(q: { scope?: ActivityScope; handle?: string; cursor?: string | null; limit?: number }): Promise<ActivityRes>;
  /** M5.17 ⌘K global search: q 1..80 chars (client caps), 422 empty/long, 429 at 60/min. Public data only. */
  search(q: string, limit?: number): Promise<SearchRes>;
}

// M5.7 shareable replays. Titles are plain text from the server (M5.10: cleaned) and must always render as text, never HTML.
export type ReplayShareView = z.infer<typeof C.ReplayShareView>;
export type ReplayShareList = z.infer<typeof C.ReplayShareList>;
export type RenderJob = z.infer<typeof C.RenderJob>;
export type PublicReplay = z.infer<typeof C.PublicReplay>;
export type CreateReplayShareReq = z.input<typeof C.CreateReplayShareReq>;
export type RenderSpecIn = z.input<typeof C.RenderSpec>;
export interface QuiverShareApi {
  /** POST /runs/:id/replay/share → 201 (paper/testnet only; 422 nothing to replay; 429 over 20 live links). */
  shareReplay(runId: string, b: CreateReplayShareReq): Promise<ReplayShareView>;
  myReplays(): Promise<ReplayShareList>;
  /** POST /replays/:token/render → 202 RenderJob; 409 while one is queued/rendering or after revoke. */
  renderReplay(token: string, b: RenderSpecIn): Promise<RenderJob>;
  /** DELETE /replays/:token → 204. */
  revokeReplay(token: string): Promise<void>;
  /** GET /public/replays/:token (no auth). 404 when unknown or revoked. */
  publicReplay(token: string): Promise<PublicReplay>;
}

// M5.8 chat alert channels (Telegram / X). M5.14: status ok = server sender configured, not_configured = no token.
export type AlertChannel = z.infer<typeof C.AlertChannel>;
export type AlertChannelName = z.infer<typeof C.AlertChannelName>;
export interface QuiverChannelApi {
  alertChannels(): Promise<{ items: AlertChannel[] }>;
  /** PUT /alerts/channels/:name { target | null } → AlertChannel; 422 validation_failed details.field="target" when invalid. */
  putAlertChannel(name: AlertChannelName, target: string | null): Promise<AlertChannel>;
}

// M5.9 user secrets (own RPC URL for 46630, own OpenRouter key). Write-only: the server returns hints, never values.
export type UserSecretView = z.infer<typeof C.UserSecretView>;
export type UserSecretList = z.infer<typeof C.UserSecretList>;
export type PutRpcSecretReq = z.input<typeof C.PutRpcSecretReq>;
export type PutAiKeySecretReq = z.input<typeof C.PutAiKeySecretReq>;
export type AccountRead = z.infer<typeof C.AccountReadRes>;
/** M5.13: `rpc` comes from the x-quiver-rpc response header (user = your saved RPC, server = Quiver's); null if absent. */
export type ChainAccountRead = { res: AccountRead; rpc: "user" | "server" | null };
export interface QuiverSecretsApi {
  /** GET /chain/testnet/accounts/:address (chain 46630, read-only). 503 venue_unavailable; 422 rpc_url_blocked. */
  chainAccount(address: string): Promise<ChainAccountRead>;
  mySecrets(): Promise<UserSecretList>;
  /** PUT /me/secrets/rpc → view; 503 secrets_unavailable; 422 rpc_url_blocked (private/loopback/non-https). */
  putRpcSecret(b: PutRpcSecretReq): Promise<UserSecretView>;
  /** PUT /me/secrets/ai → view; 503 secrets_unavailable; 422 validation_failed on a malformed key. */
  putAiSecret(b: PutAiKeySecretReq): Promise<UserSecretView>;
  /** DELETE /me/secrets/:id → 204. */
  deleteSecret(id: string): Promise<void>;
}

// ---------- M5.23–M5.25 testnet deposit + test pool (chain 46630 only; server returns UNSIGNED txs) ----------
export type DepositAsset = z.infer<typeof C.DepositAsset>;
export type DepositPrepareReq = z.infer<typeof C.DepositPrepareReq>;
export type DepositPrepareRes = z.infer<typeof C.DepositPrepareRes>;
export type TestPoolStatus = z.infer<typeof C.TestPoolStatusRes>;
export type TestPoolSide = z.infer<typeof C.TestPoolSide>;
export type TestPoolQuote = z.infer<typeof C.TestPoolQuoteRes>;
export type TestPoolSwapPrepareReq = z.input<typeof C.TestPoolSwapPrepareReq>;
export type TestPoolSwapPrepare = z.infer<typeof C.TestPoolSwapPrepareRes>;
export interface QuiverTestnetApi {
  /** POST /testnet/deposit/prepare → one unsigned tx to the caller's smart account. 422/409/503 with details.reason. */
  depositPrepare(b: DepositPrepareReq): Promise<DepositPrepareRes>;
  /** GET /testpool/status (public). 503 when the feature is off on this server. */
  testPoolStatus(): Promise<TestPoolStatus>;
  /** GET /testpool/quote (auth, read-only eth_call). */
  testPoolQuote(side: TestPoolSide, amount: string): Promise<TestPoolQuote>;
  /** POST /testpool/swap/prepare → txs [approve?, swap], sent by the user's wallet in order. */
  testPoolSwapPrepare(b: TestPoolSwapPrepareReq): Promise<TestPoolSwapPrepare>;
}
