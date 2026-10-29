// M3.7: shared long-form layout for /docs and /terms — numbered TOC (sticky on lg, inline list on mobile), prose column.
import type { ReactNode } from "react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";

export type DocSection = { id: string; title: string; body: ReactNode };
const num = (i: number) => String(i + 1).padStart(2, "0");

export default function DocPage({ eyebrow, title, lead, meta, sections }: { eyebrow: string; title: string; lead: ReactNode; meta?: ReactNode; sections: DocSection[] }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] px-5 pb-24 pt-16 sm:px-8 sm:pt-24" data-motion="doc">
        <div className="font-mono text-[12px] uppercase tracking-[.16em] text-accent">{eyebrow}</div>
        <h1 className="mt-4 max-w-[20ch] text-balance text-[clamp(34px,6vw,56px)] font-semibold leading-[1.04] tracking-[-.025em] text-ink">{title}</h1>
        <div className="mt-5 max-w-[62ch] text-[16px] leading-relaxed text-ink-2">{lead}</div>
        {meta && <div className="mt-4 font-mono text-[12px] text-muted">{meta}</div>}
        <div className="mt-14 grid gap-12 lg:grid-cols-[15rem_1fr]">
          <nav aria-label="Contents" className="lg:sticky lg:top-24 lg:self-start">
            <div className="font-mono text-[12px] uppercase tracking-[.14em] text-muted">Contents</div>
            <ol className="mt-3 grid gap-1 border-l border-line text-[13.5px]">
              {sections.map((s, i) => (
                <li key={s.id}><a href={`#${s.id}`} className="btn -ml-px flex gap-3 border-l border-transparent py-1 pl-4 text-ink-2 hover:border-accent hover:text-ink"><span className="tnum font-mono text-muted">{num(i)}</span>{s.title}</a></li>
              ))}
            </ol>
          </nav>
          <div className="grid max-w-[70ch] gap-14">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} data-motion="reveal">
                <h2 id={`${s.id}-h`} className="flex items-baseline gap-3 text-[22px] font-semibold tracking-[-.01em] text-ink"><span className="tnum font-mono text-[13px] font-normal text-accent">{num(i)}</span>{s.title}</h2>
                <div className="prose-q mt-4 grid gap-4 text-[15px] leading-relaxed text-ink-2">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

export const Kv = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="grid divide-y divide-line rounded-[12px] border border-line bg-bg-2 font-mono text-[13px]">
    {rows.map(([k, v]) => <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4"><dt className="text-muted">{k}</dt><dd className="tabular-nums text-ink-2">{v}</dd></div>)}
  </dl>
);
export const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="grid gap-2">{items.map((x, i) => <li key={i} className="grid grid-cols-[2rem_1fr]"><span className="tnum font-mono text-[13px] text-muted">{i + 1}.</span><span>{x}</span></li>)}</ol>
);
export const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</code>;
