import type { Expr, Strategy } from "../../contracts/src/strategy";
import type { Registry } from "../venues/registry";

/**
 * Deterministic "Demo compile" (no AI). Used when OPENROUTER_API_KEY is unset, or as the fallback when the AI
 * call fails, times out or returns invalid rules. Pure rules + keywords, runs in well under a millisecond.
 *
 * Understands, for NVDA, AAPL, TSLA, SPY, ETH, BTC, SOL, WETH, JUP (tickers or names like "nvidia", "bitcoin"):
 *  - price above/below $X            ("buy NVDA if it drops below $120")
 *  - % move                          ("buy BTC when it falls 5% in a day")
 *  - crossover                       ("ETH crosses above its 20-day EMA", "golden cross on AAPL")
 *  - above/below an N-day average    ("NVDA under its 50-day average")
 *  - RSI oversold/overbought         ("buy TSLA when RSI is below 30")
 *  - time-based / DCA                ("buy $100 of BTC every Monday at 9am")
 *  - exits: take profit / stop loss / trailing stop / "exit after N days"
 *  - size: $X or N% of portfolio; perps: "short", "3x"; Fed-cut odds; funding
 * Anything else returns `unsupported` with example prompts (never a silent fallback).
 */
export type DemoResult = { ok: true; strategy: Strategy; warnings: string[] } | { ok: false; message: string; suggestions: string[] };

export const DEMO_SUGGESTIONS = [
  "Buy $250 of NVDA if it drops below $120, stop loss 8%, take profit 15%",
  "Buy BTC when it falls 5% in a day, take profit 10%",
  "Buy $100 of ETH every Monday at 9am",
  "Buy AAPL when it crosses above its 50-day average",
  "Buy TSLA when RSI is below 30, trailing stop 7%",
  "If Fed cut odds go over 70% and NVDA is under its 50-day average, buy $200 of NVDA",
];

const ALIASES: Record<string, string> = {
  nvidia: "NVDA", apple: "AAPL", tesla: "TSLA", "s&p": "SPY", "s&p500": "SPY", sp500: "SPY",
  bitcoin: "BTC", btc: "BTC", xbt: "BTC", ether: "ETH", ethereum: "ETH", solana: "SOL", jupiter: "JUP",
};
const DOW: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const num = (s: string) => Number(s.replace(/,/g, ""));
const clampP = (n: number) => Math.min(500, Math.max(2, Math.round(n)));

type Leg = { sym: string; meta: NonNullable<ReturnType<Registry["bySymbol"]>>; short: boolean; lev: number | null; size: { unit: "usd" | "pct_equity"; value: string } | null };
const ACT = /\b(buy|long|short|open|purchase|accumulate|ape|invest|enter|grab|get)\b/;
function symbolsIn(src: string, reg: Registry, ctx: string) {
  const out: string[] = [];
  for (const m of src.matchAll(/\$?([a-z][a-z0-9&]{1,9})\b/g)) {
    let sym = ALIASES[m[1]] ?? m[1].toUpperCase();
    if (sym === "ETH" && /\b(weth|spot|token|robinhood)\b/.test(ctx)) sym = "WETH";
    const meta = reg.bySymbol(sym);
    if (meta && meta.venue !== "polymarket" && !out.includes(sym)) out.push(sym);
  }
  return out;
}
/**
 * M3.2 multi-clause: split the action part of a prompt into clauses ("…, buy $200 of NVDA on Robinhood Chain and
 * open a 2× SOL long with $250 on Hyperliquid") and return one leg per clause that has an action verb and exactly
 * one market. Deterministic; returns [] unless there are ≥2 legs on distinct markets.
 */
function parseLegs(src: string, reg: Registry): Leg[] {
  const legs: Leg[] = [];
  for (const c of src.split(/[.;]|,\s*|\s(?:and\s+(?:then\s+)?|then\s+)(?=(?:buy|open|long|short|go long|go short|purchase)\b)/)) {
    if (!ACT.test(c) || /\b(if|when|once|whenever)\b/.test(c)) continue;
    const syms = symbolsIn(c, reg, c); if (syms.length !== 1 || legs.some((l) => l.sym === syms[0])) continue;
    const meta = reg.bySymbol(syms[0])!;
    const usd = c.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/); const pct = c.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(?:my\s+)?(?:portfolio|equity|account|balance)/);
    const lev = c.match(/(\d+(?:\.\d+)?)\s*[x×](?=\s|$)/);
    legs.push({ sym: syms[0], meta, short: /\bshort\b/.test(c), lev: lev ? Number(lev[1]) : null,
      size: pct ? { unit: "pct_equity", value: String(Math.min(100, Number(pct[1]))) } : usd ? { unit: "usd", value: String(num(usd[1]) * (usd[2] ? 1000 : 1)) } : null });
  }
  return legs.length >= 2 ? legs : [];
}

export function demoCompile(thesis: string, reg: Registry): DemoResult {
  const text = thesis.replace(/[−–—]/g, "-").replace(/\s+/g, " ").trim();
  let lower = text.toLowerCase();
  const warnings: string[] = [];
  const unsupported = (message: string): DemoResult => ({ ok: false, message, suggestions: DEMO_SUGGESTIONS });
  if (lower.length < 3) return unsupported("Describe a market, a condition and an amount.");

  // ---- symbols (ticker in any case, or a name alias), in order of appearance ----
  const found: { sym: string; at: number }[] = [];
  for (const m of lower.matchAll(/\$?([a-z][a-z0-9&]{1,9})\b/g)) {
    const w = m[1]; let sym = ALIASES[w] ?? w.toUpperCase();
    if (sym === "ETH" && /\b(weth|spot|token|robinhood)\b/.test(lower)) sym = "WETH";
    const meta = reg.bySymbol(sym);
    if (meta && meta.venue !== "polymarket" && !found.some((f) => f.sym === sym)) found.push({ sym, at: m.index! });
  }
  const fed = /odds|polymarket|fed[- ]?cut|rate cut/.test(lower);
  if (!found.length) return unsupported(fed ? "Which market should it trade? Add a ticker like NVDA or BTC." : "Couldn't find a market in that idea. Try a ticker like NVDA, AAPL, TSLA, ETH or BTC.");
  const sym = found[0].sym; const meta = reg.bySymbol(sym)!; const id = sym.toLowerCase(); const isPerp = meta.kind === "perp";
  const legsSrc = text.toLowerCase().replace(/(?:stop(?:[- ]?loss)?|take[- ]?profit|trailing(?:[- ]stop)?)[^.;,]*/g, " ");
  const legs = found.length > 1 ? parseLegs(legsSrc, reg) : [];
  if (found.length > 1 && !legs.length) warnings.push(`Demo compile uses one market per strategy; using ${sym}.`);
  const equity = meta.venue === "robinhood" && meta.assetClass !== "crypto";

  const signals: Strategy["signals"] = []; const conds: Expr[] = [];
  const pxId = `${id}_px`; const px = { ref: `${pxId}.value` };
  signals.push({ id: pxId, kind: "price", maxAgeSeconds: 120, params: { instrument: meta.id, source: equity ? "chainlink_stream" : "venue_mid" } });
  const ind = (name: "sma" | "ema" | "rsi" | "pct_change", period: number, tf: "1m" | "1h" | "1d") => {
    const sid = `${id}_${name}${period}_${tf}`;
    if (!signals.some((s) => s.id === sid)) signals.push({ id: sid, kind: "indicator", maxAgeSeconds: tf === "1d" ? 900 : 300, params: { instrument: meta.id, name, period, timeframe: tf } });
    return { ref: `${sid}.value` };
  };

  // ---- exits (parsed first, then removed so their % don't look like a price move) ----
  const exits: NonNullable<Strategy["actions"][number]["exits"]> = {};
  const take = (re: RegExp) => { const m = lower.match(re); if (m) lower = lower.replace(m[0], " "); return m; };
  const trail = take(/trailing(?:[- ]stop)?\s*(?:loss)?\s*(?:at|of)?\s*-?\s*(\d+(?:\.\d+)?)\s*%/);
  const sl = take(/(?:stop(?:[- ]?loss)?|sl)\s*(?:at|of)?\s*-?\s*(\d+(?:\.\d+)?)\s*%/);
  const tp = take(/(?:take[- ]?profit|tp|target|profit target)\s*(?:at|of)?\s*\+?\s*(\d+(?:\.\d+)?)\s*%/) ?? take(/sell (?:at|when (?:i'?m |it'?s )?up) \+?(\d+(?:\.\d+)?)\s*%/);
  const tx = take(/(?:exit|close|sell)\s+(?:it\s+)?after\s+(\d+)\s*(hour|hr|h|day|d|week)s?\b/) ?? take(/hold (?:it )?for\s+(\d+)\s*(hour|hr|h|day|d|week)s?\b/);
  if (trail) exits.trailingStopPct = trail[1];
  if (sl) exits.stopLoss = { unit: "pct", value: sl[1] };
  if (tp) exits.takeProfit = { unit: "pct", value: tp[1] };
  if (tx) exits.timeExitHours = Math.min(8760, Math.max(1, Number(tx[1]) * (/^h/.test(tx[2]) ? 1 : tx[2] === "week" ? 168 : 24)));

  // ---- size ----
  let size: { unit: "usd" | "pct_equity"; value: string } = { unit: "usd", value: "250" };
  const pctEq = take(/(\d+(?:\.\d+)?)\s*%\s*of\s*(?:my\s+)?(?:portfolio|equity|account|balance)/);
  const usd = lower.match(/(?:buy|long|short|invest|spend|put|dca|ape|open)\s+(?:in\s+)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/) ?? lower.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?\s+(?:of|in|into|worth)\b/);
  if (pctEq) size = { unit: "pct_equity", value: String(Math.min(100, Number(pctEq[1]))) };
  else if (usd) { size = { unit: "usd", value: String(num(usd[1]) * (usd[2] ? 1000 : 1)) }; lower = lower.replace(usd[0], " "); }
  else warnings.push("No amount given; using $250.");

  // ---- conditions ----
  const tfOf = (s?: string): { tf: "1m" | "1h" | "1d"; p: number } => !s ? { tf: "1h", p: 24 } : /hour|hr|60 ?min/.test(s) ? { tf: "1m", p: 60 } : /week|7 ?d/.test(s) ? { tf: "1d", p: 7 } : /month|30 ?d/.test(s) ? { tf: "1d", p: 30 } : { tf: "1h", p: 24 };
  const avgTf = (n: number, unit: string): { p: number; tf: "1h" | "1d" } => /^h/.test(unit) ? { p: clampP(n), tf: "1h" } : { p: clampP(n * (unit === "week" ? 5 : 1)), tf: "1d" };

  if (/golden cross/.test(lower)) conds.push({ op: "crosses_above", left: ind("sma", 50, "1d"), right: ind("sma", 200, "1d") });
  else if (/death cross/.test(lower)) conds.push({ op: "crosses_below", left: ind("sma", 50, "1d"), right: ind("sma", 200, "1d") });
  const cross = lower.match(/cross(?:es|ing)?\s+(above|over|below|under)\s+(?:its|the)?\s*(\d+)[- ]?(day|hour|h|week|d)s?\s*(ema|sma|ma|moving average|average)?/);
  if (cross) { const a = avgTf(Number(cross[2]), cross[3]); conds.push({ op: /above|over/.test(cross[1]) ? "crosses_above" : "crosses_below", left: px, right: ind(cross[4] === "ema" ? "ema" : "sma", a.p, a.tf) }); }
  const avg = !cross && lower.match(/(under|below|above|over)\s+(?:its|the)?\s*(\d+)[- ]?(day|hour|h|week|d)s?\s*(ema|sma|ma|moving average|average)/);
  if (avg) { const a = avgTf(Number(avg[2]), avg[3]); conds.push({ op: /under|below/.test(avg[1]) ? "lt" : "gt", left: px, right: ind(avg[4] === "ema" ? "ema" : "sma", a.p, a.tf) }); }
  const rsiM = lower.match(/rsi\s*(?:\(?\d+\)?)?\s*(?:is\s+|goes\s+|drops\s+|falls\s+|rises\s+)?(below|under|<|above|over|>)\s*(\d{1,2})/);
  if (rsiM) conds.push({ op: /below|under|</.test(rsiM[1]) ? "lt" : "gt", left: ind("rsi", 14, "1d"), right: { lit: Number(rsiM[2]) } });
  else if (/oversold/.test(lower)) conds.push({ op: "lt", left: ind("rsi", 14, "1d"), right: { lit: 30 } });
  else if (/overbought/.test(lower)) conds.push({ op: "gt", left: ind("rsi", 14, "1d"), right: { lit: 70 } });
  const move = lower.match(/(drops?|dips?|falls?|crash(?:es)?|dumps?|down|declines?|rises?|jumps?|pumps?|gains?|up|rallies|rally|moves?)\s+(?:by\s+|more than\s+|over\s+)?(\d+(?:\.\d+)?)\s*%(?:\s*(?:in|within|over)\s+(?:a|an|one|1|the last|24)?\s*(hour|hr|day|24 ?h|week|7 ?d|month|30 ?d))?/);
  if (move && !/odds|probability/.test(lower.slice(Math.max(0, move.index! - 25), move.index!))) {
    const t = tfOf(move[3]); const down = /drop|dip|fall|crash|dump|down|decline/.test(move[1]);
    if (/^moves?$/.test(move[1])) warnings.push("Direction unclear; treating 'moves' as a drop.");
    conds.push({ op: down || /^moves?$/.test(move[1]) ? "lt" : "gt", left: ind("pct_change", t.p, t.tf), right: { lit: (down || /^moves?$/.test(move[1]) ? -1 : 1) * Number(move[2]) } });
  }
  const lvl = lower.match(/(drops?\s+(?:below|under|to)|falls?\s+(?:below|under|to)|dips?\s+(?:below|under|to)|below|under|less than|above|over|more than|breaks?(?:\s+above)?|hits?|reaches?|goes over|crosses\s+(?:above|over|below|under))\s+(\$\s?)?(\d[\d,]*(?:\.\d+)?)\s*(k)?\b(?!\s*%|[- ]?(?:day|hour|week|d|h|x)\b)/);
  const inRsi = lvl && rsiM && Math.abs(lvl.index! - rsiM.index!) < rsiM[0].length + 2;
  if (lvl && !inRsi) { const v = num(lvl[3]) * (lvl[4] ? 1000 : 1); const dn = /drop|fall|dip|below|under|less/.test(lvl[1]); const isCross = /^crosses/.test(lvl[1]);
    conds.push({ op: isCross ? (dn ? "crosses_below" : "crosses_above") : dn ? "lt" : "gt", left: px, right: { lit: v } }); }

  if (fed) {
    const m = lower.match(/(?:odds|probability|chance)[^%\d]{0,40}?(\d{1,2})\s*%/) ?? lower.match(/(\d{1,2})\s*%[^.]{0,30}(?:odds|chance)/);
    signals.push({ id: "fed_odds", kind: "odds", maxAgeSeconds: 300, params: { instrument: "pm:outcome:fed-cut-december:YES" } });
    conds.push({ op: "gt", left: { ref: "fed_odds.value" }, right: { lit: m ? Number(m[1]) / 100 : 0.7 } });
    if (!m) warnings.push("No odds level given; using 70%.");
  }
  if (isPerp && /funding/.test(lower)) {
    signals.push({ id: `${id}_funding`, kind: "funding", maxAgeSeconds: 300, params: { instrument: meta.id } });
    conds.push({ op: /funding[^.]{0,20}(positive|above|high)/.test(lower) ? "gt" : "lt", left: { ref: `${id}_funding.value` }, right: { lit: /negative|below 0|under 0/.test(lower) ? 0 : 0.0001 } });
  }

  // ---- time-based ----
  let timer = false;
  const every = lower.match(/\b(?:every|each)\s+(day|weekday|hour|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(daily|weekly|hourly|dca)\b/);
  if (every) {
    const k = every[1] ?? every[2];
    const at = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    let h = at ? Number(at[1]) % 24 : equity ? 10 : 14; const mi = at?.[2] ? Number(at[2]) % 60 : 0;
    if (at?.[3] === "pm" && h < 12) h += 12; if (at?.[3] === "am" && h === 12) h = 0;
    const dowAt = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/);
    const cron = k === "hour" || k === "hourly" ? `${mi} * * * *`
      : k === "week" || k === "weekly" || k in DOW ? `${mi} ${h} * * ${DOW[k] ?? (dowAt ? DOW[dowAt[1]] : 1)}`
      : k === "weekday" || equity ? `${mi} ${h} * * 1-5` : `${mi} ${h} * * *`;
    const tz = equity ? "America/New_York" : "UTC";
    signals.push({ id: "every", kind: "timer", maxAgeSeconds: 120, params: { cron, tz } });
    conds.push({ op: "eq", left: { ref: "every.value" }, right: { lit: true } });
    timer = true;
    if (!at && k !== "hour" && k !== "hourly") warnings.push(`No time given; runs at ${String(h).padStart(2, "0")}:00 ${tz}.`);
  }

  const verb = /\b(buy|long|short|ape|invest|accumulate|dca|open|get|grab|purchase|enter)\b/.test(lower);
  if (!conds.length) {
    if (!verb) return unsupported(`Found ${sym}, but not what to do. Say when to buy, e.g. "Buy ${sym} if it drops 5% in a day".`);
    conds.push({ op: "gt", left: px, right: { lit: 0 } });
    warnings.push("No condition found; this opens the position once, right away.");
  }

  const hold = lower.match(/\bfor\s+(\d+)\s*(min|minute|hour|h)\w*/);
  const forMinutes = !timer && hold ? Math.min(1440, Number(hold[1]) * (/^h/.test(hold[2]) ? 60 : 1)) : 0;
  const name = (text.split(/[.;]/)[0] ?? "").slice(0, 60).trim() || `${sym} strategy`;
  const build = (actions: Strategy["actions"]): Strategy => ({
    schemaVersion: 1, name, thesis: thesis.slice(0, 2000), signals,
    triggers: [{ id: "t1", when: conds.length === 1 ? conds[0] : { op: "and", args: conds.slice(0, 8) }, forMinutes, cooldownMinutes: timer ? 1 : 60, maxFires: timer ? null : 1 }],
    actions,
    risk: { maxPositionPct: 25, maxTotalExposurePct: 100, maxDailyLossPct: 10, maxOrdersPerDay: 20, equityWhenFeedStale: "skip" },
  } as Strategy);
  if (legs.length) {
    const actions = [] as Strategy["actions"];
    for (const [k, l] of legs.entries()) {
      const perp = l.meta.kind === "perp";
      if (l.short && !perp) return unsupported(`Shorting ${l.sym} isn't supported (spot/Stock Token). Shorts work on perps like BTC, ETH, SOL.`);
      if (l.lev != null && !perp) warnings.push(`Leverage only applies to perps; using 1x for ${l.sym}.`);
      if (!l.size) warnings.push(`No amount given for ${l.sym}; using $250.`);
      actions.push({ id: `a${k + 1}`, type: "open", on: ["t1"], instrument: l.meta.id, side: perp ? (l.short ? "short" : "long") : "buy", size: l.size ?? { unit: "usd", value: "250" },
        leverage: perp && l.lev != null ? Math.min(10, Math.max(1, l.lev)) : 1, order: { type: "market", maxSlippageBps: 50, maxPriceImpactBps: 100 }, ...(Object.keys(exits).length ? { exits: { ...exits } } : {}) } as Strategy["actions"][number]);
    }
    return { ok: true, warnings, strategy: build(actions) };
  }
  const short = /\bshort\b/.test(lower);
  if (short && !isPerp) return unsupported(`Shorting ${sym} isn't supported (spot/Stock Token). Shorts work on perps like BTC, ETH, SOL.`);
  const lev = lower.match(/(\d+(?:\.\d+)?)\s*[x×]\b/);
  if (lev && !isPerp) warnings.push("Leverage only applies to perps; using 1x.");
  const leverage = isPerp && lev ? Math.min(10, Math.max(1, Number(lev[1]))) : 1;

  const strategy = build([{ id: "a1", type: "open", on: ["t1"], instrument: meta.id, side: isPerp ? (short ? "short" : "long") : "buy", size, leverage,
      order: { type: "market", maxSlippageBps: 50, maxPriceImpactBps: 100 }, ...(Object.keys(exits).length ? { exits } : {}) }] as Strategy["actions"]);
  return { ok: true, strategy, warnings };
}
