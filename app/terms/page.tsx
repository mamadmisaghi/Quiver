import type { Metadata } from "next";
import Link from "@/components/Link";
import DocPage, { type DocSection } from "@/components/DocPage";

export const metadata: Metadata = {
  title: "Terms — Quiver",
  description:
    "Wallet permissions, order execution, fees and eligibility for Quiver.",
};
const sections: DocSection[] = [
  {
    id: "controls",
    title: "Paper and live trading",
    body: (
      <>
        <p>
          Paper sessions use a virtual balance. To trade with funds, open Live
          trading, select a saved strategy and review its markets, funding
          wallets, execution mode and limits. Live execution requires a
          connected production account.
        </p>
        <p>
          You choose the rules and take responsibility for the orders you
          authorize. Markets can move, liquidity can disappear, and an order may
          fill partially or fail. Leveraged trading can lose the collateral you
          commit. Paper results and historical replays cannot predict your live
          return.
        </p>
      </>
    ),
  },
  {
    id: "wallet",
    title: "Your wallet and permissions",
    body: (
      <>
        <p>
          You sign orders with the wallet shown in the order review. On
          supported routes you can grant permission to trade within the
          displayed scope. Hyperliquid agent permissions apply at the venue.
          Quiver separately checks your strategy limits before each new
          dispatch. Solana automation uses a dedicated signer policy and a token
          allowance.
        </p>
        <p>
          Review the network, assets, quantities, fees and expiry in your
          wallet. Keep your recovery phrase private. Your wallet provider
          manages recovery.
        </p>
      </>
    ),
  },
  {
    id: "pause",
    title: "Stopping or revoking",
    body: (
      <>
        <p>
          Pausing stops new entries. An order already sent can still settle, and
          an open position can continue to gain or lose value. Review pending
          receipts and close positions separately. Revoke venue agents and token
          allowances in the wallet controls when you no longer need them.
        </p>
        <p>
          Exit rules that require a running observer, available liquidity or a
          wallet signature can be delayed. You can inspect the position and
          manage it at its venue.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility",
    body: (
      <>
        <p>
          You must meet the age, residency and access requirements of the venues
          you use. Give accurate eligibility information. Stock-token orders
          require a supported location and a matching eligibility declaration.
          Access can be withheld when verification is unavailable.
        </p>
      </>
    ),
  },
  {
    id: "fees",
    title: "Fees",
    body: (
      <>
        <p>
          This release charges no Quiver platform fee on live trades. Your venue
          may charge trading fees and your network may charge for transactions,
          including approvals or failed transactions. Review the estimate before
          signing. Paper fees are modeled amounts paid from the virtual balance.
        </p>
      </>
    ),
  },
  {
    id: "privacy",
    title: "What Quiver records",
    body: (
      <>
        <p>
          Quiver processes wallet addresses, strategies, venue authorizations,
          trade receipts, eligibility records and operational logs. Your
          strategy prompt may be sent to the model provider to draft the rules.
          A position or transaction on a public network may also be visible
          outside Quiver.
        </p>
        <p>
          Linking a wallet does not require sharing its private key. Opting into
          unattended trading creates a separate execution credential. Quiver
          encrypts its signer material at rest and uses it under the permissions
          you approve.
        </p>
      </>
    ),
  },
  {
    id: "venues",
    title: "Venue terms and trading information",
    body: (
      <>
        <p>
          The connected venues, wallets and data providers have their own terms.
          Quiver provides software for strategies you choose. It does not
          provide investment, legal or tax advice.
        </p>
        <p>
          <Link
            href="/docs"
            className="text-accent underline underline-offset-4"
          >
            Read how Quiver executes a strategy
          </Link>
        </p>
      </>
    ),
  },
];
export default function TermsPage() {
  return (
    <DocPage
      eyebrow="Legal"
      title="Terms, privacy and eligibility"
      lead="The permissions you grant, the records we keep and the costs of an order."
      meta="Live execution controls · live-controls-v1"
      sections={sections}
    />
  );
}
