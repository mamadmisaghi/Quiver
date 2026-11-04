import { Workflow, canonicalizeWorkflow } from "../../contracts/src/workflow";
import { Risk } from "../../contracts/src/strategy";
import { TF_MS, type Tf } from "../engine/indicators";
import { marketJson } from "../compile/markets";
import type { Registry } from "../venues/registry";
import type { TiingoHistory } from "../venues/tiingo";
import {
  createPaper,
  freshPaperQuote,
  paperEquity,
  paperProblems,
  stepPaper,
  type PaperQuote,
  type PaperState,
} from "./paper";

const DAY = 86_400_000;
const LIMIT = { windowBars: 800, barsPerAsset: 1500, combinedBars: 8000, uniqueFrames: 1200, assets: 16 };
export type HistoryWindow = { from: number; to: number; timeframe: Tf };
export type HistoryDeps = {
  getJson?: (url: string, request?: RequestInit) => Promise<unknown>;
  tiingo?: Pick<TiingoHistory, "bars">;
  registry?: Pick<Registry, "get">;
  ownerId?: string;
  now?: number;
  signal?: AbortSignal;
};
type PlanAsset = Workflow["assets"][number];
type Source =
  | "hyperliquid_trade_close"
  | "polymarket_outcome_history"
  | "tiingo_iex_underlying"
  | "tiingo_adjusted_daily_underlying"
  | "unavailable";
type Point = { at: number; observedAt: number; price: number };
type Series = { source: Source; points: Point[]; issue?: string };
export type HistoricalCoverage = {
  assetId: string;
  instrument: string | null;
  source: Source;
  status: "observed" | "partial" | "unavailable";
  firstAt: number | null;
  lastAt: number | null;
  observations: number;
  warmupBars: number;
  warmupRequestedMs: number;
  warmupShort: boolean;
  largestGapMs: number | null;
  issue: string | null;
};
export type HistoricalResult = {
  steps: number;
  firstAt: number;
  lastAt: number;
  fills: PaperState["events"];
  fillsTotal: number;
  endingEquityUsd: number | null;
  returnPct: number | null;
  realizedUsd: number;
  modeledFeesUsd: number;
  curve: { at: number; equityUsd: number | null }[];
};
export type WorkflowHistory = {
  basis: "historical_reference";
  execution: "simulated_at_observation";
  status: "observed" | "partial" | "unavailable";
  from: number;
  to: number;
  timeframe: Tf;
  issues: string[];
  coverage: HistoricalCoverage[];
  stageCoverage: {
    stageId: string;
    usableFrames: number;
    missingFrames: number;
    firstUsableAt: number | null;
  }[];
  result: HistoricalResult | null;
};

function requiredWarmup(w: Workflow, assetId: string): number {
  let ms = 0;
  for (const s of w.signals.filter((s) => s.assetId === assetId)) {
    if (s.indicator) ms = Math.max(ms, TF_MS[s.indicator.timeframe] * (s.indicator.period + 1));
    const period =
      s.change?.reference === "lookback"
        ? s.change.lookbackMinutes
        : s.drawdown?.reference === "lookback"
          ? s.drawdown.lookbackMinutes
          : null;
    if (period) ms = Math.max(ms, period * 60_000);
  }
  return ms;
}
function selected(a: PlanAsset) {
  return a.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId);
}
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const number = (x: unknown) =>
  typeof x === "number"
    ? x
    : typeof x === "string" && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(x)
      ? Number(x)
      : NaN;
const unavailable = (source: Source, issue: string): Series => ({ source, points: [], issue });

function stringList(input: unknown): string[] {
  const values: unknown = typeof input === "string" ? JSON.parse(input) : input;
  return Array.isArray(values) && values.length <= 100 && values.every((v) => typeof v === "string")
    ? values
    : [];
}

async function loadSeries(
  asset: PlanAsset,
  window: HistoryWindow,
  from: number,
  deps: HistoryDeps,
): Promise<Series> {
  const market = selected(asset);
  if (!market) return unavailable("unavailable", "Choose an exact market before replaying its history.");
  const ms = TF_MS[window.timeframe],
    to = window.to;
  const get = deps.getJson ?? ((url: string, init?: RequestInit) => marketJson(url, init, 0));
  let source: Source = "unavailable";
  let points: Point[] = [];
  try {
    if (market.venue === "hyperliquid" && market.kind === "perp") {
      source = "hyperliquid_trade_close";
      if (
        market.id !== "hl:perp:" + market.symbol ||
        !/^(?:[a-z0-9]{1,16}:)?[A-Za-z0-9@._-]{1,24}$/.test(market.symbol)
      )
        return unavailable(source, "The selected perpetual identity is inconsistent.");
      const rows = await get("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "candleSnapshot",
          req: {
            coin: market.symbol,
            interval: window.timeframe,
            startTime: Math.max(0, from - ms),
            endTime: to,
          },
        }),
      });
      if (!Array.isArray(rows) || rows.length > LIMIT.barsPerAsset + 2)
        return unavailable(source, "Invalid or oversized candle history.");
      for (const row of rows) {
        if (!object(row) || row.s !== market.symbol || row.i !== window.timeframe)
          return unavailable(source, "History did not match the selected perpetual or interval.");
        const open = number(row.t),
          close = number(row.T),
          price = number(row.c);
        if (
          !Number.isSafeInteger(open) ||
          !Number.isSafeInteger(close) ||
          open < 0 ||
          close !== open + ms - 1 ||
          !(price > 0 && Number.isFinite(price))
        )
          return unavailable(source, "The provider returned an invalid candle.");
        // Hyperliquid T is the final millisecond of the bar; the close becomes usable at the next boundary.
        points.push({ observedAt: close, at: close + 1, price });
      }
    } else if (market.venue === "polymarket" && market.kind === "outcome") {
      source = "polymarket_outcome_history";
      const token = market.address;
      const identity = /^pm:outcome:(\d{1,32}):(.+)$/.exec(market.id);
      if (
        !token ||
        !/^\d{1,100}$/.test(token) ||
        !identity ||
        !market.outcome ||
        identity[2] !== market.outcome.toUpperCase()
      )
        return unavailable(source, "Select the exact event outcome token.");
      const meta = await get("https://gamma-api.polymarket.com/markets/" + identity[1]);
      if (!object(meta) || String(meta.id) !== identity[1])
        return unavailable(source, "The selected event could not be verified.");
      const outcomes = stringList(meta.outcomes),
        tokens = stringList(meta.version === "v2" ? meta.positionIds : meta.clobTokenIds);
      const matches = outcomes.flatMap((outcome, i) => (outcome.toUpperCase() === identity[2] ? [i] : []));
      if (matches.length !== 1 || tokens.length !== outcomes.length || tokens[matches[0]] !== token)
        return unavailable(
          source,
          "The selected outcome does not match the token registered for this event.",
        );
      const url = new URL("https://clob.polymarket.com/prices-history");
      url.search = new URLSearchParams({
        market: token,
        startTs: String(Math.floor(from / 1000) - 1),
        endTs: String(Math.ceil(to / 1000) + 1),
        fidelity: String(ms / 60_000),
      }).toString();
      const payload = await get(url.toString());
      if (
        !object(payload) ||
        !Array.isArray(payload.history) ||
        payload.history.length > LIMIT.barsPerAsset + 2
      )
        return unavailable(source, "Invalid or oversized outcome history.");
      for (const row of payload.history) {
        if (!object(row)) return unavailable(source, "The provider returned an invalid outcome observation.");
        const at = number(row.t) * 1000,
          price = number(row.p);
        if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(price) || price < 0 || price > 1)
          return unavailable(source, "The provider returned an invalid outcome observation.");
        // The current paper feed cannot accept an unsettled zero price. Never infer a settlement from a displayed probability.
        if (price === 0 && at >= from && at <= to)
          return unavailable(
            source,
            "This observed zero probability needs explicit zero-odds support; it does not establish settlement.",
          );
        points.push({ at, observedAt: at, price });
      }
    } else if (market.venue === "robinhood") {
      source = window.timeframe === "1d" ? "tiingo_adjusted_daily_underlying" : "tiingo_iex_underlying";
      const instrument = deps.registry?.get(market.id);
      if (
        !instrument ||
        instrument.venue !== "robinhood" ||
        instrument.symbol !== market.symbol ||
        !(instrument.assetClass === "equity" || instrument.assetClass === "etf")
      )
        return unavailable(source, "The selected instrument has no verified equity/ETF symbol mapping.");
      if (!deps.tiingo) return unavailable(source, "Historical underlying equity data is not configured.");
      const bars = await deps.tiingo.bars(instrument.symbol, ms, from - ms, to, deps.ownerId);
      if (!bars) return unavailable(source, "The equity history provider did not supply bars.");
      // TiingoHistory fetches entire dates and may return points outside the requested intraday range.
      if (bars.length > 5000) return unavailable(source, "The equity history exceeded the response bound.");
      for (const bar of bars) {
        if (!Number.isSafeInteger(bar.t) || !(bar.c > 0 && Number.isFinite(bar.c)))
          return unavailable(source, "Invalid equity close.");
        points.push({ at: bar.t, observedAt: bar.t - 1, price: bar.c });
      }
    } else
      return unavailable(
        source,
        "Historical data is unavailable for this selected instrument. A current quote cannot supply its history.",
      );
  } catch {
    if (deps.signal?.aborted) throw Error("Historical replay canceled.");
    return unavailable(source, "The history provider could not return this market and time range.");
  }
  points = points.filter((p) => p.at >= from && p.at <= to).sort((a, b) => a.at - b.at);
  if (points.length > LIMIT.barsPerAsset)
    return unavailable(source, "The market exceeded the observation limit.");
  const unique: Point[] = [];
  for (const p of points) {
    const last = unique.at(-1);
    if (!last || p.at !== last.at) unique.push(p);
    else if (p.price !== last.price)
      return unavailable(source, "The provider returned conflicting values for one timestamp.");
  }
  return { source, points: unique };
}

function coverage(asset: PlanAsset, series: Series, w: HistoryWindow, warmup: number): HistoricalCoverage {
  const ms = TF_MS[w.timeframe],
    old = series.points.filter((p) => p.at < w.from),
    current = series.points.filter((p) => p.at >= w.from);
  const first = current[0]?.at ?? null,
    last = current.at(-1)?.at ?? null;
  let gap: number | null = null;
  if (first !== null && last !== null) {
    gap = Math.max(first - w.from, w.to - last);
    for (let i = 1; i < current.length; i++) gap = Math.max(gap, current[i].at - current[i - 1].at);
  }
  const requiredBars = Math.ceil(warmup / ms);
  const warmupShort = requiredBars > 0 && (old.length < requiredBars || old[0].at > w.from - warmup + ms);
  const status = !current.length
    ? "unavailable"
    : warmupShort || (gap ?? 0) > ms * 1.5
      ? "partial"
      : "observed";
  const issue =
    series.issue ??
    (!current.length
      ? "No observations in the requested period."
      : warmupShort
        ? "The requested warm-up history is incomplete."
        : status === "partial"
          ? "There are intervals without observations, which can include scheduled market closures."
          : null);
  return {
    assetId: asset.id,
    instrument: selected(asset)?.id ?? null,
    source: series.source,
    status,
    firstAt: first,
    lastAt: last,
    observations: current.length,
    warmupBars: old.length,
    warmupRequestedMs: warmup,
    warmupShort,
    largestGapMs: gap,
    issue,
  };
}

/** Bounded, read-only replay. All fills are simulated at observable closes/samples; no fixture or current mark substitutes for history. */
export async function replayWorkflowHistory(
  workflow: Workflow,
  window: HistoryWindow,
  risk: ReturnType<typeof Risk.parse>,
  deps: HistoryDeps = {},
): Promise<WorkflowHistory> {
  const w = canonicalizeWorkflow(Workflow.parse(workflow)),
    limits = Risk.parse(risk),
    ms = Object.hasOwn(TF_MS, window.timeframe) ? TF_MS[window.timeframe] : 0;
  const report: WorkflowHistory = {
    basis: "historical_reference",
    execution: "simulated_at_observation",
    from: window.from,
    to: window.to,
    timeframe: window.timeframe,
    status: "unavailable",
    issues: [],
    coverage: [],
    stageCoverage: [],
    result: null,
  };
  const stop = (issue: string) => {
    report.issues.push(issue);
    return report;
  };
  const now = deps.now ?? Date.now();
  if (
    !ms ||
    !Number.isSafeInteger(window.from) ||
    !Number.isSafeInteger(window.to) ||
    window.from < 0 ||
    window.from >= window.to ||
    window.to > now ||
    now - window.from > 365 * DAY
  )
    return stop("Choose a past range within the previous year and a supported resolution.");
  const incompatibleLookback = w.signals.some((s) => {
    const minutes =
      s.change?.reference === "lookback"
        ? s.change.lookbackMinutes
        : s.drawdown?.reference === "lookback"
          ? s.drawdown.lookbackMinutes
          : null;
    return minutes != null && (minutes * 60_000) % ms !== 0;
  });
  if (incompatibleLookback) return stop("Choose a finer resolution for the requested lookback window.");
  const bins = Math.ceil((window.to - window.from) / ms) + 1;
  if (bins > LIMIT.windowBars || w.assets.length > LIMIT.assets)
    return stop("Choose a shorter range or a coarser resolution (up to 800 bars per market).");
  const problem = paperProblems(w, true)[0];
  if (problem) return stop(problem);
  if (
    w.stages.some((stage) => selected(w.assets.find((a) => a.id === stage.assetId)!)?.venue === "polymarket")
  )
    return stop("Polymarket outcomes are signals; paper entries must select a supported execution market.");
  if (
    w.signals.some((s) => s.kind === "funding") ||
    w.stages.some((s) => s.after.some((dep) => dep.event === "resolved_profit"))
  )
    return stop(
      "This workflow requires historical funding or an official resolution event. Price history alone cannot establish it.",
    );
  if (
    w.signals.some(
      (s) => (s.indicator && TF_MS[s.indicator.timeframe] < ms) || (s.kind === "timer" && ms > 60_000),
    ) ||
    w.stages.some((s) => s.repeat?.intervalMinutes && s.repeat.intervalMinutes * 60_000 < ms)
  )
    return stop(
      "Choose a resolution at least as fine as the strategy’s indicators, schedule and repeat interval.",
    );
  const warmup = w.assets.map((a) => requiredWarmup(w, a.id));
  const counts = warmup.map((n) => bins + Math.ceil(n / ms));
  if (
    counts.some((n) => n > LIMIT.barsPerAsset - 2) ||
    counts.reduce((a, b) => a + b, 0) > LIMIT.combinedBars
  )
    return stop("The requested history and indicator warm-up exceed the bounded replay size.");
  const streams: Series[] = [];
  for (let i = 0; i < w.assets.length; i += 4) {
    if (deps.signal?.aborted) throw Error("Historical replay canceled.");
    streams.push(
      ...(await Promise.all(
        w.assets
          .slice(i, i + 4)
          .map((a, j) => loadSeries(a, window, Math.max(0, window.from - warmup[i + j]), deps)),
      )),
    );
  }
  report.coverage = w.assets.map((a, i) => coverage(a, streams[i], window, warmup[i]));
  if (streams.reduce((count, stream) => count + stream.points.length, 0) > LIMIT.combinedBars)
    return stop("The providers returned more observations than the combined replay limit.");
  if (report.coverage.some((c) => c.status === "unavailable"))
    return stop(
      "Every selected market needs observations in this period. Inspect coverage or narrow the range.",
    );
  let state = createPaper(w, window.from);
  const frames = new Map<number, PaperQuote[]>();
  for (const [index, series] of streams.entries()) {
    const asset = w.assets[index],
      preceding: [number, number][] = [];
    for (const p of series.points) {
      if (p.at < window.from) {
        preceding.push([p.observedAt, p.price]);
        continue;
      }
      const values = frames.get(p.at) ?? [];
      values.push({
        assetId: asset.id,
        price: p.price,
        observedAt: p.observedAt,
        source: series.source,
        synthetic: false,
      });
      frames.set(p.at, values);
    }
    // Only indicators and lookback rules see prior samples. New positions, cash, start-relative anchors and repeat counters begin inside the test window.
    state.history[asset.id] = preceding;
  }
  if (frames.size > LIMIT.uniqueFrames)
    return stop(
      "This range contains too many distinct event times; shorten it or select a coarser resolution.",
    );
  const times = [...frames.keys()].sort((a, b) => a - b);
  const fills: PaperState["events"] = [],
    curve: HistoricalResult["curve"] = [];
  let fillsTotal = 0;
  const markedEquity = (at: number) =>
    Object.values(state.positions).some((p) => !freshPaperQuote(state.quotes[p.assetId], at))
      ? null
      : paperEquity(state);
  report.stageCoverage = w.stages.map((stage) => ({
    stageId: stage.id,
    usableFrames: 0,
    missingFrames: 0,
    firstUsableAt: null,
  }));
  for (const [index, at] of times.entries()) {
    if (index && index % 48 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (deps.signal?.aborted) throw Error("Historical replay canceled.");
    state = stepPaper(w, state, frames.get(at)!, at, limits);
    for (const [i, stage] of w.stages.entries()) {
      const row = report.stageCoverage[i],
        check = state.checks?.[stage.id];
      if (
        freshPaperQuote(state.quotes[stage.assetId], at) &&
        (!stage.when || (check && check.unknown === 0))
      ) {
        row.usableFrames++;
        row.firstUsableAt ??= at;
      } else row.missingFrames++;
    }
    const added = state.events.filter((e) => e.at === at);
    fillsTotal += added.length;
    fills.push(...added);
    if (fills.length > 300) fills.splice(0, fills.length - 300);
    curve.push({ at, equityUsd: markedEquity(at) });
  }
  if (report.stageCoverage.some((stage) => !stage.usableFrames))
    return stop(
      "At least one order never had a usable observation of its market and conditions together. Inspect market and stage coverage.",
    );
  const equity = markedEquity(window.to);
  report.status =
    report.coverage.some((c) => c.status === "partial") ||
    report.stageCoverage.some((s) => s.missingFrames > 0) ||
    curve.some((p) => p.equityUsd === null) ||
    equity === null
      ? "partial"
      : "observed";
  report.result = {
    steps: times.length,
    firstAt: times[0],
    lastAt: times.at(-1)!,
    fills,
    fillsTotal,
    endingEquityUsd: equity,
    returnPct: equity === null ? null : ((equity - state.budget) / state.budget) * 100,
    realizedUsd: state.realized,
    modeledFeesUsd: state.fees,
    curve,
  };
  report.issues = [
    "Only completed candle closes and dated probability observations are evaluated. Intrabar trigger order, executable spread and order-book depth are unknown.",
    "Fills use the paper engine’s 0.1% fee. Perpetual funding, gas and order-book slippage are excluded.",
  ];
  if (report.coverage.some((c) => c.source === "hyperliquid_trade_close"))
    report.issues.push(
      "Hyperliquid provides historical trade candle closes here; they are a reference proxy for the mark price used by the live paper feed.",
    );
  if (report.coverage.some((c) => c.source.startsWith("tiingo_")))
    report.issues.push(
      "Tiingo observations track the underlying stock or ETF. Token execution prices may differ.",
    );
  if (report.status === "partial")
    report.issues.push(
      "This replay has partial coverage and describes the observations available. Missing prices are never forward-dated or replaced with synthetic prices.",
    );
  return report;
}
