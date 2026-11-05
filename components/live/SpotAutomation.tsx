"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { raw } from "@/lib/api/live";
import { onSession } from "@/lib/api/session";
import { useTradingWallets } from "@/components/auth/WalletRuntime";
import {
  inspectSpotSetup,
  signSpotSetup,
  type FundingScope,
} from "@/lib/wallet/spot-funding-wire";
type GrantScope = FundingScope & {
  stageId: string;
  pool: string;
  unitsPerOrder: string;
  minimumOutputUnits: string;
  feeCapLamports: string;
  expiresAt: number;
};
type Grant = {
  id: string;
  strategyId: string;
  version: number;
  walletId: string;
  executor: string;
  fundingOwner: string;
  status: "offered" | "active" | "disabled" | "expired";
  signerId: string;
  policyId: string;
  stages: GrantScope[];
  reserved: string;
  setup: {
    id: string;
    kind: "approve" | "revoke";
    state: string;
    txid: string | null;
  } | null;
};
type Preview = {
  previewId: string;
  expiresAt: number;
  stages: { stageId: string; scope: Omit<GrantScope, "stageId"> }[];
  marketDecimals: Record<string, number>;
};
type Setup = {
  id: string;
  kind: "approve" | "revoke";
  unsigned?: string;
  estimatedFeeLamports?: string;
  estimatedRentLamports?: string;
  state?: string;
};
type State = { enabled: boolean; fundingWallets: string[]; grants: Grant[] };
type Stage = { id: string; label: string };
const base = "/live/spot-permissions";
const api = async <T,>(path: string, value?: unknown): Promise<T> => {
  const r = await raw(
    base + path,
    value === undefined ? {} : { method: "POST", body: JSON.stringify(value) },
  );
  return r.json();
};
const short = (s: string) => s.slice(0, 5) + "…" + s.slice(-5);
const unit = (q: string, dec: number) => {
  const n = BigInt(q),
    d = 10n ** BigInt(dec),
    carry = n % d;
  return (
    String(n / d) +
    (carry ? "." + String(carry).padStart(dec, "0").replace(/0+$/, "") : "")
  );
};
export default function SpotAutomation({
  strategyId,
  version,
  stages,
}: {
  strategyId: string;
  version: number;
  stages: Stage[];
}) {
  const runtime = useTradingWallets() as ReturnType<
    typeof useTradingWallets
  > & {
    addSpotSigner?: (
      address: string,
      signerId: string,
      policyId: string,
    ) => Promise<unknown>;
    removeSoleSpotSigner?: (address: string) => Promise<unknown>;
    createAdditionalSolanaWallet?: () => Promise<unknown>;
  };
  const [open, setOpen] = useState(false),
    [state, setState] = useState<State | null>(null),
    [wallets, setWallets] = useState<{ id: string; address: string }[]>([]),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState(""),
    [notice, setNotice] = useState("");
  const [funding, setFunding] = useState(""),
    [executor, setExecutor] = useState(""),
    [legs, setLegs] = useState<string[]>([]),
    [minutes, setMinutes] = useState("60"),
    [orders, setOrders] = useState("1"),
    [slip, setSlip] = useState("50");
  const [pre, setPre] = useState<Preview | null>(null),
    [setups, setSetups] = useState<Record<string, Setup>>({});
  const epoch = useRef(0),
    lock = useRef(false);
  const load = useCallback(async (t: number) => {
    const s = await api<State>("/");
    if (epoch.current !== t) return;
    setState(s);
    if (s.enabled) {
      const r = await api<{ wallets: { id: string; address: string }[] }>(
        "/wallets",
      );
      if (epoch.current === t) setWallets(r.wallets);
    } else setWallets([]);
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = ++epoch.current;
    setPre(null);
    setState(null);
    setSetups({});
    setLegs([]);
    setExecutor("");
    setFunding("");
    setWallets([]);
    setErr("");
    setNotice("");
    void load(t).catch((e) => {
      if (epoch.current === t)
        setErr(e instanceof Error ? e.message : "Permissions unavailable.");
    });
    const off = onSession(() => {
      epoch.current++;
      setState(null);
      setWallets([]);
      setPre(null);
      setSetups({});
      setErr("Account changed. Reopen permissions.");
    });
    return () => {
      off();
      epoch.current++;
    };
  }, [open, strategyId, version, load]);
  const act = async (fn: () => Promise<string>, reload = true) => {
    if (lock.current) return;
    const t = epoch.current;
    lock.current = true;
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const m = await fn();
      if (t === epoch.current) {
        setNotice(m);
        if (reload) await load(t);
      }
    } catch (e) {
      if (t === epoch.current)
        setErr(
          e instanceof Error ? e.message : "Unable to complete this step.",
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const wrap = "q-action text-xs",
    input =
      "mt-1 block w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink";
  const names = (id: string) => stages.find((s) => s.id === id)?.label ?? id;
  const selected = wallets.find((w) => w.id === executor);
  const preview = () =>
    act(async () => {
      if (!selected) throw Error("Choose the execution wallet.");
      const p = await api<Preview>("/preview", {
        strategyId,
        version,
        walletId: selected.id,
        executor: selected.address,
        fundingOwner: funding,
        stages: legs,
        slippageBps: Number(slip),
        durationMinutes: Number(minutes),
        maxOrders: Number(orders),
      });
      setPre(p);
      return "Review the on-chain spending limit and receiving accounts.";
    }, false);
  const prepareSetup = (g: Grant, kind: "approve" | "revoke") =>
    act(async () => {
      const q = await api<Setup>("/" + g.id + "/setup", { kind });
      if (q.unsigned) inspectSpotSetup(q.unsigned, kind, g.stages);
      setSetups((all) => ({ ...all, [g.id]: q }));
      return q.unsigned
        ? "Review the allowance transaction before signing."
        : "The original transaction is already recorded.";
    });
  function renderGrant(g: Grant) {
    const first = g.stages[0],
      req = setups[g.id],
      isActive = g.status === "active",
      disabled = g.status === "disabled" || g.status === "expired";
    return (
      <div key={g.id} className="mt-4 rounded-lg border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm">
            {unit(first.totalInputUnits, 6)} USDC permission
          </strong>
          <span className="font-mono text-xs text-muted">{g.status}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Funding {short(g.fundingOwner)} · execution {short(g.executor)} ·{" "}
          {g.stages.map((s) => names(s.stageId)).join(", ")} · expires{" "}
          {new Date(first.expiresAt).toLocaleString()}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {g.status === "offered" && (
            <>
              <button
                className={wrap}
                disabled={busy || !runtime.addSpotSigner}
                onClick={() =>
                  void act(async () => {
                    await runtime.addSpotSigner!(
                      g.executor,
                      g.signerId,
                      g.policyId,
                    );
                    return "Owner consent recorded. Prepare the funding allowance.";
                  })
                }
              >
                Authorize restricted signer
              </button>
              <button
                className={wrap}
                disabled={busy}
                onClick={() => void prepareSetup(g, "approve")}
              >
                Review USDC allowance
              </button>
              {g.setup?.kind === "approve" && g.setup.state === "finalized" && (
                <button
                  className={wrap}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api("/" + g.id + "/activate", {});
                      return "Restricted spot permission active. Start the approved workflow in automatic mode.";
                    })
                  }
                >
                  Activate permission
                </button>
              )}
            </>
          )}
          {(isActive || g.status === "offered" || g.status === "expired") && (
            <button
              className={wrap}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api("/" + g.id + "/disable", {});
                  setSetups((s) => {
                    const n = { ...s };
                    delete n[g.id];
                    return n;
                  });
                  return "Local signing disabled. Review the remaining on-chain allowance below.";
                })
              }
            >
              Disable signing
            </button>
          )}
          {disabled && g.status === "disabled" && (
            <>
              <button
                className={wrap}
                disabled={busy}
                onClick={() => void prepareSetup(g, "revoke")}
              >
                Review on-chain revoke
              </button>
              <button
                className={wrap}
                disabled={busy || !runtime.removeSoleSpotSigner}
                onClick={() =>
                  void act(async () => {
                    const can = await api<{
                      removeAllSafe: boolean;
                      executor: string;
                    }>("/" + g.id + "/owner-revoke");
                    if (!can.removeAllSafe || can.executor !== g.executor)
                      throw Error(
                        "Quiver is not the sole signer. Review individual signers in your wallet.",
                      );
                    await runtime.removeSoleSpotSigner!(g.executor);
                    return "Owner removed the sole Quiver signer.";
                  })
                }
              >
                Remove Quiver from wallet
              </button>
            </>
          )}
          {g.setup?.txid && g.setup.state === "attempted" && (
            <button
              className={wrap}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await api<{ state: string }>(
                    "/" + g.id + "/setup/" + g.setup!.id + "/check",
                    {},
                  );
                  return "Funding transaction " + r.state + ".";
                })
              }
            >
              Check original receipt
            </button>
          )}
        </div>
        {req?.unsigned &&
          g.setup?.id === req.id &&
          g.setup.state === "ready" && (
            <div className="mt-3 border-l border-accent pl-3">
              <p className="text-xs text-muted">
                {req.kind === "approve"
                  ? "Authorize spending up to " +
                    unit(first.totalInputUnits, 6) +
                    " USDC for this specific executor."
                  : "Revoke this SPL delegate on-chain."}{" "}
                {req.estimatedFeeLamports &&
                  "Network fee " + req.estimatedFeeLamports + " lamports."}{" "}
                {req.estimatedRentLamports &&
                  "Estimated token-account rent " +
                    req.estimatedRentLamports +
                    " lamports."}
              </p>
              <button
                className={wrap + " mt-2"}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const wallet = await runtime.selectSolana(g.fundingOwner),
                      signed = await signSpotSetup(
                        wallet,
                        req.kind,
                        req.unsigned!,
                        g.stages,
                      );
                    const result = await api<{ state: string }>(
                      "/" + g.id + "/setup/" + req.id + "/submit",
                      { signed },
                    );
                    return "Funding transaction " + result.state + ".";
                  })
                }
              >
                Sign{" "}
                {req.kind === "approve" ? "bounded allowance" : "revocation"} in
                funding wallet
              </button>
            </div>
          )}
        {g.setup?.txid && (
          <p className="mt-2 break-all font-mono text-xs text-muted">
            {g.setup.state} · {g.setup.txid}
          </p>
        )}
      </div>
    );
  }
  if (!strategyId || !stages.length) return null;
  return (
    <section className="q-card mt-4 border border-line bg-card p-5">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <span>
          <strong className="text-sm">Automated Solana entries</strong>
          <span className="mt-1 block text-xs text-muted">
            Bounded USDC allowance · direct Raydium pools
          </span>
        </span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            A separate Privy execution wallet pays SOL fees. Your funding wallet
            owns the tokens and receives each fill. The permission pins the
            pool, mint pair, per-order size, minimum output, lifetime spending
            cap and expiry.
          </p>
          {state?.enabled && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-muted">
                  Funding wallet
                  <select
                    className={input}
                    disabled={busy}
                    value={funding}
                    onChange={(e) => {
                      setFunding(e.target.value);
                      setPre(null);
                    }}
                  >
                    <option value="">Choose linked Solana wallet</option>
                    {state.fundingWallets.map((a) => (
                      <option key={a} value={a}>
                        {short(a)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Privy execution wallet
                  <select
                    className={input}
                    value={executor}
                    disabled={busy}
                    onChange={(e) => {
                      setExecutor(e.target.value);
                      setPre(null);
                    }}
                  >
                    <option value="">Choose a separate wallet</option>
                    {wallets
                      .filter((w) => w.address !== funding)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {short(w.address)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {runtime.createAdditionalSolanaWallet && (
                <button
                  className={wrap + " mt-2"}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await runtime.createAdditionalSolanaWallet!();
                      return "Execution wallet created. Fund its SOL fee balance before starting.";
                    })
                  }
                >
                  Create separate Privy wallet
                </button>
              )}
              {selected && (
                <p className="mt-2 break-all text-xs text-muted">
                  Send fee SOL to your execution wallet{" "}
                  <span className="font-mono">{selected.address}</span>.
                </p>
              )}
              <fieldset className="mt-4">
                <legend className="text-xs text-muted">
                  Permitted buy stages
                </legend>
                <div className="mt-1 flex flex-wrap gap-4">
                  {stages.map((s) => (
                    <label className="text-sm" key={s.id}>
                      <input
                        type="checkbox"
                        checked={legs.includes(s.id)}
                        disabled={busy}
                        onChange={(e) => {
                          setPre(null);
                          setLegs((x) =>
                            e.target.checked
                              ? [...x, s.id]
                              : x.filter((id) => id !== s.id),
                          );
                        }}
                      />{" "}
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ["Expiry (minutes)", minutes, setMinutes],
                  ["Max fills per stage", orders, setOrders],
                  ["Slippage (bps)", slip, setSlip],
                ].map(([label, value, set]) => (
                  <label className="text-xs text-muted" key={String(label)}>
                    {String(label)}
                    <input
                      type="number"
                      className={input}
                      disabled={busy}
                      value={String(value)}
                      onChange={(e) => {
                        setPre(null);
                        (set as (v: string) => void)(e.target.value);
                      }}
                    />
                  </label>
                ))}
              </div>
              <button
                className={wrap + " mt-4"}
                disabled={busy || !selected || !funding || !legs.length}
                onClick={() => void preview()}
              >
                Review permission
              </button>
              {pre && (
                <div className="mt-4 border-l border-accent pl-3">
                  <h4 className="text-sm font-medium">
                    Maximum {unit(pre.stages[0].scope.totalInputUnits, 6)} USDC
                    across all orders
                  </h4>
                  {pre.stages.map(({ stageId, scope }) => (
                    <p className="mt-1 text-xs text-muted" key={stageId}>
                      {names(stageId)} · {unit(scope.unitsPerOrder, 6)} USDC in
                      · minimum{" "}
                      {unit(
                        scope.minimumOutputUnits,
                        pre.marketDecimals[scope.outputMint],
                      )}{" "}
                      out · pool {short(scope.pool)}
                    </p>
                  ))}
                  <p className="mt-2 text-xs text-muted">
                    Up to {pre.stages[0].scope.feeCapLamports} lamports in fees
                    per swap. Expires{" "}
                    {new Date(pre.stages[0].scope.expiresAt).toLocaleString()}.
                  </p>
                  <button
                    className={wrap + " mt-3"}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api("/offer", {
                          previewId: pre.previewId,
                          consent: "create-scoped-permission",
                        });
                        setPre(null);
                        return "Restricted signer created. Owner consent and an SPL allowance are required to activate it.";
                      })
                    }
                  >
                    Create restricted permission
                  </button>
                </div>
              )}
            </>
          )}
          {state && !state.enabled && (
            <p className="mt-3 text-xs text-muted">
              Connect the production API and Privy to authorize live wallet
              actions.
            </p>
          )}
          {state?.grants
            .filter((g) => g.strategyId === strategyId)
            .map(renderGrant)}
          {notice && (
            <p className="mt-3 text-sm" role="status">
              {notice}
            </p>
          )}
          {err && (
            <p className="mt-3 text-sm text-warn" role="alert">
              {err}
            </p>
          )}
        </>
      )}
    </section>
  );
}
