import Link from "@/components/Link";
import Logo from "./Logo";
import MobileMenu from "./MobileMenu";
export const SITE_NAV = [["/#how", "How it works"], ["/#trades", "Markets"], ["/#paper", "Paper trading"], ["/#safety", "Safety"], ["/#token", "$QUIVR"], ["/app/skills", "Skills"], ["/leaderboard", "Leaderboard"], ["/docs", "Docs"]] as const;
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
        <Link prefetch={false} href="/" className="flex min-h-11 items-center" aria-label="Quiver home"><Logo /></Link>
        <nav aria-label="Main" className="hidden items-center gap-6 text-[13.5px] text-muted lg:flex">
          {SITE_NAV.map(([h, l]) => <Link key={h} prefetch={false} href={h} className="btn hover:text-ink">{l}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link prefetch={false} href="/app/new" className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:brightness-110 active:bg-accent-press">Open app</Link>
          <MobileMenu links={SITE_NAV} />
        </div>
      </div>
    </header>
  );
}
