"use client";
import AccountMenu from "@/components/auth/AccountMenu";
import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "./Logo";
import dynamic from "next/dynamic";
// ⌘K palette loads on first open: it isn't needed for first paint, so it stays out of every /app page's initial JS.
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });
import { DEMO_LABEL } from "@/lib/api/format";
import { onAuthRetry } from "@/lib/api/live";
const NAV: [string, string, string][] = [
  ["Home", "/app", "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z"],
  ["Strategies", "/app/strategies", "M4 5h12M4 10h12M4 15h7"],
  ["Paper trades", "/app/run/demo", "M3 14l4-4 3 3 7-7M13 6h4v4"],
  ["Approvals", "/app/approvals", "M4 10.5l3.5 3.5L16 5.5"],
  ["Portfolio", "/app/portfolio", "M3 16V9M8 16V4M13 16v-5M18 16V7"],
  ["Autopilot", "/app/autopilot", "M10 3v4M10 13v4M3 10h4M13 10h4M10 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"],
  ["Markets", "/app/markets", "M4 16V9M8 16V5M12 16v-4M16 16V7"],
  ["Skills", "/app/skills", "M10 3l2 4.5 5 .5-3.8 3.3 1.1 4.9L10 13.7 5.7 16.2l1.1-4.9L3 8l5-.5z"],
  ["Traders", "/app/traders", "M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 17c0-3 2.2-5 5-5s5 2 5 5M14 9a2.5 2.5 0 1 0 0-5M15 12c1.8.4 3 2 3 5"],
  ["Activity", "/app/activity", "M2 10h3l2-5 3 10 2-5h6"],
];
const ACCOUNT: [string, string, string][] = [
  ["Wallets", "/app/wallets", "M3 6h14v10H3zM3 6l2-3h10M13 11h2"],
  ["Risk", "/app/risk", "M10 3l6 2.5V10c0 3.5-2.6 6-6 7-3.4-1-6-3.5-6-7V5.5z"],
  ["Rewards", "/app/rewards", "M4 8h12v9H4zM3 5h14v3H3zM10 5v12M10 5c-1-2.5-4-2.5-4 0M10 5c1-2.5 4-2.5 4 0"],
  ["Settings", "/app/settings", "M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8"],
  ["Revenue", "/app/revenue", "M10 3v14M13.5 6H8.3a2.3 2.3 0 0 0 0 4.5h3.4a2.3 2.3 0 0 1 0 4.5H6"],
];
const isOn = (href: string, path: string) => href === "/app" ? path === "/app" : path.startsWith(href.replace(/\/demo$/, ""));
const nav = (n: string) => NAV.find((x) => x[0] === n)!;
const BOTTOM: [string, string, string][] = [["Home", ...nav("Home").slice(1)], ["Strategies", ...nav("Strategies").slice(1)], ["Paper", ...nav("Paper trades").slice(1)], ["Markets", ...nav("Markets").slice(1)]] as [string, string, string][];
function Item({ n, href, d, path, tall }: { n: string; href: string; d: string; path: string; tall?: boolean }) {
  const on = isOn(href, path);
  return (
    <Link prefetch={false} href={href} aria-current={on ? "page" : undefined}
      className={`btn flex items-center gap-2.5 rounded-[8px] px-2.5 ${tall ? "min-h-11 py-2.5 text-[15px]" : "py-[7px] text-[13.5px]"} ${on ? "bg-white/[.06] text-ink" : "text-muted hover:bg-white/[.03] hover:text-ink"}`}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={on ? "text-accent" : ""}><path d={d} /></svg>
      {n}
    </Link>
  );
}
export default function AppShell({ children }: { active?: string; children: React.ReactNode }) {
  const path = usePathname() || "/app";
  const [open, setOpen] = useState(false);
  const [cmdk, setCmdk] = useState(false); // M4.9.2 ⌘K
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk((o) => !o); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  const [authRetry, setAuthRetry] = useState<number | null>(null); // M3.4: quiet state while /auth backs off a 429
  useEffect(() => onAuthRetry((s) => setAuthRetry(s ? s.retryInSec : null)), []);
  useEffect(() => { if (!authRetry) return; const t = setTimeout(() => setAuthRetry((n) => (n && n > 1 ? n - 1 : n)), 1000); return () => clearTimeout(t); }, [authRetry]);
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) { setSeenPath(path); setOpen(false); } // close the drawer on navigation (state adjust during render)
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <div className="flex min-h-dvh">
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center">
        {authRetry != null && <span className="rounded-full border border-line bg-bg-2/95 px-3 py-1.5 text-[12.5px] text-muted">Signing in is busy. Retrying in {authRetry}s…</span>}
      </div>
      {cmdk && <CommandPalette setOpen={setCmdk} pages={[...NAV, ...ACCOUNT].map(([n, h]) => [n, h] as [string, string])} />}
      <aside className="sticky top-0 hidden h-screen self-start overflow-y-auto w-[240px] shrink-0 flex-col border-r border-line bg-bg-2 px-3 py-5 lg:flex">
        <Link prefetch={false} href="/" className="px-2"><Logo /></Link>
        <Link prefetch={false} href="/app/new" className="btn mt-6 flex items-center justify-center gap-2 rounded-full bg-accent py-2.5 text-[13px] font-medium text-bg hover:brightness-110 active:bg-accent-press">
          <span aria-hidden className="text-[15px] leading-none">+</span> New strategy
        </Link>
        <button type="button" onClick={() => setCmdk(true)} aria-haspopup="dialog" data-testid="cmdk-open" className="btn mt-3 flex items-center justify-between rounded-[8px] border border-line px-2.5 py-2 text-[13px] text-muted hover:border-line-2 hover:text-ink">
          Search<kbd className="font-mono text-[12px]">⌘K</kbd>
        </button>
        <nav aria-label="App" className="mt-5 flex flex-col gap-0.5">{NAV.map(([n, h, d]) => <Item key={n} n={n} href={h} d={d} path={path} />)}</nav>
        <div className="mt-6 px-2.5 font-mono text-[12px] uppercase tracking-[.16em] text-muted">Account</div>
        <nav aria-label="Account" className="mt-2 flex flex-col gap-0.5">{ACCOUNT.map(([n, h, d]) => <Item key={n} n={n} href={h} d={d} path={path} />)}</nav>
        <div className="mt-auto space-y-3 border-t border-line pt-4">
          <AccountMenu />
          <div className="flex items-center gap-2 px-2 text-[12px] text-muted"><span data-motion="pulse-dot" className="relative h-1.5 w-1.5 rounded-full bg-long" /> {DEMO_LABEL}</div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden" style={{ boxSizing: "content-box" }}>
          <Link prefetch={false} href="/" className="flex min-h-11 items-center" aria-label="Quiver home"><Logo /></Link>
          <div className="flex items-center gap-2">
            <Link prefetch={false} href="/app/new" className="btn flex min-h-11 items-center rounded-full bg-accent px-4 text-[13px] font-medium text-bg">+ New</Link>
            <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="app-drawer" className="btn flex h-11 w-11 items-center justify-center rounded-full border border-line-2">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M3 6h14M3 10h14M3 14h14" /></svg>
            </button>
          </div>
        </header>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="app-drawer">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 right-0 flex w-[min(320px,86vw)] flex-col overflow-y-auto border-l border-line bg-bg-2 px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]">
              <div className="flex items-center justify-between px-2"><Logo /><button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="btn flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-ink">✕</button></div>
              <nav aria-label="App" className="mt-4 flex flex-col gap-0.5" onClick={() => setOpen(false)}>{NAV.map(([n, h, d]) => <Item key={n} n={n} href={h} d={d} path={path} tall />)}</nav>
              <div className="mt-5 px-2.5 font-mono text-[12px] uppercase tracking-[.16em] text-muted">Account</div>
              <nav aria-label="Account" className="mt-2 flex flex-col gap-0.5" onClick={() => setOpen(false)}>{ACCOUNT.map(([n, h, d]) => <Item key={n} n={n} href={h} d={d} path={path} tall />)}</nav>
              <div className="mt-auto space-y-3 border-t border-line pt-4">
                <AccountMenu tall />
                <div className="flex items-center gap-2 px-2 text-[12px] text-muted"><span className="relative h-1.5 w-1.5 rounded-full bg-long" /> {DEMO_LABEL}</div>
              </div>
            </div>
          </div>
        )}
        <main id="main" className="pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">{children}</main>
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-bg/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
          {BOTTOM.map(([n, h, d]) => { const on = isOn(h, path); return (
            <Link prefetch={false} key={n} href={h} aria-current={on ? "page" : undefined} className={`flex h-16 flex-col items-center justify-center gap-1 text-[12px] leading-none ${on ? "text-ink" : "text-muted"}`}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={on ? "text-accent" : ""}><path d={d} /></svg>{n}
            </Link>); })}
          <button type="button" onClick={() => setOpen(true)} aria-label="More pages" className={`flex h-16 flex-col items-center justify-center gap-1 text-[12px] leading-none ${BOTTOM.some(([, h]) => isOn(h, path)) ? "text-muted" : "text-ink"}`}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden><circle cx="5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15" cy="10" r="1.4" /></svg>More
          </button>
        </nav>
      </div>
    </div>
  );
}
