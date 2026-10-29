// App page titles are plain Geist (no amber serif — that's reserved for the landing).
export default function PageHeader({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[clamp(1.9rem,3.2vw,2.5rem)] font-medium leading-[1.05] tracking-[-0.035em]">{title}</h1>
        <p className="mt-2 max-w-[60ch] text-[14.5px] text-muted">{sub}</p>
      </div>
      {right}
    </div>
  );
}
