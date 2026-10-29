import type { Metadata } from "next";
import Link from "@/components/Link";
import DocPage, { Code, Kv, Steps, type DocSection } from "@/components/DocPage";

export const metadata: Metadata = { title: "Docs — Quiver", description: "How Quiver turns a sentence into rules, checks them every 15 seconds, and trades only inside the limits you sign." };

const sections: DocSection[] = [
  { id: "overview", title: "The short version", body: <>
    <p>You write what you think will happen. Quiver turns it into a strategy: what to watch, when to act, what to do, and when to get out. You read that back in plain English before anything runs.</p>
    <p>The AI only drafts. It can’t place orders, move money or start a run. A separate, deterministic engine checks your rules on a fixed loop, and a risk gate stands between every trigger and every trade.</p>
    <p>Everything starts on paper. Testnet comes next, then mainnet behind a waitlist.</p>
  </> },
  { id: "compile", title: "From a sentence to rules", body: <>
    <Steps items={[
      "Your text is length-limited, stripped of links and markup, and treated as untrusted input.",
      "The model names a symbol and a venue. Our own registry maps it to a real instrument — the model never writes an address.",
      "The draft has to pass a strict schema, then semantic checks: references resolve, no loops, the venue can trade it, leverage is within caps.",
      "If it fails, the model gets the list of problems and two more tries. After that you see exactly what it couldn’t do.",
      "The Watch / When / Do / Exit card you approve is written by code from the final strategy, not by the model.",
    ]} />
    <p>Each compile is capped at three attempts. You get 30 drafts a day.</p>
  </> },
  { id: "engine", title: "How the engine checks", body: <>
    <p>Every active run gets a cycle every 15 seconds. A fresh Chainlink update for something you watch can wake it sooner, at most once every 2 seconds.</p>
    <Steps items={[
      "Take a snapshot of every signal. Anything older than its max age becomes unknown — and an unknown condition never fires.",
      <>Evaluate each trigger. A condition has to hold for its full <Code>forMinutes</Code> before it fires.</>,
      "Fire, cool down, and stop after the trigger’s max fires.",
      "Each fired action becomes an order intent with an idempotency key, so a retry can’t double-trade.",
    ]} />
    <p>Strategies freeze when a run starts. An edit makes a new version; the running one doesn’t change under you.</p>
  </> },
  { id: "risk", title: "The risk gate", body: <>
    <p>Every intent passes these checks in order. The first failure stops it and shows up in your run log.</p>
    <Kv rows={[["1 · Kill switch", "Stop everything, now"], ["2 · Eligibility", "Stock tokens only where they’re allowed"], ["3 · Market session", "Skip when an equity feed is stale"], ["4 · Orders per day", "Your cap"], ["5 · Position size", "Max % per position and in total"], ["6 · Daily loss", "Halt for the day past your limit"], ["7 · Session key caps", "Per trade and per day, checked again on-chain"], ["8 · Quote sanity", "Quote must sit near the oracle price"]]} />
  </> },
  { id: "paper", title: "Paper trading", body: <>
    <p>Paper fills use the real venue quote for your exact size, requested but never sent. Slippage is the quote’s price impact plus a latency penalty of at least 2 bps.</p>
    <p>Fees are included: the venue fee, estimated gas, and Quiver’s 0.30% — shown, never charged. If a quote would breach your max slippage, the fill is rejected rather than filled worse. Every paper run starts with $10,000.</p>
  </> },
  { id: "backtest", title: "Backtests", body: <>
    <p>The backtester replays the same engine over history. Signals only see bars that had closed; fills happen at the next bar’s open; fees are always on.</p>
    <p>Stock tokens have on-chain history only from July 2026. Anything earlier is modeled from end-of-day equity data and labeled <span className="text-warn">Modeled</span>. A backtest is a sanity check, not a forecast.</p>
  </> },
  { id: "keys", title: "Session keys", body: <>
    <p>To trade live on Robinhood Chain, you grant a session key to your own smart account. It can swap. It can’t send.</p>
    <Kv rows={[["Can call", "Approved swap routers only"], ["Output goes to", "Your account — always"], ["Per trade", "$250 by default"], ["Per day", "$1,000 by default, at most 64 × per trade"], ["Min swap", "Per day ÷ 64 → $15.63 at the defaults"], ["Max slippage", "1% account cap, up to 10% if you raise it"], ["Expiry", "7 days by default, 30 at most"], ["Transfers", "Native and token transfers blocked"]]} />
    <Steps items={["Quiver prepares the key and the exact policy.", "You sign it in your wallet. The terms are shown in plain English first.", "The key installs on-chain and turns active.", "Revoke it any time — every run on that key halts at once."]} />
    <p>The key is held by a managed signer and is never stored in plain text. Withdrawals are yours alone; Quiver never builds them. See <Link href="/#safety" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-current">Safety</Link> for the full policy sheet.</p>
  </> },
  { id: "venues", title: "Venues", body: <>
    <Kv rows={[["Robinhood Chain", "Stock tokens and crypto · session key, enforced on-chain"], ["Hyperliquid", "Perps · agent wallet that can trade, not withdraw"], ["Solana", "Swaps via Jupiter · delegated signer, provider-enforced"], ["Polymarket", "Odds as a signal · read-only, no key"]]} />
    <p>Solana’s limits are enforced by the signing provider, not by a program. That’s weaker than Robinhood Chain, and we’ll always say so where it matters.</p>
  </> },
  { id: "eligibility", title: "Eligibility", body: <>
    <p>Stock tokens aren’t available to US persons and are restricted in Canada, the UK, Switzerland and the UAE. Live stock-token trading needs a self-declaration and an IP check; VPN and hosting traffic counts as unknown and is blocked.</p>
    <p>Paper trading, backtests and drafts work everywhere. Restricted tokens stay visible, marked as not tradable.</p>
  </> },
  { id: "fees", title: "Fees", body: <>
    <p>Quiver takes 0.30% of executed notional on live fills, inside the same transaction. Paper and backtests show the fee and charge nothing. You pay network gas from your account.</p>
  </> },
];

export default function DocsPage() {
  return <DocPage eyebrow="Docs" title="How Quiver works" lead="Ten short sections: what happens between the sentence you type and the trade that does — or doesn’t — go out." meta="Beta · paper trading only · testnet next" sections={sections} />;
}
