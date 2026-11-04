"use client";
import { useEffect, useRef, useState } from "react";
import { chartPrice, exactPrice } from "@/lib/chart-format";
export default function QuoteNumber({
  value,
  unit = "usd",
}: {
  value: string | number;
  unit?: "usd" | "percent";
}) {
  const formatted = chartPrice(Number(value), unit),
    full = unit === "usd" ? exactPrice(value) : Number(value) * 100 + "%";
  const previous = useRef(formatted),
    [expanded, setExpanded] = useState(false);
  const chars = Array.from(formatted),
    old = Array.from(previous.current);
  useEffect(() => {
    previous.current = formatted;
  }, [formatted]);
  const digits = (
    <span aria-hidden="true">
      {chars.map((c, i) => {
        const pos = chars.length - i,
          changed = c !== old[old.length - pos] && /[0-9]/.test(c);
        return (
          <span
            key={pos + ":" + c}
            className={changed ? "q-digit-changed" : undefined}
          >
            {c}
          </span>
        );
      })}
    </span>
  );
  if (!/[₀-₉]/.test(formatted))
    return (
      <span className="q-number q-quote-number" aria-label={full}>
        {digits}
        <span className="sr-only">{full}</span>
      </span>
    );
  return (
    <span className="q-precise-price">
      <button
        type="button"
        className="q-number q-quote-number"
        title={full}
        aria-label={"Exact price " + full}
        aria-expanded={expanded}
        onBlur={() => setExpanded(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setExpanded(false);
        }}
        onClick={() => setExpanded((x) => !x)}
      >
        {digits}
      </button>
      {expanded && <span className="q-price-tip">{full}</span>}
    </span>
  );
}
