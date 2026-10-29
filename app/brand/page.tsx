import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = { title: "Brand — Quiver", description: "Quiver logos, colors and type for press and partners." };

type Asset = { name: string; file: string; size: string; png?: string; wide?: boolean; light?: boolean };
const ASSETS: Asset[] = [
  { name: "Lockup", file: "quiver-lockup-horizontal.svg", size: "779 × 189", png: "png/quiver-lockup-horizontal@2x.png", wide: true },
  { name: "Lockup, small sizes", file: "quiver-lockup-horizontal-small.svg", size: "779 × 189 · for < 120px", png: "png/quiver-lockup-horizontal-small@2x.png", wide: true },
  { name: "Mark", file: "quiver-mark.svg", size: "188 × 100", png: "png/quiver-mark@4x.png" },
  { name: "Mark, small sizes", file: "quiver-mark-small.svg", size: "188 × 100 · for < 32px", png: "png/quiver-mark-small@4x.png" },
  { name: "App icon", file: "icon-512.png", size: "512 × 512" },
  { name: "Favicon", file: "favicon.svg", size: "136 × 136", png: "icon-192.png" },
];
const COLORS: [string, string, string][] = [["Ink", "#0A0A0B", "Background"], ["Panel", "#17171A", "Surfaces"], ["Cream", "#EDE6DA", "Mark, type"], ["Amber", "#FFB547", "The one accent"], ["Up", "#8FD3A8", "Gains"], ["Down", "#F2848F", "Losses, blocks"]];
const dl = "btn rounded-full border border-line-2 px-3 py-1.5 font-mono text-[12px] text-ink-2 hover:bg-white/5";

export default function BrandPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] px-5 pb-24 pt-16 sm:px-8 sm:pt-24" data-motion="doc">
        <div className="font-mono text-[12px] uppercase tracking-[.16em] text-accent">Brand</div>
        <h1 className="mt-4 text-[clamp(34px,6vw,56px)] font-semibold leading-[1.04] tracking-[-.025em] text-ink">Press kit</h1>
        <p className="mt-5 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">Logos, colors and type for writing about Quiver. Keep the mark cream on dark, give it room, and don’t redraw, recolor or rotate it.</p>

        <h2 className="mt-16 font-mono text-[12px] uppercase tracking-[.14em] text-muted">Logos</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ASSETS.map((a) => (
            <li key={a.file} data-motion="reveal" className={`overflow-hidden rounded-[14px] border border-line bg-bg-2 ${a.wide ? "lg:col-span-1" : ""}`}>
              <div className="grid h-44 place-items-center border-b border-line bg-bg p-8">
                {/* eslint-disable-next-line @next/next/no-img-element -- static SVG/PNG brand assets, shown at intrinsic ratio */}
                <img src={`/brand/${a.file}`} alt={`Quiver ${a.name.toLowerCase()}`} className={a.wide ? "h-auto max-h-16 w-full max-w-[280px]" : "h-auto max-h-24 max-w-[160px]"} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><div className="text-[14px] text-ink">{a.name}</div><div className="tnum font-mono text-[12px] text-muted">{a.size}</div></div>
                <div className="flex gap-2">
                  {a.file.endsWith(".svg") && <a href={`/brand/${a.file}`} download className={dl} aria-label={`Download ${a.name} SVG`}>SVG</a>}
                  {(a.png ?? (a.file.endsWith(".png") ? a.file : null)) && <a href={`/brand/${a.png ?? a.file}`} download className={dl} aria-label={`Download ${a.name} PNG`}>PNG</a>}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <h2 className="mt-16 font-mono text-[12px] uppercase tracking-[.14em] text-muted">Color</h2>
        <ul className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          {COLORS.map(([n, hex, use]) => (
            <li key={hex} className="bg-bg-2">
              <div className="h-20 border-b border-line" style={{ background: hex }} />
              <div className="p-4"><div className="text-[14px] text-ink">{n}</div><div className="tnum font-mono text-[12px] text-ink-2">{hex}</div><div className="mt-1 text-[12.5px] text-muted">{use}</div></div>
            </li>
          ))}
        </ul>

        <h2 className="mt-16 font-mono text-[12px] uppercase tracking-[.14em] text-muted">Type</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-[14px] border border-line bg-bg-2 p-6"><div className="text-[40px] font-semibold tracking-[-.02em] text-ink">Geist</div><div className="mt-2 text-[13.5px] text-muted">Headlines and body. Tight tracking on display sizes.</div></div>
          <div className="rounded-[14px] border border-line bg-bg-2 p-6"><div className="tnum font-mono text-[34px] text-ink">$15.63</div><div className="mt-2 text-[13.5px] text-muted">Geist Mono for numbers, labels and policy fields. Always tabular.</div></div>
        </div>

        <h2 className="mt-16 font-mono text-[12px] uppercase tracking-[.14em] text-muted">Name</h2>
        <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">Write <span className="text-ink">Quiver</span>, capital Q. The token is <span className="font-mono text-ink">$QUIVR</span> and isn’t live yet.</p>
      </main>
      <SiteFooter />
    </>
  );
}
