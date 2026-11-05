export type LiveMarketPrice = {
  symbol: string;
  price: number | null;
  at: number;
  source: string;
  bid?: number;
  ask?: number;
  address?: string;
  liquidity?: number;
  volume?: number;
  slot?: number;
  referencePair?: string;
  levels?: { price: number; size: number }[][];
};
/** Read-only venue data, shared by the HTTP snapshot and the public streaming feed. */
export function hyperliquidBook(
  value: unknown,
  symbol: string,
  now = Date.now(),
): LiveMarketPrice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { coin?: unknown; time?: unknown; levels?: unknown };
  if (
    row.coin !== symbol ||
    typeof row.time !== "number" ||
    !Number.isSafeInteger(row.time) ||
    now - row.time > 30000 ||
    row.time - now > 3000 ||
    !Array.isArray(row.levels) ||
    row.levels.length !== 2
  )
    return null;
  const levels = row.levels.map((side) =>
    Array.isArray(side)
      ? side.slice(0, 10).flatMap((level) => {
          if (!level || typeof level !== "object") return [];
          const r = level as { px?: unknown; sz?: unknown },
            price = Number(r.px),
            size = Number(r.sz);
          return Number.isFinite(price) &&
            price > 0 &&
            Number.isFinite(size) &&
            size > 0
            ? [{ price, size }]
            : [];
        })
      : [],
  );
  const bid = levels[0]?.[0]?.price,
    ask = levels[1]?.[0]?.price;
  if (!bid || !ask || ask < bid) return null;
  return {
    symbol,
    price: (bid + ask) / 2,
    at: row.time,
    source: "Hyperliquid order book",
    bid,
    ask,
    levels,
  };
}
