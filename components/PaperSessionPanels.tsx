import { useLayoutEffect, useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, Check, Clock3, GitBranch, Radio, RotateCw } from "lucide-react";
import { conditionText } from "@/services/backend/src/engine/workflow-view";
import { freshPaperQuote } from "@/services/backend/src/workflows/paper";
import { positionsFor } from "@/lib/paper/account";
import { sessionActivity, type PaperSession } from "@/lib/paper/sessions";
import { assetSymbol, dependencyDetail, marketPrice, stageLabel, type MarketObservation } from "@/lib/paper/observations";
import VenueMark from "./VenueMark";

const time = (n: number) => new Date(n).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const number = (n: number) => n.toLocaleString("en-US", { maximumSignificantDigits: 7 });
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function RunSignals({ session, items }: { session: PaperSession; items: MarketObservation[] }) {
  const w = session.strategy.workflow!, state = session.state;
  const rows = [
    ...w.signals.map(signal => ({ signal, id: signal.id, assetId: signal.assetId, title: signal.description || signal.kind })),
    ...w.assets.filter(asset => !w.signals.some(s => s.assetId === asset.id && (s.kind === "price" || s.kind === "odds"))).map(asset => ({ signal: null, id: "asset-" + asset.id, assetId: asset.id, title: assetSymbol(w, asset.id) + " price" })),
  ];
  return <section className="q-monitor-panel" aria-labelledby="run-signals-title">
    <div className="q-monitor-heading"><h2 id="run-signals-title">Signals</h2><span>{rows.length} watched</span></div>
    <table className="q-signal-table"><thead><tr><th>Signal</th><th>Value</th><th>Source</th></tr></thead><tbody>
      {rows.map(({ signal, id, assetId, title }) => {
        const asset = w.assets.find(a => a.id === assetId);
        const selected = asset?.resolution?.candidates.find(c => c.id === asset.resolution?.selectedId);
        const received = items.find(i => i.assetId === assetId), saved = assetId ? state?.quotes[assetId] : undefined;
        const raw = received?.quote, latest = raw && (!saved || raw.observedAt >= saved.observedAt) ? raw : saved;
        const direct = !signal || signal.kind === "price" || signal.kind === "odds";
        const quote = direct ? latest : saved;
        const checked = state && state.lastAt >= state.startedAt ? state.lastAt : null;
        const at = assetId ? quote?.observedAt : checked;
        const venue = selected?.venue ?? asset?.venue;
        const provider = quote?.source.split(" · ")[0];
        const sourceName = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : signal?.kind === "timer" ? "Session clock" : "Awaiting feed";
        const stale = !!quote && !freshPaperQuote(quote, session.mode === "scenario" ? state!.lastAt : Date.now());
        const unavailable = !!received && !received.quote;
        const value = direct ? quote?.price : (state?.readings ?? state?.previous)?.[id + ".value"];
        let display = "Awaiting data";
        if (typeof value === "boolean") display = value ? "Active" : "Waiting";
        else if (typeof value === "number") {
          if (signal?.kind === "funding" || signal?.kind === "odds") display = number(value * 100) + "%";
          else if (signal?.kind === "drawdown" || signal?.kind === "price_change" || signal?.indicator?.name === "pct_change") display = number(value) + "%";
          else if (direct || (signal?.kind === "indicator" && signal.indicator?.name !== "rsi")) display = marketPrice(value);
          else display = number(value);
        }
        return <tr key={id}>
          <td><div className="q-signal-name">{venue && <VenueMark venue={venue} size={18} />}<span>{title}</span></div></td>
          <td className="q-signal-value"><span key={display} data-signal-value>{display}</span>{(unavailable || stale) && <small>{unavailable ? "Feed unavailable" : "Stale quote"}</small>}</td>
          <td title={[quote?.source, received?.message].filter(Boolean).join(" · ")}><span>{sourceName}</span>{at != null && <small>{time(at)}</small>}</td>
        </tr>;
      })}
    </tbody></table>
  </section>;
}

const eventIcon = { session: Clock3, quote: Radio, check: Activity, condition: Check, trigger: GitBranch, fill: ArrowDownLeft, wait: Clock3, issue: Activity, edit: RotateCw };
const rowHeight = 72;
export function RunActivity({ session, running }: { session: PaperSession; running: boolean }) {
  const rows = sessionActivity(session).slice().reverse();
  const latest = rows[0]?.seq ?? 0, initial = useRef(latest), previous = useRef(latest);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current, added = latest - previous.current;
    if (el && added > 0 && el.scrollTop > rowHeight / 2) el.scrollTop += added * rowHeight;
    previous.current = latest;
  }, [latest]);
  return <section className="q-monitor-panel q-activity-panel" aria-labelledby="run-activity-title">
    <div className="q-monitor-heading"><h2 id="run-activity-title">Activity</h2><span className="q-feed-state" data-live={running || undefined}><i />{running ? "Live" : session.mode === "scenario" ? "Archived" : "Paused"}</span></div>
    <div ref={scroller} className="q-event-scroll" tabIndex={0} role="region" aria-label="Event log">
      <ol style={{ height: rows.length * rowHeight }} className="q-event-list">
        {rows.map((row, i) => { const Icon = eventIcon[row.kind]; return <li className="q-event-position" key={row.seq} style={{ height: rowHeight, transform: "translateY(" + i * rowHeight + "px)" }}>
          <div className="q-event-row" data-kind={row.kind} data-new={row.seq > initial.current || undefined}>
            <Icon className="q-event-icon" size={14} aria-hidden="true" />
            <div className="q-event-body"><strong>{row.label}</strong><p title={row.detail}>{row.detail}</p></div>
            <time dateTime={new Date(row.at).toISOString()}>{time(row.at)}</time>
          </div></li>; })}
      </ol>
    </div>
    <span className="sr-only" role="status">{rows[0] ? rows[0].label + ". " + rows[0].detail : ""}</span>
  </section>;
}

export function RunTriggers({ session }: { session: PaperSession }) {
  const w = session.strategy.workflow!, state = session.state;
  const checked = !!state && state.lastAt >= state.startedAt && state.lastAt >= (session.rulesChangedAt ?? 0);
  return <section className="q-monitor-panel q-monitor-section" aria-labelledby="run-triggers-title">
    <div className="q-monitor-heading"><h2 id="run-triggers-title">Triggers</h2><span>What each order is waiting for</span></div>
    <ol className="q-trigger-list">{w.stages.map((stage, i) => {
      const st = state?.stages[stage.id], deps = dependencyDetail(w, stage, state);
      const paused = session.pausedRules?.includes(stage.id);
      const complete = !!st?.fills && (!stage.repeat || stage.repeat.maxTimes != null && st.fills >= stage.repeat.maxTimes);
      const waiting = deps.filter(d => !d.met).map(d => d.text);
      const reason = waiting.length && st?.status.startsWith("Waiting for predecessor") ? "Waiting for " + waiting.map(d => d.replace(" · ", " ")).join(", ") : st?.status;
      const status = paused ? "Rule paused" : complete ? "Complete" : checked ? reason || "Watching" : "Awaiting next check";
      const summary = stage.when ? conditionText(w, stage.when) : deps.length ? "After the required steps below." : "On the first eligible quote.";
      return <li key={stage.id}><span className="q-trigger-index">{String(i + 1).padStart(2, "0")}</span>
        <div className="q-trigger-copy"><h3>{stageLabel(w, stage.id)}</h3><p>{summary}</p>{!!deps.length && <ul className="q-dependencies">{deps.map((d, idx) => <li key={idx} data-met={d.met || complete || undefined}>{d.met || complete ? <Check size={12} /> : <Clock3 size={12} />}{d.text} · {complete ? "met at fill" : d.met ? "met" : "waiting"}</li>)}</ul>}</div>
        <div className="q-trigger-state"><strong data-complete={complete || undefined}>{status}</strong><small>{st?.fills ?? 0} {st?.fills === 1 ? "fill" : "fills"}{stage.repeat?.intervalMinutes ? " · every " + stage.repeat.intervalMinutes + " min" : !stage.repeat ? " · once" : ""}</small></div>
      </li>; })}</ol>
  </section>;
}

export function RunPositions({ session }: { session: PaperSession }) {
  const w = session.strategy.workflow!, positions = positionsFor(session, w);
  const fills = session.state?.events ?? [];
  const [view, setView] = useState<"positions" | "fills">("positions");
  const headers = view === "positions" ? ["Market", "Side", "Quantity", "Avg entry", "Mark", "Unrealized P&L"] : ["Time", "Order", "Fill", "Amount", "Price", "Fee"];
  return <section className="q-monitor-panel q-monitor-section" aria-labelledby="run-positions-title">
    <div className="q-monitor-heading"><h2 id="run-positions-title">Positions &amp; fills</h2><div className="q-run-switch" role="group" aria-label="Position history">
      <button type="button" aria-pressed={view === "positions"} onClick={() => setView("positions")}>Positions <span>{positions.length}</span></button>
      <button type="button" aria-pressed={view === "fills"} onClick={() => setView("fills")}>Fills <span>{fills.length}</span></button></div></div>
    {(view === "positions" ? positions.length : fills.length) ? <div className="q-position-scroll" role="region" aria-label={view === "positions" ? "Open positions" : "Paper fills"} tabIndex={0}><table className="q-position-table"><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
      {view === "positions" ? positions.map(p => <tr key={p.id}><td className="q-ink">{p.symbol}</td><td>{p.side === "long" ? "Long" : "Short"}</td><td>{number(p.qty)}</td><td>{marketPrice(p.entry)}</td><td title={p.markedAt ? new Date(p.markedAt).toLocaleString() : undefined}>{p.mark == null ? "—" : marketPrice(p.mark)}</td><td className={p.unrealized == null ? "" : p.unrealized < 0 ? "text-short" : "text-paper"}>{p.unrealized == null ? "—" : money(p.unrealized)}</td></tr>)
      : fills.slice().reverse().map((f, i) => <tr key={fills.length - i}><td>{time(f.at)}</td><td className="q-ink">{stageLabel(w, f.stageId)}</td><td title={f.detail}>{f.kind === "buy" ? "Entry" : f.kind === "settle" ? "Settlement" : "Exit"}</td><td>{money(f.amount)}</td><td>{marketPrice(f.price)}</td><td>{marketPrice(f.fee)}</td></tr>)}
    </tbody></table></div> : <div className="q-monitor-empty"><ArrowUpRight size={18} /><div><strong>{view === "positions" ? "No open positions" : "Waiting for the first fill"}</strong><p>{view === "positions" ? "Positions appear here when a paper entry fills." : "Executed paper orders show their price, size and fee here."}</p></div></div>}
  </section>;
}
