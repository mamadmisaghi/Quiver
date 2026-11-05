"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Pause,
  Wallet,
} from "lucide-react";
import Link from "@/components/Link";
import SignInButton from "@/components/SignInButton";
import { useTradingWallets } from "@/components/auth/WalletRuntime";
import { API_MODE } from "@/lib/api";
import { onSession } from "@/lib/api/session";
import {
  connected,
  NETWORK_DETAILS,
  money,
  shortAddress,
  timestamp,
  type Account,
  type Balance,
  type GrantPrompt,
  type Limits,
  type LiveNetwork,
} from "@/lib/live-client";
import { signHyperliquidOwner } from "@/lib/wallet/live-evm";
import { signHlRevoke } from "@/lib/wallet/live-hl-owner";

type Props = {
  account: Account | null;
  onChange: () => void | Promise<void>;
  network?: LiveNetwork;
};
const label = "grid min-w-0 gap-1.5 text-[12px] text-muted";
const field =
  "w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const quiet = "text-[13px] leading-relaxed text-muted";
const action = "q-action";
const initLimits = (account: Account) =>
  account.consent?.limits ?? {
    maxOrderUsd: Math.min(25, account.platformDailyCapUsd),
    dailyUsd: Math.min(100, account.platformDailyCapUsd),
    maxLeverage: 3,
    maxSlippageBps: 50,
  };
function ConsentForm({
  account,
  disabled,
  save,
}: {
  account: Account;
  disabled: boolean;
  save: (region: string, nonUs: boolean, limits: Limits) => Promise<void>;
}) {
  const [residence, setResidence] = useState(account.consent?.residence ?? "");
  const [nonUs, setNonUs] = useState(account.consent?.nonUs ?? false),
    [accepted, setAccepted] = useState(false);
  const base = initLimits(account);
  const [maxOrder, setOrder] = useState(String(base.maxOrderUsd)),
    [daily, setDaily] = useState(String(base.dailyUsd)),
    [lev, setLev] = useState(String(base.maxLeverage)),
    [slip, setSlip] = useState(String(base.maxSlippageBps / 100));
  const canSend =
    accepted &&
    !!account.region &&
    residence.trim().toUpperCase() === account.region;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled || !canSend) return;
    const limits = {
      maxOrderUsd: Number(maxOrder),
      dailyUsd: Number(daily),
      maxLeverage: Number(lev),
      maxSlippageBps: Math.round(Number(slip) * 100),
    };
    await save(residence, nonUs, limits);
  }
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3">
      <p className={quiet}>
        These limits apply across your live runs. Each run also has its own
        venue budget.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Maximum order notional · USD
          <input
            className={field}
            type="number"
            inputMode="decimal"
            min="0.01"
            max={Math.min(Number(daily), account.platformDailyCapUsd, 100000)}
            step="0.01"
            placeholder="25.00"
            required
            value={maxOrder}
            onChange={(e) => setOrder(e.target.value)}
          />
        </label>
        <label className={label}>
          24-hour notional cap · USD
          <input
            className={field}
            type="number"
            inputMode="decimal"
            min={Math.max(Number(maxOrder), 0.01)}
            max={account.platformDailyCapUsd}
            step="0.01"
            required
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
          />
        </label>
        <label className={label}>
          Maximum isolated leverage
          <input
            className={field}
            type="number"
            inputMode="numeric"
            min="1"
            max="100"
            step="1"
            required
            value={lev}
            onChange={(e) => setLev(e.target.value)}
          />
        </label>
        <label className={label}>
          Maximum slippage · %
          <input
            className={field}
            type="number"
            inputMode="decimal"
            min="0.01"
            max="5"
            step="0.01"
            required
            value={slip}
            onChange={(e) => setSlip(e.target.value)}
          />
        </label>
      </div>
      <div className="border-t border-line pt-3">
        <label className={label}>
          Country of residence
          <input
            className={field + " max-w-48 uppercase"}
            autoComplete="country"
            placeholder="Two-letter code"
            pattern="[A-Z]{2}"
            maxLength={2}
            required
            value={residence}
            onChange={(e) => setResidence(e.target.value.trim().toUpperCase())}
          />
        </label>
        <p className="mt-1.5 text-xs text-muted">
          {account.region
            ? "Verified network location · " + account.region
            : "Waiting for verified network location from the connected site."}
        </p>
      </div>
      <label className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-2">
        <input
          type="checkbox"
          className="mt-1 accent-accent"
          checked={nonUs}
          disabled={disabled}
          onChange={(e) => setNonUs(e.target.checked)}
        />
        I am a non-US person. This declaration is required for restricted
        venues.
      </label>
      <label className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-2">
        <input
          type="checkbox"
          className="mt-1 accent-accent"
          checked={accepted}
          disabled={disabled}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>
          I accept the{" "}
          <Link href="/terms" className="underline">
            trading disclosures
          </Link>{" "}
          ({account.termsVersion}) and these limits for real orders I authorize.
        </span>
      </label>
      <button
        type="submit"
        className="q-action q-primary justify-center"
        disabled={disabled || !canSend}
      >
        {account.paused
          ? "Reopen account under these limits"
          : account.consent
            ? "Save live limits"
            : "Enable reviewed live trading"}
      </button>
    </form>
  );
}

export default function LiveAccessPanel({
  account,
  onChange,
  network = "hyperliquid-mainnet",
}: Props) {
  const wallet = useTradingWallets(),
    hintId = useId();
  const [net, setNet] = useState<LiveNetwork>(network),
    [chosen, setChosen] = useState(""),
    [hours, setHours] = useState("8");
  const [balance, setBalance] = useState<Balance | null>(null),
    [busy, setBusy] = useState(false),
    [ok, setOk] = useState(""),
    [error, setError] = useState("");
  const [ackAgent, setAckAgent] = useState(false),
    [copied, setCopied] = useState(false);
  const lock = useRef(false),
    epoch = useRef(0);
  const handles =
      net === "solana-mainnet"
        ? (account?.solanaWallets ?? [])
        : (account?.evmWallets ?? []),
    address = handles.includes(chosen) ? chosen : (handles[0] ?? "");
  useEffect(() => {
    setNet(network);
  }, [network]);
  useEffect(() => {
    setBalance(null);
    setAckAgent(false);
    setCopied(false);
    setOk("");
    setError("");
    epoch.current++;
  }, [address, net]);
  useEffect(() => {
    const off = onSession(() => {
      epoch.current++;
      setBalance(null);
      setChosen("");
      setOk("");
      setError("");
      setAckAgent(false);
    });
    return () => {
      off();
      epoch.current++;
    };
  }, []);
  async function run(
    fn: (guard: () => void) => Promise<string>,
    reload = true,
  ) {
    if (lock.current) return;
    lock.current = true;
    const ticket = epoch.current;
    setBusy(true);
    setError("");
    setOk("");
    try {
      const message = await fn(() => {
        if (ticket !== epoch.current)
          throw Error("The selected account changed.");
      });
      if (ticket === epoch.current) {
        setOk(message);
        if (reload) await onChange();
      }
    } catch (e) {
      if (ticket === epoch.current)
        setError(
          e instanceof Error ? e.message : "Request could not be verified.",
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function consent(residence: string, nonUs: boolean, limits: Limits) {
    if (!account) return;
    await run(async () => {
      await connected("/consent", {
        version: account.termsVersion,
        residence,
        nonUs,
        acceptRealFunds: true,
        limits,
      });
      return "Live account limits saved.";
    });
  }
  const currentGrant = account?.agent;
  const getBalance = () =>
    run(async (guard) => {
      const sample = await connected<Balance>(
        "/wallet/balance?network=" +
          encodeURIComponent(net) +
          "&wallet=" +
          encodeURIComponent(address),
      );
      if (
        sample.network !== net ||
        sample.wallet.toLowerCase() !== address.toLowerCase() ||
        (net === "solana-mainnet" && sample.wallet !== address)
      )
        throw Error("Wallet balance did not match this account.");
      guard();
      setBalance(sample);
      return "";
    }, false);
  const manageGrant = () =>
    run(async (guard) => {
      if (!ackAgent || !address)
        throw Error("Review the grant before authorizing.");
      const signer = await wallet.selectEvm(address);
      guard();
      const grant = await connected<GrantPrompt>("/hyperliquid/grant", {
        master: address,
        hours: Number(hours),
        realTradingAuthority: true,
      });
      if (
        grant.network !== "mainnet" ||
        grant.master.toLowerCase() !== address.toLowerCase()
      )
        throw Error("The grant belongs to another wallet or network.");
      guard();
      const sig = await signHyperliquidOwner(signer, {
        ...grant,
        purpose: "authorize",
      });
      guard();
      await connected("/hyperliquid/activate", { signature: sig });
      setAckAgent(false);
      return "Hyperliquid verified the owner’s agent grant.";
    });
  const revoke = () =>
    run(async (guard) => {
      if (!currentGrant) throw Error("No live grant for this account.");
      const signer = await wallet.selectEvm(currentGrant.master);
      guard();
      const p = await connected<GrantPrompt | { revoked: true }>(
        "/hyperliquid/revoke-request",
        {},
      );
      if ("revoked" in p) return "The exchange already removed this agent.";
      if (
        p.network !== "mainnet" ||
        p.master.toLowerCase() !== currentGrant.master.toLowerCase()
      )
        throw Error("Revocation belongs to another wallet.");
      if (!currentGrant.slotName || !currentGrant.nonce)
        throw Error("Refresh the original grant identity before revoking.");
      guard();
      const signature = await signHlRevoke(signer, p, {
        agent: currentGrant.agent,
        name: currentGrant.slotName,
        nonce: currentGrant.nonce,
      });
      guard();
      const answer = await connected<Account>("/hyperliquid/revoke", {
        signature,
      });
      return answer.agent?.state === "revoked"
        ? "Hyperliquid verified revocation."
        : "The local signer is disabled. Exchange revocation is being verified.";
    });
  const details = NETWORK_DETAILS[net];
  const recent =
    account?.consent &&
    account.consent.version === account.termsVersion &&
    !account.paused;
  return (
    <section
      className="q-card min-w-0 overflow-hidden border border-line bg-card"
      aria-labelledby={hintId}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-accent" aria-hidden />
          <h2 id={hintId} className="font-medium">
            Wallet &amp; risk limits
          </h2>
        </div>
        <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">
          {account
            ? account.paused
              ? "Paused"
              : recent
                ? "Enabled"
                : "Setup required"
            : "Wallet setup"}
        </span>
      </header>
      {!account ? (
        <div className="grid gap-3 p-5">
          <p className={quiet}>
            {API_MODE === "live"
              ? "Sign in to link your own wallets and set limits for live orders."
              : "You can review your strategy and mainnet data here. Wallet authorization opens when the trading API is connected."}
          </p>
          {API_MODE === "live" ? (
            <div>
              <SignInButton onDone={() => void onChange()} />
            </div>
          ) : (
            <Link className={action + " w-fit"} href="/app/wallets">
              View wallet setup <ArrowUpRight size={14} />
            </Link>
          )}
        </div>
      ) : (
        <div className="divide-y divide-line">
          <div className="grid gap-3 p-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_minmax(0,1.4fr)]">
              <label className={label}>
                Venue
                <select
                  className={field}
                  value={net}
                  onChange={(e) => setNet(e.target.value as LiveNetwork)}
                >
                  {(Object.keys(NETWORK_DETAILS) as LiveNetwork[]).map((n) => (
                    <option key={n} value={n}>
                      {NETWORK_DETAILS[n].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Linked {net === "solana-mainnet" ? "Solana" : "EVM"} wallet
                <select
                  className={field + " font-mono"}
                  disabled={!handles.length}
                  value={address}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  {!handles.length && (
                    <option value="">No wallet linked</option>
                  )}
                  {handles.map((a) => (
                    <option key={a} value={a}>
                      {shortAddress(a)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className={action}
                type="button"
                disabled={busy || !wallet.ready}
                onClick={() =>
                  void run(async () => {
                    await wallet.link(
                      net === "solana-mainnet" ? "solana" : "ethereum",
                    );
                    return "Wallet linked and authenticated.";
                  })
                }
              >
                Link {net === "solana-mainnet" ? "Solana" : "EVM"} wallet
              </button>
              {address && (
                <button
                  className={action}
                  type="button"
                  disabled={busy}
                  onClick={() => void getBalance()}
                >
                  Read venue balance
                </button>
              )}
            </div>
            {balance && (
              <div
                className="flex flex-wrap items-end justify-between gap-2 rounded-lg bg-bg p-3 text-sm"
                aria-live="polite"
              >
                <div>
                  <span className="block text-xs text-muted">
                    Available collateral
                  </span>
                  <strong className="font-mono font-medium">
                    {balance.stable} {details.unit}
                  </strong>
                  {balance.native != null && (
                    <div className="mt-1 text-xs text-muted">
                      {balance.native} {details.feeUnit} for network fees
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-muted">
                  Read {timestamp(balance.observedAt)}
                </span>
              </div>
            )}
            {address && (
              <details className="group rounded-lg border border-line px-3 py-2.5">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
                  Funding instructions{" "}
                  <ChevronDown
                    size={15}
                    aria-hidden
                    className="group-open:rotate-180"
                  />
                </summary>
                <p className={"mt-2 " + quiet}>
                  {net === "hyperliquid-mainnet"
                    ? "Fund the account’s perpetual balance through Hyperliquid’s deposit flow. The exchange reports its available USDC here."
                    : net === "solana-mainnet"
                      ? "Fund this Solana mainnet wallet with USDC and SOL for fees. Confirm the network and wallet address before transferring."
                      : "Fund this wallet on Robinhood Chain 4663 with USDG for trading and ETH for fees."}
                </p>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-[11px] text-ink-2">
                    {address}
                  </span>
                  <button
                    type="button"
                    className="q-action"
                    disabled={busy}
                    aria-label="Copy selected wallet address"
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(address);
                        setCopied(true);
                        return "Wallet address copied.";
                      }, false)
                    }
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <a
                  href={details.fund}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-accent"
                >
                  Official funding guide <ArrowUpRight size={12} />
                </a>
              </details>
            )}
          </div>
          <details
            className="group p-5"
            open={!recent || undefined}
            key={String(account.paused) + "-" + (account.consent?.at ?? "new")}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="text-sm font-medium">Live order limits</span>
              {account.consent && (
                <span className="ml-auto text-xs text-muted">
                  {money(account.consent.limits.maxOrderUsd)} per order
                </span>
              )}
              <ChevronDown className="group-open:rotate-180" size={15} />
            </summary>
            <ConsentForm account={account} disabled={busy} save={consent} />
          </details>
          {net === "hyperliquid-mainnet" && (
            <details className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <KeyRound size={14} />
                  Trading agent
                </span>
                <span className="ml-auto text-xs text-muted">
                  {currentGrant?.state ?? "Optional"}
                </span>
                <ChevronDown size={15} className="group-open:rotate-180" />
              </summary>
              {currentGrant && (
                <p className={"mt-3 " + quiet}>
                  Owner{" "}
                  <span className="font-mono">
                    {shortAddress(currentGrant.master)}
                  </span>{" "}
                  · agent{" "}
                  <span className="font-mono">
                    {shortAddress(currentGrant.agent)}
                  </span>{" "}
                  · expires {timestamp(currentGrant.validUntil)}
                </p>
              )}
              {(!currentGrant ||
                ["pending", "expired", "revoked"].includes(
                  currentGrant.state,
                )) && (
                <div className="mt-3 grid gap-3">
                  <label className={label}>
                    Authority expires after
                    <select
                      className={field}
                      value={hours}
                      disabled={busy}
                      onChange={(e) => {
                        setHours(e.target.value);
                        setAckAgent(false);
                      }}
                    >
                      {[1, 8, 24].map((h) => (
                        <option key={h} value={h}>
                          {h} {h === 1 ? "hour" : "hours"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-2">
                    <input
                      className="mt-1 accent-accent"
                      type="checkbox"
                      checked={ackAgent}
                      disabled={busy}
                      onChange={(e) => setAckAgent(e.target.checked)}
                    />
                    I authorize a named agent to trade on this Hyperliquid
                    mainnet account. Quiver enforces my spend limits and
                    strategy rules on its server.
                  </label>
                  <button
                    type="button"
                    className={action}
                    disabled={busy || !recent || !address || !ackAgent}
                    onClick={() => void manageGrant()}
                  >
                    Authorize mainnet agent
                  </button>
                </div>
              )}
              {currentGrant &&
                ["active", "checking", "disabled"].includes(
                  currentGrant.state,
                ) && (
                  <button
                    type="button"
                    className={action + " mt-3 mr-2"}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const v = await connected<Account>(
                          "/hyperliquid/check",
                          {},
                        );
                        return (
                          "Exchange grant status · " +
                          (v.agent?.state ?? "unavailable")
                        );
                      })
                    }
                  >
                    Check exchange status
                  </button>
                )}
              {currentGrant &&
                !["revoked", "expired"].includes(currentGrant.state) && (
                  <button
                    type="button"
                    className={action + " mt-3"}
                    disabled={busy}
                    onClick={() => void revoke()}
                  >
                    Revoke agent at exchange
                  </button>
                )}
            </details>
          )}
          {recent && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className={quiet}>
                Pausing blocks new live orders. Open venue positions stay open.
              </p>
              <button
                type="button"
                className={action}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await connected("/pause", {});
                    return "Live account paused.";
                  })
                }
              >
                <Pause size={13} /> Pause live account
              </button>
            </div>
          )}
        </div>
      )}
      {(ok || error) && (
        <p
          role={error ? "alert" : "status"}
          className={
            "border-t border-line px-5 py-3 text-sm " +
            (error ? "text-warn" : "text-ink-2")
          }
        >
          {error || ok}
        </p>
      )}
    </section>
  );
}
