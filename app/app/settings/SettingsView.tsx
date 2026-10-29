"use client";
// M3.8: GET /v1/settings + POST /v1/runs/stop-all. M3.9: Alerts card (webhook, rules, deliveries) replaces "Coming soon".
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import Loading from "@/components/Loading";
import { Card, usd } from "@/components/ui";
import { api, type StopAll, errOf } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import AlertsCard from "./AlertsCard";
import ChannelsCard from "./ChannelsCard";
import SecretsCard from "./SecretsCard";
import { ProfileCard, FollowingCard, CopiesCard } from "./SocialCards";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 py-2.5"><dt className="text-[13.5px] text-muted">{k}</dt><dd className="tnum text-right font-mono text-[13.5px] text-ink">{v}</dd></div>;
}

export default function SettingsView() {
  const q = useQ(() => api.settings());
  const dlg = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [flatten, setFlatten] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<StopAll | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const s = q.data;
  useEffect(() => { const d = dlg.current; if (!d) return; const c = () => setBusy(false); d.addEventListener("close", c); return () => d.removeEventListener("close", c); }, [s]);
  if (!s) return <Wrap><PageHeader title="Settings" sub="Account limits and safety." /><Loading h={420} q={q} /></Wrap>;
  const stop = async () => {
    setBusy(true); setErr(null);
    try { setRes(await api.stopAll({ flatten })); dlg.current?.close(); q.reload(); }
    catch (x) { setErr(errOf(x, "Couldn’t stop runs. Nothing was changed.")); setBusy(false); }
  };
  const k = s.sessionKeyDefaults;
  return (
    <Wrap>
      <PageHeader title="Settings" sub={`As of ${new Date(s.asOf).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`} />
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-medium">Usage</h2>
          <dl className="mt-3 divide-y divide-line">
            <Row k="Active runs" v={`${s.usage.activeRuns} / ${s.limits.maxActiveRuns}`} />
            <Row k="Drafts today" v={`${s.usage.compilesUsedToday} / ${s.limits.compilesPerDay}`} />
            <Row k="Strategies" v={s.usage.strategies} />
            <Row k="Live event streams" v={`max ${s.limits.maxEventStreams}`} />
            <Row k="Signals per strategy" v={`max ${s.limits.maxStrategySignals}`} />
          </dl>
        </Card>
        <Card className="p-6">
          <h2 className="font-medium">Session key defaults</h2>
          <dl className="mt-3 divide-y divide-line">
            <Row k="Per trade" v={usd(k.perTradeCapUsd)} />
            <Row k="Per day" v={usd(k.dailyCapUsd)} />
            <Row k="Smallest swap" v={usd(k.minSwapUsd, 2)} />
            <Row k="Max slippage" v={`${k.maxSlippagePct}%`} />
          </dl>
          <p className="mt-3 text-[12.5px] text-muted">Applied when you create a key. You can lower them on the go-live screen.</p>
        </Card>
        <Card className="p-6">
          <h2 className="font-medium">Trading</h2>
          <dl className="mt-3 divide-y divide-line">
            <Row k="Modes" v={s.trading.enabledModes.join(", ")} />
            <Row k="Live trading" v={<span className="text-muted">Not open yet</span>} />
            <Row k="Kill switch" v={s.trading.killSwitch ? <span className="text-short">On — new runs blocked</span> : "Off"} />
          </dl>
        </Card>
        <AlertsCard />
        <ChannelsCard />
        <SecretsCard />
        <ProfileCard />
        <FollowingCard />
        <div className="lg:col-span-2"><CopiesCard /></div>
      </div>

      <Card className="mt-6 border-short/30 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-medium">Stop all runs</h2><p className="mt-1 text-[14px] text-muted">Stops every paper and testnet run on your account at once.</p></div>
          <button type="button" data-testid="stop-all" disabled={s.usage.activeRuns === 0} onClick={() => { setErr(null); dlg.current?.showModal(); cancel.current?.focus(); }} className="btn min-h-11 shrink-0 rounded-full border border-short/50 px-4 text-[13px] text-short hover:bg-short/10 disabled:opacity-40">Stop all runs</button>
        </div>
        {res && <p role="status" className="mt-4 text-[13.5px] text-ink-2">Stopped {res.stopped.length} {res.stopped.length === 1 ? "run" : "runs"}{res.alreadyStopped ? `, ${res.alreadyStopped} already stopped` : ""}.</p>}
      </Card>

      <dialog ref={dlg} aria-labelledby="sa-h" aria-describedby="sa-d" data-motion="dialog" className="m-auto w-[min(28rem,calc(100vw-2.5rem))] rounded-[14px] border border-line-2 bg-bg-2 p-6 text-ink backdrop:bg-black/60">
        <h2 id="sa-h" className="text-[17px] font-medium">Stop {s.usage.activeRuns} {s.usage.activeRuns === 1 ? "run" : "runs"}?</h2>
        <p id="sa-d" className="mt-2 text-[13.5px] text-muted">They stop immediately. You can start them again later, but you can’t undo closed positions.</p>
        <label className="mt-4 flex items-center gap-2.5 text-[13.5px]"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} className="h-4 w-4 accent-[var(--q-amber)]" />Also close open positions at market</label>
        {err && <p role="alert" className="mt-3 text-[13px] text-short">{err}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button ref={cancel} type="button" onClick={() => dlg.current?.close()} className="btn min-h-11 rounded-full border border-line-2 px-4 text-[13px] hover:bg-white/5">Cancel</button>
          <button type="button" data-testid="stop-all-confirm" disabled={busy} onClick={stop} className="btn min-h-11 rounded-full bg-short px-4 text-[13px] font-medium text-bg disabled:opacity-50">{busy ? "Stopping…" : "Stop all"}</button>
        </div>
      </dialog>
    </Wrap>
  );
}
