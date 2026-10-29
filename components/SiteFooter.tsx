import Link from "@/components/Link";
import Logo from "./Logo";
const COLS: [string, [string, string][]][] = [
  ["Product", [["Builder", "/app/new"], ["Paper trading", "/app/run/demo"], ["Skills", "/app/skills"], ["Markets", "/app/markets"], ["Docs", "/docs"]]],
  ["Community", [["Leaderboard", "/leaderboard"], ["Strategies", "/app/strategies"], ["Traders", "/app/traders"], ["Rewards", "/app/rewards"], ["X", "#"]]],
  ["Safety", [["Risk limits", "/app/risk"], ["Wallets", "/app/wallets"], ["How keys work", "/#safety"], ["Revenue", "/app/revenue"]]],
  ["Legal", [["Terms", "/terms"], ["Privacy", "/terms#privacy"], ["Eligibility", "/terms#eligibility"], ["Brand", "/brand"]]],
];
export default function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-16 sm:px-8 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-[26ch] text-[13.5px] leading-relaxed text-muted">Strategies that wait for the right moment, so you don’t have to.</p>
        </div>
        {COLS.map(([h, links]) => (
          <div key={h}>
            <div className="font-mono text-[12px] uppercase tracking-[.16em] text-muted">{h}</div>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              {links.map(([l, href]) => <li key={l}><Link prefetch={false} href={href} className="btn text-ink-2 hover:text-ink">{l}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-[1200px] border-t border-line px-5 py-6 text-[12px] leading-relaxed text-muted sm:px-8">
        Preview build with demo data. Trading can lose money; paper results don&apos;t predict live results. Stock tokens are not available to US persons and in some other regions. Quiver is not affiliated with Robinhood, Solana, Hyperliquid or Polymarket.
      </div>
    </footer>
  );
}
