import type { Metadata } from "next";
import Link from "@/components/Link";
import DocPage, { Code, Kv, Steps, type DocSection } from "@/components/DocPage";

export const metadata: Metadata = { title: "Docs — Quiver", description: "How Quiver turns a sentence into rules, checks them every 15 seconds, and trades only inside the limits you sign." };

const sections: DocSection[] = [
  { id: "overview", title: "The short version", body: <>
    <p>You write what you think will happen. Quiver turns it into a strategy: what to watch, when to act, what to do, and when to get out. You read that back in plain English before anything runs.</p>
    <p>The AI only drafts. It can’t place orders, move money or start a run. A separate, deterministic engine checks your rules on a fixed loop, and a risk gate stands between every trigger and every trade.</p>
    <p>You can test with virtual funds or take a saved strategy into Live trading. The order review shows the funding wallet, market, size and permissions for each venue.</p>
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
    <p>The production observer checks running strategies on the server. When an observation is missing or stale, a condition waits for fresh data.</p>
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
    <p>A paper session starts with a virtual balance. The observer checks the selected markets and records virtual fills when the saved rules trigger. Its activity log shows the observations and decisions.</p>
    <p>The session reports modeled fees and equity separately. Keep an eye on the observation status and timestamps when comparing paper results with the market.</p>
  </> },
  { id: "backtest", title: "Backtests", body: <>
    <p>The backtester replays the same engine over history. Signals only see bars that had closed; fills happen at the next bar’s open; fees are always on.</p>
    <p>Stock tokens have on-chain history only from July 2026. Anything earlier is modeled from end-of-day equity data and labeled <span className="text-warn">Modeled</span>. A backtest is a sanity check, not a forecast.</p>
  </> },
  { id: "keys", title: "Signing a live strategy", body: <>
    <Steps items={["Open a saved strategy in Live trading and review its frozen version.", "Select a funding wallet for each venue and set trading and network fee limits.", "Review and sign each order, or grant a supported venue authority before enabling automation.", "Follow confirmations in the run. A dependent stage waits for the receipt required by its rule."]} />
    <p>Pause new entries or revoke a grant from the live desk. Existing orders and positions remain visible for reconciliation or closing. Revoke a token allowance separately when it is no longer needed.</p>
  </> },
  { id: "venues", title: "Venues", body: <>
    <Kv rows={[["Hyperliquid", "Perpetuals with individual order signatures or a trade-only venue agent"], ["Solana", "Wallet-signed Jupiter swaps. Scoped automation for eligible direct USDC pools on Raydium."], ["Robinhood Chain", "Eligible stock tokens through Uniswap. The owner signs approvals and swaps separately."], ["Polymarket", "Selected prediction-market outcomes supply signals."]]} />
    <p>Funding stays on its own venue. A Solana leg and a perpetual leg each need funds in the corresponding account. Each receipt is matched to its network and order.</p>
  </> },
  { id: "eligibility", title: "Eligibility", body: <>
    <p>Stock-token trading requires a supported location and a matching eligibility declaration. Each venue also applies its own restrictions.</p>
    <p>Paper trading, backtests and drafts work everywhere. Restricted tokens stay visible, marked as not tradable.</p>
  </> },
  { id: "fees", title: "Fees", body: <>
    <p>Quiver charges no platform fee on these live routes. Your venue may charge trading fees, and network transactions can use gas even when they fail. Your wallet shows the order and applicable limits before signing.</p>
  </> },
];

export default function DocsPage() {
  return <DocPage eyebrow="Docs" title="How Quiver works" lead="Follow your strategy from the rules you write through the receipt for a trade." meta="Paper trading · wallet-authorized live execution" sections={sections} />;
}
