"use client";
import { useState } from "react";
import { chartPrice, exactPrice } from "@/lib/chart-format";

type Reading = {
  value: number;
  text: string;
  previous: string;
  direction: "up" | "down";
  revision: number;
};
export default function QuoteNumber({
  value,
  unit = "usd",
}: {
  value: string | number;
  unit?: "usd" | "percent";
}) {
  const numeric = Number(value),
    formatted = chartPrice(numeric, unit);
  const full = unit === "usd" ? exactPrice(value) : numeric * 100 + "%";
  const [reading, setReading] = useState<Reading>({
    value: numeric,
    text: formatted,
    previous: formatted,
    direction: "up",
    revision: 0,
  });
  const [expanded, setExpanded] = useState(false);
  if (!Object.is(reading.value, numeric) || reading.text !== formatted) {
    setReading({
      value: numeric,
      text: formatted,
      previous: reading.text,
      direction: numeric >= reading.value ? "up" : "down",
      revision: reading.revision + (formatted !== reading.text ? 1 : 0),
    });
  }
  const chars = Array.from(reading.text),
    old = Array.from(reading.previous);
  const digits = (
    <span className="q-odometer" aria-hidden="true">
      {chars.map((char, index) => {
        const position = chars.length - index,
          previous = old[old.length - position];
        if (!/[0-9]/.test(char))
          return <span key={"mark" + position}>{char}</span>;
        const changed = /[0-9]/.test(previous ?? "") && previous !== char;
        return (
          <span className="q-odometer-digit" key={"digit" + position}>
            {changed ? (
              <span
                className={"q-odometer-roll q-odometer-" + reading.direction}
                key={reading.revision}
              >
                <span>{reading.direction === "up" ? previous : char}</span>
                <span>{reading.direction === "up" ? char : previous}</span>
              </span>
            ) : (
              <span className="q-odometer-still">{char}</span>
            )}
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
