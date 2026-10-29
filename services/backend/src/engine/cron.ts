/** Minimal 5-field cron (min hour dom mon dow) with *, n, a-b, a,b, * /n. Evaluated in an IANA tz. */
function fieldMatch(spec: string, v: number, lo: number, hi: number): boolean {
  return spec.split(",").some((part) => {
    const [range, stepS] = part.split("/"); const step = stepS ? Number(stepS) : 1;
    let a = lo, b = hi;
    if (range !== "*") { const [x, y] = range.split("-"); a = Number(x); b = y !== undefined ? Number(y) : stepS ? hi : a; }
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(step) || step < 1) throw new Error("bad cron");
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
export function parseCron(cron: string) { const f = cron.trim().split(/\s+/); if (f.length !== 5) throw new Error("cron must have 5 fields"); fieldMatch(f[0], 0, 0, 59); return f; }
export function cronMatches(cron: string, tz: string, t: number): boolean {
  const f = parseCron(cron);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "numeric", hour: "numeric", day: "numeric", month: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(t));
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return fieldMatch(f[0], Number(g("minute")), 0, 59) && fieldMatch(f[1], Number(g("hour")), 0, 23) && fieldMatch(f[2], Number(g("day")), 1, 31) && fieldMatch(f[3], Number(g("month")), 1, 12) && fieldMatch(f[4], dow, 0, 6);
}
