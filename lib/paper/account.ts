import type { PaperSession } from "@/lib/paper/sessions";
import { freeCash, paperEquity } from "@/services/backend/src/workflows/paper";

type Workflow = NonNullable<PaperSession["strategy"]["workflow"]>;
type Venue = NonNullable<Workflow["assets"][number]["venue"]>;
type State = NonNullable<PaperSession["state"]>;
type Fill = State["events"][number];

export type PaperAmounts = {
  budget: number; cash: number; equity: number | null; realized: number; unrealized: number | null;
  pnl: number | null; returnPct: number | null; fees: number; fills: number; openPositions: number;
};
export type PaperAccountRow = PaperAmounts & {
  id: string; strategyId: string; strategyName: string; href: string; status: PaperSession["status"];
  createdAt: number; updatedAt: number; session: PaperSession;
};
export type PaperAccountPosition = {
  id: string; sessionId: string; strategyName: string; stageId: string; assetId: string; instrument: string | null;
  symbol: string; assetClass: "Perpetual" | "Spot" | "Token" | "Outcome" | null; venue: Venue | null;
  qty: number; side: "long" | "short"; entry: number; mark: number | null; markedAt: number | null;
  openedAt: number; notional: number | null; unrealized: number | null;
};
export type PaperHistoryPoint = { ts: string; equityUsd: number; pnlUsd: number };
export type PaperActivity = {
  id: string; sessionId: string; strategyId: string; strategyName: string; href: string; at: number;
  kind: "session_created" | Fill["kind"]; action: "session_created" | "long" | "short" | Fill["kind"];
  stageId: string | null; symbol: string | null; amount: number | null; price: number | null; fee: number | null; detail: string | null;
};
export type PaperAccount = {
  sessions: PaperAccountRow[]; totals: PaperAmounts; positions: PaperAccountPosition[];
  history: PaperHistoryPoint[]; activity: PaperActivity[]; asOf: number | null;
};

const kinds = { perp: "Perpetual", spot: "Spot", token: "Token", outcome: "Outcome" } as const;
const curveCapacity = 1000; // stepPaper retains at most this many observations per session.
const zeroAmounts = (): PaperAmounts => ({ budget: 0, cash: 0, equity: 0, realized: 0, unrealized: 0, pnl: 0, returnPct: null, fees: 0, fills: 0, openPositions: 0 });
const sumKnown = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;
const percent = (pnl: number | null, budget: number) => pnl === null || budget === 0 ? null : pnl * 100 / budget;

export function isQuoteSession(session: PaperSession) {
  return session.mode === "quotes" && !!session.strategy.workflow && !session.legacyResult
    && !Object.values(session.state?.quotes ?? {}).some(quote => quote.synthetic);
}

function market(workflow: Workflow, assetId: string) {
  const asset = workflow.assets.find(a => a.id === assetId);
  const selected = asset?.resolution?.candidates.find(c => c.id === asset.resolution?.selectedId);
  const kind = selected?.kind ?? asset?.kind;
  // The snapshot records an instrument kind, not the underlying asset class of every perpetual or token.
  return { instrument: selected?.id ?? null, symbol: selected?.symbol ?? asset?.query ?? assetId,
    venue: selected?.venue ?? asset?.venue ?? null, assetClass: kind ? kinds[kind] : null };
}

export function positionsFor(session: PaperSession, workflow: Workflow): PaperAccountPosition[] {
  const state = session.state;
  if (!state) return [];
  return Object.entries(state.positions).filter(([, p]) => p.qty > 0).map(([stageId, p]) => {
    const quote = state.quotes[p.assetId];
    const observed = quote?.assetId === p.assetId && !quote.synthetic && (quote.price > 0 || quote.settled);
    const mark = observed ? quote.price : null;
    // Entry fees still attached to open lots have already left cash. Closed-lot fees are in state.realized.
    const unrealized = mark === null ? null : Math.max(-p.margin, p.qty * (mark - p.entry) * p.side) - p.entryFee;
    return { id: `${session.id}:${stageId}`, sessionId: session.id, strategyName: session.name, stageId, assetId: p.assetId,
      ...market(workflow, p.assetId), qty: p.qty, side: p.side === 1 ? "long" : "short", entry: p.entry,
      openedAt: p.openedAt, mark, markedAt: observed ? quote.observedAt : null, notional: mark === null ? null : p.qty * mark, unrealized };
  });
}

function activityFor(session: PaperSession, workflow: Workflow): PaperActivity[] {
  const common = { sessionId: session.id, strategyId: session.strategyId, strategyName: session.name, href: `/app/run/${session.id}` };
  const items: PaperActivity[] = [{ ...common, id: `${session.id}:created`, at: session.createdAt, kind: "session_created", action: "session_created",
    stageId: null, symbol: null, amount: null, price: null, fee: null, detail: null }];
  const occurrences = new Map<string, number>();
  for (const event of session.state?.events ?? []) {
    const stage = workflow.stages.find(s => s.id === event.stageId);
    // V1 events have no independent database ID. Repeated ladder exits at the same tick are distinct records.
    const base = `${session.id}:${event.at}:${event.stageId}:${event.kind}`;
    const ordinal = occurrences.get(base) ?? 0;
    occurrences.set(base, ordinal + 1);
    items.push({ ...common, ...event, id: `${base}:${ordinal}`,
      action: event.kind === "buy" && stage ? stage.side : event.kind,
      symbol: stage ? market(workflow, stage.assetId).symbol : null });
  }
  return items;
}

function combinedHistory(rows: PaperAccountRow[], positions: PaperAccountPosition[]): PaperHistoryPoint[] {
  const changes = new Map<number, { equity: number; budget: number }>();
  const add = (at: number, equity: number, budget: number) => {
    const change = changes.get(at) ?? { equity: 0, budget: 0 };
    change.equity += equity; change.budget += budget; changes.set(at, change);
  };
  let firstObservation = Infinity, retainedFrom = -Infinity, unknownFrom = Infinity;
  for (const position of positions) if (position.mark === null) unknownFrom = Math.min(unknownFrom, position.openedAt);
  for (const row of rows) {
    const state = row.session.state, curve = state?.curve ?? [];
    // A session creation is a recorded cash allocation. It cannot create chart history by itself.
    add(row.createdAt, row.budget, row.budget);
    if (!curve.length) continue;
    firstObservation = Math.min(firstObservation, curve[0][0]);
    if (curve.length >= curveCapacity && curve[0][0] > state!.startedAt) retainedFrom = Math.max(retainedFrom, curve[0][0]);
    let previous = row.budget;
    for (const [at, value] of curve) { add(at, value - previous, 0); previous = value; }
  }
  let equity = 0, budget = 0;
  const points: PaperHistoryPoint[] = [];
  for (const [at, change] of [...changes].sort(([a], [b]) => a - b)) {
    equity += change.equity; budget += change.budget;
    if (at >= firstObservation && at >= retainedFrom && at < unknownFrom) points.push({ ts: new Date(at).toISOString(), equityUsd: equity, pnlUsd: equity - budget });
  }
  return points;
}

/** Pure projection of validated browser checkpoints. Supply `now` for the same 60-second status freshness as the session list. */
export function paperAccount(input: readonly PaperSession[], now?: number): PaperAccount {
  const newest = new Map<string, PaperSession>();
  for (const session of input) if (!newest.has(session.id) || newest.get(session.id)!.updatedAt < session.updatedAt) newest.set(session.id, session);
  const sessions: PaperAccountRow[] = [], positions: PaperAccountPosition[] = [], activity: PaperActivity[] = [];
  const totals = zeroAmounts();
  let asOf: number | null = null;
  for (const session of newest.values()) {
    if (!isQuoteSession(session)) continue;
    const workflow = session.strategy.workflow!, state = session.state;
    const budget = state?.budget ?? workflow.budgetUsd;
    if (budget == null || budget <= 0) continue;
    const lots = positionsFor(session, workflow);
    const unrealized = lots.reduce<number | null>((sum, lot) => sumKnown(sum, lot.unrealized), 0);
    const equity = unrealized === null ? null : state ? paperEquity(state) : budget;
    const cash = state ? freeCash(state) : budget, realized = state?.realized ?? 0;
    const pnl = equity === null ? null : equity - budget;
    const row: PaperAccountRow = { id: session.id, strategyId: session.strategyId, strategyName: session.name,
      href: `/app/run/${session.id}`, session, createdAt: session.createdAt, updatedAt: session.updatedAt,
      status: now !== undefined && session.status === "running" && now - session.updatedAt > 60_000 ? "paused" : session.status,
      budget, cash, equity, pnl, realized, unrealized, returnPct: percent(pnl, budget),
      fees: state?.fees ?? 0, fills: state?.events.length ?? 0, openPositions: lots.length };
    sessions.push(row); positions.push(...lots); activity.push(...activityFor(session, workflow));
    totals.budget += budget; totals.cash += cash; totals.equity = sumKnown(totals.equity, equity);
    totals.realized += realized; totals.unrealized = sumKnown(totals.unrealized, row.unrealized); totals.pnl = sumKnown(totals.pnl, pnl);
    totals.fees += row.fees; totals.fills += row.fills; totals.openPositions += lots.length;
    asOf = asOf === null ? session.updatedAt : Math.max(asOf, session.updatedAt);
  }
  totals.returnPct = percent(totals.pnl, totals.budget);
  sessions.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  positions.sort((a, b) => b.openedAt - a.openedAt || a.id.localeCompare(b.id));
  // Reversing before the stable sort leaves later recorded events ahead of earlier ones within a single tick.
  activity.reverse().sort((a, b) => b.at - a.at || a.sessionId.localeCompare(b.sessionId));
  return { sessions, totals, positions, history: combinedHistory(sessions, positions), activity, asOf };
}

export function paperAllocation(positions: readonly PaperAccountPosition[], by: "venue" | "assetClass" | "instrument") {
  type Group = { key: string; label: string; count: number; unmarked: number; gross: number | null; net: number | null; weightPct: number | null };
  const groups = new Map<string, Group>();
  let gross: number | null = 0, net: number | null = 0;
  for (const p of positions) {
    const key = by === "instrument" ? p.instrument ?? `${p.sessionId}:${p.assetId}` : p[by] ?? "Unspecified";
    const item = groups.get(key) ?? { key, label: by === "instrument" ? p.symbol : key, count: 0, unmarked: 0, gross: 0, net: 0, weightPct: null };
    const signed = p.notional === null ? null : p.notional * (p.side === "long" ? 1 : -1);
    item.count++; if (p.notional === null) item.unmarked++;
    item.gross = sumKnown(item.gross, p.notional); item.net = sumKnown(item.net, signed);
    gross = sumKnown(gross, p.notional); net = sumKnown(net, signed); groups.set(key, item);
  }
  const items = [...groups.values()];
  for (const item of items) item.weightPct = gross === null ? null : percent(item.gross, gross);
  items.sort((a, b) => (b.gross ?? -1) - (a.gross ?? -1) || a.label.localeCompare(b.label));
  return { items, gross, net };
}
