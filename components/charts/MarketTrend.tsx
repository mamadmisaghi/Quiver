"use client";
import { useEffect, useState } from "react";
import { Spark } from "../ui";
import { API_MODE, type Market } from "@/lib/api";
import { publicChartHistory } from "@/lib/api/chart-history";
export default function MarketTrend({ market }: { market: Market }) {
  const [series, setSeries] = useState<number[] | null>(null);
  useEffect(() => {
    if (API_MODE !== "mock" || market.spark?.length) return;
    let current = true;
    publicChartHistory(market.id, "15m", "1d")
      .then((h) => {
        if (current) setSeries(h.bars.map((b) => Number(b.c)));
      })
      .catch(() => {
        if (current) setSeries([]);
      });
    return () => {
      current = false;
    };
  }, [market.id, !!market.spark?.length]);
  const values = market.spark?.length ? market.spark : series;
  if (!values || values.length < 2)
    return (
      <span aria-label="No trend available" className="text-muted">
        —
      </span>
    );
  return (
    <span
      className="q-market-trend"
      title={
        market.spark?.length ? "Market trend" : "Recorded closing prices · 1D"
      }
    >
      <Spark
        pts={values}
        w={90}
        h={28}
        tone={values[values.length - 1] >= values[0] ? "long" : "short"}
      />
    </span>
  );
}
