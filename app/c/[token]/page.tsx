// M4.8: public shared run card. No login, percentages only, disclaimer always shown.
import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import VenueMark from "@/components/VenueMark";
import { Card, Pill, Spark } from "@/components/ui";
import { durLabel, getPublicCard, signedPct } from "@/lib/public-card";

type P = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { token } = await params;
  const c = await getPublicCard(token).catch(() => null);
  if (!c) return { title: "Card not found · Quiver", robots: { index: false } };
  const title = `${c.strategyName} · ${signedPct(c.returnPct)} on ${c.mode} · Quiver`;
  const description = `${c.handle} ran “${c.strategyName}” for ${durLabel(c.durationSec)}: ${signedPct(c.returnPct)} return, ${signedPct(-Math.abs(Number(c.maxDrawdownPct)))} max drawdown, ${c.trades} trades. ${c.disclaimer}`;
  return { title, description, robots: { index: false }, openGraph: { title, description, type: "article", siteName: "Quiver" }, twitter: { card: "summary_large_image", title, description } };
}

export default function Page({ params }: P) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-5 py-14 sm:px-8 sm:py-20">
        <Suspense fallback={<Card className="h-[320px] animate-pulse bg-bg-2 motion-reduce:animate-none" aria-busy="true"><span className="sr-only">Loading card</span></Card>}>
          <Body params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function Body({ params }: P) {
  const { token } = await params;
  let c: Awaited<ReturnType<typeof getPublicCard>>;
  try { c = await getPublicCard(token); } catch { return <Gone title="Couldn’t load this card" body="The server didn’t answer. Try again in a moment." />; }
  if (!c) notFound(); // the proxy already turned this into an HTTP 404; this covers a revoke between the two reads
  const ret = Number(c.returnPct), up = ret >= 0;
  const stats: [string, string, string][] = [
    ["Return", signedPct(c.returnPct), up ? "text-long" : "text-short"],
    ["Max drawdown", signedPct(-Math.abs(Number(c.maxDrawdownPct))), ""],
    ["Trades", String(c.trades), ""], ["Trigger fires", String(c.triggerFires), ""], ["Ran for", durLabel(c.durationSec), ""],
  ];
  return (
    <article data-testid="public-card" data-motion="public-card">
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted">Shared run · {c.handle}</p>
      <h1 className="mt-3 text-[28px] font-medium tracking-tight sm:text-[34px]">{c.strategyName}</h1>
      <Card className="mt-7 overflow-hidden bg-bg-2">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-1.5">{c.venues.map((v) => <VenueMark key={v} venue={v} />)}</div>
          <div className="flex gap-1.5">{c.synthetic && <Pill tone="warn">Synthetic</Pill>}<Pill tone="accent">{c.mode === "paper" ? "Paper" : c.mode}</Pill>{c.status !== "stopped" && <Pill>{c.status}</Pill>}</div>
        </div>
        <div className="px-5 pt-6">
          <p className={`tnum font-mono text-[44px] leading-none tracking-tight ${up ? "text-long" : "text-short"}`}>{signedPct(c.returnPct)}</p>
          {c.spark.length > 1 && <div className="mt-5"><Spark pts={c.spark} w={680} h={88} fluid draw tone={up ? "long" : "short"} /></div>}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-5 sm:grid-cols-5">
          {stats.map(([k, v, cl]) => <div key={k} className="min-w-0"><dt className="text-[12px] text-muted">{k}</dt><dd className={`tnum mt-0.5 truncate font-mono text-[14px] ${cl}`}>{v}</dd></div>)}
        </dl>
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-2" data-testid="card-disclaimer">{c.disclaimer}</p>
      </Card>
      <p className="tnum mt-4 text-[12px] text-muted">Shared {new Date(c.sharedAt).toUTCString().slice(5, 22)} UTC · as of {new Date(c.asOf).toUTCString().slice(5, 22)} UTC</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app/new" className="btn rounded-full bg-accent px-5 py-2.5 text-[14px] font-medium text-bg">Write your own strategy</Link>
        <Link href="/leaderboard" className="btn rounded-full border border-line-2 px-5 py-2.5 text-[14px] text-ink-2 hover:border-white/30">See the leaderboard</Link>
      </div>
    </article>
  );
}

const Gone = ({ title, body }: { title: string; body: string }) => (
  <div className="grid min-h-[40vh] place-items-center text-center" data-testid="card-gone">
    <div>
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted">Shared card</p>
      <h1 className="mt-3 text-[26px] font-medium tracking-tight">{title}</h1>
      <p className="mt-3 text-[15px] text-ink-2">{body}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/leaderboard" className="btn rounded-full bg-accent px-5 py-2.5 text-[14px] font-medium text-bg">See the leaderboard</Link>
        <Link href="/" className="btn rounded-full border border-line-2 px-5 py-2.5 text-[14px] text-ink-2 hover:border-white/30">Go home</Link>
      </div>
    </div>
  </div>
);
