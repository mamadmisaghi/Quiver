// M4.8: per-card OG image (backend has none yet). Percentages only + disclaimer.
import { ImageResponse } from "next/og";
import { durLabel, getPublicCard, signedPct } from "@/lib/public-card";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Quiver shared run card";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await getPublicCard(token).catch(() => null);
  const bg = "#0A0A0B", ink = "#eceef2", muted = "#8a909c";
  if (!c) return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: bg, color: muted, fontSize: 44 }}>Quiver · card not available</div>, size);
  const up = Number(c.returnPct) >= 0, col = up ? "#8FD3A8" : "#F2848F";
  const s = c.spark.length > 1 ? c.spark : [100, 100];
  const lo = Math.min(...s), hi = Math.max(...s), rg = hi - lo || 1;
  const d = s.map((v, i) => `${i ? "L" : "M"}${(i / (s.length - 1)) * 1040},${150 - ((v - lo) / rg) * 140 - 5}`).join(" ");
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: bg, color: ink, padding: "56px 80px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: muted, fontSize: 26 }}>
        <span>QUIVER · {c.handle}</span><span>{c.synthetic ? "Synthetic · " : ""}{c.mode === "paper" ? "Paper" : c.mode}</span>
      </div>
      <div style={{ display: "flex", fontSize: 54, marginTop: 28 }}>{c.strategyName.slice(0, 48)}</div>
      <div style={{ display: "flex", fontSize: 120, color: col, marginTop: 6 }}>{signedPct(c.returnPct)}</div>
      <svg width="1040" height="150" viewBox="0 0 1040 150" style={{ marginTop: 8 }}><path d={d} fill="none" stroke={col} strokeWidth="4" /></svg>
      <div style={{ display: "flex", gap: 48, fontSize: 26, color: muted, marginTop: 18 }}>
        <span>Max DD {signedPct(-Math.abs(Number(c.maxDrawdownPct)))}</span><span>{c.trades} {c.trades === 1 ? "trade" : "trades"}</span><span>{durLabel(c.durationSec)}</span>
      </div>
      <div style={{ display: "flex", fontSize: 20, color: muted, marginTop: "auto" }}>{c.disclaimer}</div>
    </div>, size);
}
