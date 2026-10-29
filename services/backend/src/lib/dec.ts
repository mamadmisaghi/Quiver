/** Decimal-string helpers. Internal math uses JS numbers for prices (display precision); money values are rounded on output. */
export const toNum = (s: string | number) => (typeof s === "number" ? s : Number(s));
export function dec(n: number, dp = 6): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(dp).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}
export const usd = (n: number) => dec(n, 2);
