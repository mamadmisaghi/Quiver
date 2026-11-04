"use client";
import Link from "@/components/Link";
import Wrap from "@/components/Wrap";
import SignInButton from "@/components/SignInButton";
import LiveReceiptPanel from "./LiveReceiptPanel";
import { useLiveAccount } from "@/lib/use-live-account";
export default function LiveRunPage({ id }: { id: string }) {
  const { account, production } = useLiveAccount();
  return (
    <Wrap>
      <div className="live-desk">
        <Link href="/app/live" className="live-inline mb-4">
          ← Trading account
        </Link>
        <header className="live-header">
          <div>
            <h1>Live run</h1>
            <p>
              Follow your rules, review pending signatures and track venue
              fills.
            </p>
          </div>
        </header>
        <div className="live-detail">
          {!/^live_[a-f0-9]{28}$/.test(id) ? (
            <p>Live run not found.</p>
          ) : account.data ? (
            <LiveReceiptPanel
              runId={id}
              account={account.data}
              onChange={account.reload}
            />
          ) : (
            <div className="live-box live-runs">
              <p>
                {!production
                  ? "Connect the production account to view a real run."
                  : account.error || "Loading your trading account…"}
              </p>
              {account.auth && <SignInButton onDone={account.reload} />}
            </div>
          )}
        </div>
      </div>
    </Wrap>
  );
}
