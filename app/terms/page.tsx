import type { Metadata } from "next";
import Link from "@/components/Link";
import DocPage, { type DocSection } from "@/components/DocPage";

export const metadata: Metadata = { title: "Terms — Quiver", description: "Draft terms of use, privacy notes and eligibility for the Quiver beta." };

// DRAFT copy pending counsel review (SIGNOFF §4 / §7: TERMS_VERSION must be final before mainnet). Not legal advice.
const sections: DocSection[] = [
  { id: "beta", title: "This is a beta", body: <>
    <p>Quiver is a preview. Most of what you see runs on paper and demo data. Features can change or stop without notice, and live trading isn’t open yet.</p>
  </> },
  { id: "not-advice", title: "Not financial advice", body: <>
    <p>Quiver is software that runs rules you write. It doesn’t recommend trades, and nothing on the site is investment, legal or tax advice. Trading can lose money. Paper results and backtests don’t predict live results.</p>
  </> },
  { id: "your-account", title: "Your wallet and keys", body: <>
    <p>Your funds stay in a smart account you own. You choose what a session key can do and you can revoke it at any time. Quiver can’t withdraw or transfer your funds, and you’re responsible for your own wallet and its recovery.</p>
  </> },
  { id: "eligibility", title: "Eligibility", body: <>
    <p>You must be of legal age where you live. Stock tokens are not available to US persons and are restricted in Canada, the UK, Switzerland, the UAE and sanctioned countries. Hyperliquid and Polymarket have their own restrictions, which also apply.</p>
    <p>Don’t use a VPN or proxy to get around these rules. We may block access where we can’t confirm eligibility.</p>
  </> },
  { id: "third-party", title: "Third-party services", body: <>
    <p>Trades route through venues and data providers we don’t control — including Robinhood Chain, Uniswap, 0x, Jupiter, Hyperliquid, Chainlink and Polymarket. Their terms apply to your use of them. Quiver isn’t affiliated with any of them.</p>
  </> },
  { id: "fees", title: "Fees", body: <>
    <p>Live fills carry a 0.30% Quiver fee on executed notional, plus venue fees and network gas. Paper and backtests show fees but charge nothing.</p>
  </> },
  { id: "privacy", title: "Privacy", body: <>
    <p>We keep what’s needed to run your strategies and keep the service safe: your wallet address, strategies and runs, an eligibility record (country, self-declaration, terms version), and request logs. Your prompts are sent to our AI provider to draft strategies.</p>
    <p>We don’t sell your data. We never ask for or store your private keys.</p>
  </> },
  { id: "changes", title: "Changes and contact", body: <>
    <p>We’ll update these terms as the product changes; the version date at the top tells you which one you agreed to. Questions go to us on X. For how the product actually works, read the <Link href="/docs" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-current">docs</Link>.</p>
  </> },
];

export default function TermsPage() {
  return <DocPage eyebrow="Legal" title="Terms, privacy and eligibility" lead="The plain version of what you agree to when you use the Quiver beta." meta={<><span className="text-warn">Draft</span> · pending legal review · version draft-2026-10</>} sections={sections} />;
}
