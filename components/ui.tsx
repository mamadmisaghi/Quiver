import Link from "@/components/Link";
export const Eyebrow = ({ children, accent }: { children: React.ReactNode; accent?: boolean }) => (
  <p className={`font-mono text-[12px] uppercase tracking-[.16em] ${accent ? "text-accent" : "text-muted"}`}>{children}</p>
);
export const H2 = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <h2 className={`text-balance text-[clamp(2.1rem,4.2vw,3.5rem)] font-medium leading-[1.03] tracking-[-0.04em] ${className}`}>{children}</h2>
);
export const Em = ({ children }: { children: React.ReactNode }) => (
  <em className="font-serif font-normal italic tracking-[-0.01em] text-accent">{children}</em>
);
export const Lead = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <p className={`max-w-[36rem] text-pretty text-[16.5px] leading-[1.65] text-ink-2 ${className}`}>{children}</p>
);
export const Section = ({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) => (
  <section id={id} className={`border-t border-line ${className}`}>
    <div className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">{children}</div>
  </section>
);
export const Pill = ({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "long" | "short" | "accent" | "paper" | "warn" }) => {
  const c = { muted: "border-line-2 text-muted", long: "border-long/30 text-long bg-long/[.06]", short: "border-short/30 text-short bg-short/[.06]", accent: "border-accent/40 text-accent bg-accent-soft", paper: "border-paper/40 text-paper bg-paper/[.08]", warn: "border-warn/40 text-warn bg-warn/[.08]" }[tone];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] font-mono text-[12px] uppercase tracking-[.12em] ${c}`}>{children}</span>;
};
export const BtnPrimary = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link prefetch={false} href={href} className="btn inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-[14px] font-medium text-bg hover:brightness-110 active:bg-accent-press">{children}</Link>
);
export const BtnGhost = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link prefetch={false} href={href} className="btn inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-3 text-[14px] text-ink hover:border-white/30 hover:bg-white/5">{children}</Link>
);
export const Card = ({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement> & { "data-testid"?: string; "data-motion"?: string }) => (
  <div {...rest} className={`rounded-[14px] border border-line bg-card ${className}`}>{children}</div>
);
export const usd = (n: number, d = 0) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (n: number, d = 1) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d) + "%";
export const Spark = ({ pts, w = 120, h = 32, tone = "long", fluid, draw }: { pts: number[]; w?: number; h?: number; tone?: "long" | "short" | "accent"; fluid?: boolean; draw?: boolean }) => {
  const mn = Math.min(...pts), mx = Math.max(...pts);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - mn) / (mx - mn || 1)) * (h - 4)).toFixed(1)}`).join(" ");
  const col = { long: "var(--q-up)", short: "var(--q-down)", accent: "var(--q-amber)" }[tone];
  return (
    <svg width={fluid ? "100%" : w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden className="block">
      {fluid && <path d={`${d} L${w},${h} L0,${h} Z`} fill={col} fillOpacity=".06" />}
      <path d={d} pathLength={draw ? 1 : undefined} data-motion={draw ? "equity-line" : undefined} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};
export const BtnSecondary = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link prefetch={false} href={href} className="btn inline-flex items-center gap-2 rounded-full border border-line-2 px-4 py-2 text-[13px] text-ink hover:border-white/30 hover:bg-white/5">{children}</Link>
);
/** Raw ids live behind this toggle — never in the main copy. */
export const Details = ({ items }: { items: [string, string][] }) => (
  <details className="group mt-2 text-[12px] text-muted">
    <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-ink"><span className="transition-transform group-open:rotate-90" aria-hidden>›</span> Details</summary>
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono">{items.map(([k, v]) => <div key={k} className="contents"><dt>{k}</dt><dd className="break-all text-ink-2">{v}</dd></div>)}</dl>
  </details>
);
