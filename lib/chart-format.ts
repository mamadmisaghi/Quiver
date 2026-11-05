const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const subs = "₀₁₂₃₄₅₆₇₈₉";
export function exactPrice(value: number | string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))
    return "$" + value;
  return (
    "$" +
    n.toLocaleString("en-US", {
      maximumSignificantDigits: 17,
      useGrouping: false,
    })
  );
}
export function chartPrice(n: number, unit: "usd" | "percent" = "usd") {
  if (!Number.isFinite(n)) return "—";
  if (unit === "percent")
    return (
      (n * 100).toLocaleString("en-US", { maximumFractionDigits: 3 }) + "%"
    );
  if (n === 0 || Math.abs(n) >= 1) return usd.format(n);
  const sign = n < 0 ? "−$" : "$",
    v = Math.abs(n),
    s = v.toExponential(3),
    count = -Number(s.split("e")[1]) - 1;
  if (count >= 3)
    return (
      sign +
      "0.0" +
      String(count)
        .split("")
        .map((x) => subs[Number(x)])
        .join("") +
      s.split("e")[0].replace(".", "").replace(/0+$/, "")
    );
  return sign + v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}
