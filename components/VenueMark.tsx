import type { Venue } from "@/lib/api";
const V: Record<Venue, { short: string; name: string }> = {
  robinhood: { short: "RH", name: "Robinhood Chain" }, polymarket: { short: "PM", name: "Polymarket" },
  hyperliquid: { short: "HL", name: "Hyperliquid" }, solana: { short: "SOL", name: "Solana" },
};
export const venueName = (v: Venue) => V[v]?.name ?? v;
export default function VenueMark({ venue, size = 20 }: { venue: Venue; size?: number }) {
  const m = V[venue] ?? { short: venue.slice(0, 2).toUpperCase(), name: venue };
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-[5px] border border-line-2 bg-raised font-mono text-[12px] leading-none font-medium tracking-tight text-ink-2"
      style={{ minWidth: size + 12, height: size, paddingInline: 4 }} title={m.name}>
      {m.short}
    </span>
  );
}
