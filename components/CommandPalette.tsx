"use client";
// M4.9.2 parity: ⌘K / Ctrl+K quick jump. Pages are static; strategies come from api.strategies() (signed-in only, failures are silent).
// M5.17: below the page jumps + "Build:" shortcut, grouped GET /search results (markets, public strategies, traders).
// Debounced 250ms, never sent for an empty q, q capped at 80 chars; 401/422/429/network errors are quiet (groups just stay empty).
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SearchRes } from "@/lib/api";
import { profileHref } from "./social/Handle";

const QMAX = 80, DEBOUNCE_MS = 250;

type Item = { label: string; hint: string; href: string; group?: string };
export default function CommandPalette({ pages, setOpen }: { pages: [string, string][]; setOpen: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState(""); const [i, setI] = useState(0);
  const [strats, setStrats] = useState<Item[]>([]);
  const [found, setFound] = useState<{ q: string; r: SearchRes } | null>(null);
  const term = q.trim().slice(0, QMAX);
  useEffect(() => {
    if (!term) return;
    let on = true;
    const t = setTimeout(() => { api.search(term, 5).then((r) => { if (on) setFound({ q: term, r }); }).catch(() => {}); }, DEBOUNCE_MS);
    return () => { on = false; clearTimeout(t); };
  }, [term]);
  const input = useRef<HTMLInputElement>(null); const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    back.current = document.activeElement as HTMLElement; input.current?.focus();
    let on = true;
    api.strategies().then((p) => { if (on) setStrats(p.items.map((s) => ({ label: s.name, hint: s.activeRunId ? "Strategy · running" : "Strategy", href: s.activeRunId ? `/app/run/${s.activeRunId}` : "/app/strategies" }))); }).catch(() => {});
    const prev = back.current; return () => { on = false; prev?.focus?.(); };
  }, []);
  const items = useMemo(() => {
    const all: Item[] = [{ label: "New strategy", hint: "Action", href: "/app/new" }, ...pages.map(([l, h]) => ({ label: l, hint: "Page", href: h })), ...strats];
    const t = q.trim().toLowerCase();
    if (!t) return all.slice(0, 12);
    const ask: Item = { label: `Build: “${q.trim()}”`, hint: "Start a strategy from this idea", href: `/app/new?q=${encodeURIComponent(q.trim())}` };
    const r = found && found.q === term ? found.r : null;
    const hits: Item[] = r ? [
      ...r.markets.map((m) => ({ label: `${m.symbol} · ${m.name}`, hint: m.venue, href: `/app/markets/${encodeURIComponent(m.id)}`, group: "Markets" })),
      ...r.strategies.map((x) => ({ label: x.name, hint: x.handle, href: `/app/strategies/${encodeURIComponent(x.publicStrategyId)}`, group: "Public strategies" })),
      ...r.traders.map((x) => ({ label: x.handle, hint: x.isYou ? "You" : `${x.strategies} public`, href: profileHref(x.handle), group: "Traders" })),
    ] : [];
    return [...all.filter((x) => x.label.toLowerCase().includes(t)).slice(0, 10), ask, ...hits];
  }, [q, term, found, pages, strats]);
  useEffect(() => { document.getElementById(`cmdk-${i}`)?.scrollIntoView({ block: "nearest" }); }, [i, items]);
  const go = (x?: Item) => { if (!x) return; setOpen(false); router.push(x.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setI((n) => (n + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setI((n) => (n - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { e.preventDefault(); go(items[i]); }
    else if (e.key === "Tab") { // focus trap (Robin gate 4ab4ad6): Tab/Shift+Tab cycle inside the dialog only
      const f = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('input,button,a[href],[tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute("disabled"));
      if (!f.length) return; e.preventDefault();
      const k = f.indexOf(document.activeElement as HTMLElement);
      f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} data-testid="cmdk">
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-[560px] overflow-hidden rounded-[12px] border border-line-2 bg-bg-2 shadow-2xl" onKeyDown={onKey}>
        <input ref={input} value={q} maxLength={QMAX} onChange={(e) => { setQ(e.target.value.slice(0, QMAX)); setI(0); }} placeholder="Search pages, markets, traders, or type an idea" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={`cmdk-${i}`}
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] placeholder:text-muted focus:outline-none" />
        <ul id="cmdk-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.map((x, n) => {
            const head = x.group && x.group !== items[n - 1]?.group;
            const opt = (
              <li key={x.href + x.label + n} id={`cmdk-${n}`} role="option" aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={() => go(x)} data-group={x.group}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 text-[14px] ${n === i ? "bg-white/[.06] text-ink" : "text-ink-2"}`}>
                <span className="min-w-0 truncate">{x.label}</span><span className="max-w-[40%] shrink-0 truncate text-[12px] text-muted">{x.hint}</span>
              </li>);
            return head ? [<li key={"h-" + x.group} role="presentation" data-testid="cmdk-group" className="px-3 pb-1 pt-3 font-mono text-[11.5px] uppercase tracking-[.14em] text-muted">{x.group}</li>, opt] : opt;
          })}
        </ul>
        <div className="flex gap-4 border-t border-line px-4 py-2 font-mono text-[11.5px] text-muted"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div>
      </div>
    </div>
  );
}
