export default function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12">{children}</div>;
}
export const Th = ({ cols }: { cols: string[] }) => (
  <thead className="font-mono text-[12px] uppercase tracking-[.12em] text-muted"><tr className="border-b border-line">{cols.map((h, i) => <th key={i} scope="col" className="px-5 py-3 font-normal">{h.startsWith("sr:") ? <span className="sr-only">{h.slice(3)}</span> : h}</th>)}</tr></thead>
);
export const Stat = ({ k, v, tone }: { k: string; v: string; tone?: string }) => (
  <div className="bg-bg-2 px-5 py-4"><div className="text-[12px] text-muted">{k}</div><div className={`tnum mt-1 font-mono text-[17px] ${tone ?? ""}`}>{v}</div></div>
);
export const Stats = ({ children, n = 4 }: { children: React.ReactNode; n?: number }) => (
  <div className={`mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line ${n === 3 ? "md:grid-cols-3" : "md:grid-cols-4"}`}>{children}</div>
);
