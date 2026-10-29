"use client";
// M3.7: header menu below lg. Disclosure button (aria-expanded/controls), focus trapped inside the open panel,
// Esc or a link click closes it and focus returns to the button. Motion is a short fade/slide, off under reduced motion.
import Link from "@/components/Link";
import { useEffect, useRef, useState } from "react";

export default function MobileMenu({ links }: { links: readonly (readonly [string, string])[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = panel.current!;
    const items = () => [btn.current!, ...el.querySelectorAll<HTMLElement>("a[href]")];
    items()[1]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); return; }
      if (e.key !== "Tab") return;
      const f = items(); const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      else if (i === -1) { e.preventDefault(); f[0].focus(); }
    };
    const onDown = (e: PointerEvent) => { if (!el.contains(e.target as Node) && !btn.current!.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("pointerdown", onDown);
    const root = document.documentElement; const prev = root.style.overflow; root.style.overflow = "hidden"; // on <html>, not <body>: body overflow would break the sticky header
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); root.style.overflow = prev; };
  }, [open]);
  return (
    <div className="lg:hidden">
      <button ref={btn} type="button" aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}
        className="btn grid h-10 w-10 place-items-center rounded-full border border-line-2 text-ink-2 hover:bg-white/5">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          {open ? <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /> : <path d="M2 5h12M2 11h12" />}
        </svg>
      </button>
      <div id="site-menu" ref={panel} hidden={!open} data-motion="menu"
        className="absolute inset-x-0 top-16 h-[calc(100dvh-4rem)] border-t border-line bg-bg motion-safe:animate-[menu-in_160ms_ease-out]">
        <nav aria-label="Main" className="mx-auto grid max-w-[1200px] px-5 py-4 sm:px-8">
          {links.map(([h, l]) => (
            <Link key={h} prefetch={false} href={h} onClick={() => setOpen(false)} className="btn flex items-center justify-between border-b border-line py-4 text-[17px] text-ink-2 hover:text-ink">
              {l}<span aria-hidden="true" className="font-mono text-[12px] text-muted">→</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
