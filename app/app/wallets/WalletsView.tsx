"use client";
import PageHeader from "@/components/PageHeader";
import VenueMark from "@/components/VenueMark";
import Wrap from "@/components/Wrap";
import { Card, Pill } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, humanize } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import LinkedWallets from "@/components/auth/LinkedWallets";
import ChainAccountCard from "@/components/auth/ChainAccountCard";
import dynamic from "next/dynamic";
const TestnetPanel = dynamic(() => import("@/components/testnet/TestnetPanel"), { ssr: false });
const vTone = { up: "long", degraded: "warn", down: "short" } as const;
const vLabel = { up: "Up", degraded: "Degraded", down: "Down" } as const;
const CAP: Record<string, string> = { read: "Prices", paper: "Paper trading", testnet: "Testnet", live: "Live trading", swap: "Swaps", perp: "Perps" };
const SUB = "You're in paper mode. Connect a wallet only when you go to testnet or live.";
export default function WalletsView() {
  const q = useQ(() => Promise.all([api.me(), api.venues(), api.sessionKeys()]));
  // Signed out: show the linked-wallets section's own sign-in ("Sign in to link a wallet") instead of the generic gate.
  if (!q.data && q.auth) return <Wrap><PageHeader title="Wallets" sub={SUB} /><h2 className="mt-8 text-[15px] font-medium" id="linked">Linked wallets</h2><Card className="mt-4 p-6"><LinkedWallets /></Card></Wrap>;
  if (!q.data) return <Wrap><PageHeader title="Wallets" sub={SUB} /><Loading h={420} q={q} /></Wrap>;
  const [me, venues, keys] = q.data;
  return (
    <Wrap>
      <PageHeader title="Wallets" sub={SUB} />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {venues.map((v) => { const w = me.wallets.find((x) => x.chain === v.id); const readOnly = !v.capabilities.some((c) => c !== "read"); return (
          <Card key={v.id} className="p-6">
            <div className="flex items-center justify-between"><span className="flex items-center gap-3"><VenueMark venue={v.id} /><span className="font-medium">{v.name}</span></span><Pill tone={vTone[v.status]}>{vLabel[v.status]}</Pill></div>
            <p className="mt-4 text-[13px] text-muted">{v.capabilities.map((c) => CAP[c] ?? humanize(c)).join(" · ")}</p>
            {v.note && <p className="mt-2 text-[14px] text-muted">{v.note}</p>}
            <div className="mt-6 flex items-center justify-between">
              <span className="text-[13.5px] text-ink-2">{w ? <span className="font-mono">{w.address.slice(0, 6)}…{w.address.slice(-4)}</span> : readOnly ? "Watch-only — no wallet needed" : "Not needed for paper"}</span>
              {!readOnly && !w && <button disabled title="Available when testnet opens" className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] text-muted opacity-60">Connect later</button>}
            </div>
          </Card>); })}
      </div>
      <h2 className="mt-12 text-[15px] font-medium" id="linked">Linked wallets</h2>
      <Card className="mt-4 p-6"><LinkedWallets /></Card>
      <h2 className="mt-12 text-[15px] font-medium">Testnet account</h2>
      <Card className="mt-4 p-6"><ChainAccountCard initial={me.wallets.find((w) => /^0x[0-9a-fA-F]{40}$/.test(w.address))?.address} /></Card>
      <TestnetPanel />
      <h2 className="mt-12 text-[15px] font-medium">Session keys</h2>
      <Card className="mt-4 p-6">
        {keys.items.length ? keys.items.map((k) => <div key={k.id} className="text-[13.5px]">{humanize(k.status)}</div>)
          : <p className="text-[14px] text-muted">No session keys. They&apos;re created when you take a strategy to testnet or live, scoped to the contracts and tokens it needs, and revocable here.</p>}
      </Card>
      <Card className="mt-6 p-6">
        <div className="font-medium">Your keys stay yours</div><p className="mt-1 text-[14px] text-muted">Session keys can only call the swap targets in their policy, and swap output must return to your own account.</p>
      </Card>
    </Wrap>
  );
}
