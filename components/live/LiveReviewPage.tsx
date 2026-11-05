"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import Wrap from "@/components/Wrap";
import Link from "@/components/Link";
import SignInButton from "@/components/SignInButton";
import { api, ApiErr } from "@/lib/api";
import { raw } from "@/lib/api/live";
import { onSession } from "@/lib/api/session";
import { useQ } from "@/lib/api/useQ";
import { StrategyRecord } from "@/lib/contracts";
import { readPaperSession } from "@/lib/paper/sessions";
import { getHosted } from "@/lib/paper/hosted";
import { connected, NETWORK_DETAILS } from "@/lib/live-client";
import { liveRunPath } from "@/lib/live-navigation";
import { useLiveAccount } from "@/lib/use-live-account";
import {
  describeLiveStrategy,
  paperLivePlan,
  type LiveReview,
} from "@/services/backend/src/execution/live-review";
import LiveAllocation from "./LiveAllocation";
import LiveAccessPanel from "./LiveAccessPanel";

async function loadSource(
  id: string,
  version: number | null,
  production: boolean,
) {
  if (version !== null && (!Number.isSafeInteger(version) || version < 1))
    throw Error("This review link has an invalid revision.");
  const hosted = id.startsWith("srvpaper_");
  if (hosted || id.startsWith("paper_")) {
    if (hosted && !production)
      throw Error(
        "Connect your trading account to open this server paper session.",
      );
    const session = hosted
      ? (await getHosted(id)).session
      : readPaperSession(id);
    if (!session)
      throw Error("This paper session is unavailable on this device.");
    if (version === null)
      throw Error(
        "Open this review from the paper session to select its tested revision.",
      );
    const { strategy, omitted } = paperLivePlan(session, version);
    const review = hosted
      ? await connected<LiveReview>("/review", { strategyId: id, version })
      : describeLiveStrategy(id, version, strategy);
    return {
      review,
      strategy,
      omitted,
      label:
        "Paper session · Strategy v" +
        session.strategyVersion +
        " · Edit " +
        (session.editRevision ?? 0),
    };
  }
  if (!/^stg_[a-z0-9-]+$/i.test(id))
    throw Error("Choose a saved strategy or paper session.");
  const saved = await api.strategy(id);
  if (version !== null && saved.version !== version)
    throw Error(
      "The saved strategy changed. Reopen it to review the current rules.",
    );
  const review = production
    ? await connected<LiveReview>("/review", {
        strategyId: id,
        version: saved.version,
      })
    : describeLiveStrategy(id, saved.version, saved.strategy);
  return {
    review,
    strategy: saved.strategy,
    omitted: [],
    label: "Saved strategy · Version " + saved.version,
  };
}

export default function LiveReviewPage({
  id,
  version,
}: {
  id: string;
  version: number | null;
}) {
  const { account, production, enabled } = useLiveAccount();
  const router = useRouter();
  const [epoch, setEpoch] = useState(0);
  useEffect(() => onSession(() => setEpoch((n) => n + 1)), []);
  return (
    <ReviewContent
      key={epoch}
      {...{ id, version, production, enabled, account }}
      onStart={(run) => router.push(liveRunPath(run))}
    />
  );
}

function ReviewContent({
  id,
  version,
  production,
  enabled,
  account,
  onStart,
}: {
  id: string;
  version: number | null;
  production: boolean;
  enabled: boolean;
  account: ReturnType<typeof useLiveAccount>["account"];
  onStart: (id: string) => void;
}) {
  const isPaper = /^(srvpaper|paper)_/.test(id);
  const browserPaper = id.startsWith("paper_");
  const source = useQ(async () => {
    try {
      return await loadSource(id, version, production);
    } catch (e) {
      if (e instanceof ApiErr) throw e;
      throw new ApiErr(
        "conflict",
        e instanceof Error ? e.message : "Review unavailable.",
        409,
      );
    }
  }, [id, version, production]);
  const [copyError, setCopyError] = useState(""),
    [copying, setCopying] = useState(false);
  const [verified, setVerified] = useState<LiveReview | null>(null);
  const data = source.data;
  const review: LiveReview | undefined = verified ?? data?.review;
  const back = isPaper
    ? "/app/run/" + encodeURIComponent(id)
    : "/app/strategies";
  async function verifyBrowserCopy() {
    if (!data || !version || copying || !account.data) return;
    setCopying(true);
    setCopyError("");
    try {
      const current = readPaperSession(id);
      if (!current) throw Error("Reopen the original paper session.");
      const { strategy } = paperLivePlan(current, version);
      if (JSON.stringify(strategy) !== JSON.stringify(data.strategy))
        throw Error("The session changed. Review the current rules again.");
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify([id, version, strategy])),
      );
      const key = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const result = await raw("/strategies", {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ strategy }),
      });
      const record = StrategyRecord.parse(await result.json());
      const checked = await connected<LiveReview>("/review", {
        strategyId: record.id,
        version: record.version,
      });
      setVerified(checked);
    } catch (e) {
      setCopyError(
        e instanceof Error ? e.message : "Could not verify the browser rules.",
      );
    } finally {
      setCopying(false);
    }
  }
  const network = review?.stages.find((s) => s.network)?.network;
  return (
    <Wrap>
      <div className="live-desk live-review-page">
        <Link className="live-inline mb-4" href={back}>
          <ArrowLeft size={13} />
          {isPaper ? "Paper session" : "Saved strategies"}
        </Link>
        <header className="live-header">
          <div>
            <div className="live-eyebrow">
              {data?.label ?? "Strategy activation"}
            </div>
            <h1>Review &amp; go live</h1>
            <p>
              {isPaper
                ? "Start a separate live run with the rules tested in this paper session. Its virtual positions and fills stay in paper."
                : "Review the rules and choose the real funds available to this run."}
            </p>
          </div>
        </header>
        {!review ? (
          <section className="live-box live-runs mt-4">
            <p role="status">{source.error || "Loading the selected rules…"}</p>
            {source.auth ? (
              <SignInButton onDone={source.reload} />
            ) : (
              source.error && (
                <Link className="q-action mt-3" href={back}>
                  Return to source
                </Link>
              )
            )}
          </section>
        ) : (
          <div className="live-grid mt-5">
            <section className="live-box live-runs">
              {data?.omitted.length ? (
                <p className="live-note mb-3">
                  Excluded paused entries and their dependent stages ·{" "}
                  {data.omitted.join(", ")}
                </p>
              ) : null}
              {browserPaper && enabled && account.data && !verified && (
                <div className="live-bridge">
                  <p>
                    Verify a private account copy of these browser rules to
                    unlock wallet authorization.
                  </p>
                  <button
                    className="q-action"
                    disabled={copying}
                    onClick={verifyBrowserCopy}
                  >
                    {copying ? "Verifying rules…" : "Verify these rules"}
                  </button>
                  {copyError && <p role="alert">{copyError}</p>}
                </div>
              )}
              <LiveAllocation
                key={review.reviewHash ?? id}
                review={review}
                account={account.data}
                connectedApi={enabled}
                onStart={onStart}
                beforeStart={
                  browserPaper
                    ? () => {
                        const s = readPaperSession(id);
                        if (
                          !s ||
                          !version ||
                          JSON.stringify(paperLivePlan(s, version).strategy) !==
                            JSON.stringify(data?.strategy)
                        )
                          throw Error(
                            "The paper session changed. Open its latest review before starting.",
                          );
                      }
                    : undefined
                }
              />
            </section>
            <aside className="live-right">
              <section className="live-box live-runs">
                <div className="live-card-top">
                  <h2>Execution account</h2>
                  <SlidersHorizontal size={16} />
                </div>
                <p className="live-note">
                  {network
                    ? NETWORK_DETAILS[network].label +
                      (new Set(review.stages.map((s) => s.network)).size > 1
                        ? " + linked venues"
                        : "")
                    : "Selected venues"}{" "}
                  · Mainnet
                </p>
                <p className="live-note">
                  {!production
                    ? "Production wallet activation is pending. You can review amounts and order permissions here."
                    : account.data?.consent && !account.data.paused
                      ? "Account limits are active. Each allocation remains subject to your available balance."
                      : "Complete wallet setup and account limits here before authorizing a run."}
                </p>
              </section>
              {production && (
                <LiveAccessPanel
                  account={account.data}
                  network={network ?? undefined}
                  onChange={account.reload}
                />
              )}
            </aside>
          </div>
        )}
      </div>
    </Wrap>
  );
}
