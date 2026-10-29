/**
 * XNYS calendar. Source: https://www.nyse.com/markets/hours-calendars (checked 2026-10-27).
 * Outside 2025–2027 holidays are UNKNOWN (weekday treated as a trading day) — extend before 2028.
 * Sessions: pre 04:00–09:30, core 09:30–16:00, post 16:00–20:00 ET (NYSE Arca extended hours).
 * Early-close days: core ends 13:00, late session ends 17:00.
 */
import type { Session } from "./market";

export const CALENDAR_SOURCE = "https://www.nyse.com/markets/hours-calendars";
export const CALENDAR_YEARS = [2025, 2026, 2027];
export const NYSE_HOLIDAYS = new Set([
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
export const NYSE_EARLY_CLOSE = new Set(["2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24", "2027-11-26"]);

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function nyLocal(t: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday as string, mins: Number(p.hour) * 60 + Number(p.minute) };
}
export const isTradingDay = (date: string, weekday: string) => weekday !== "Sat" && weekday !== "Sun" && !NYSE_HOLIDAYS.has(date);

/** Session at t: open (core) | pre | post | closed (night, weekend, holiday). */
export function nyseSession(t: number): Session {
  const { date, weekday, mins } = nyLocal(t);
  if (!isTradingDay(date, weekday)) return "closed";
  const early = NYSE_EARLY_CLOSE.has(date);
  const coreEnd = early ? 780 : 960, postEnd = early ? 1020 : 1200;
  if (mins >= 570 && mins < coreEnd) return "open";
  if (mins >= 240 && mins < 570) return "pre";
  if (mins >= coreEnd && mins < postEnd) return "post";
  return "closed";
}

/** Start (ms) of the current contiguous non-trading stretch containing t, or null if a session is active. Hour resolution, max 6 days back. */
export function closedSince(t: number): number | null {
  if (nyseSession(t) !== "closed") return null;
  let s = t - (t % 60_000);
  for (let k = 0; k < 6 * 24 * 4; k++) { const prev = s - 15 * 60_000; if (nyseSession(prev) !== "closed") return s; s = prev; }
  return s;
}
