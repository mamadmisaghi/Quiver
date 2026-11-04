"use client";
// M5.12 feed page: followed traders' publishes/updates plus your own runs and copies (GET /v1/activity).
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import { Card } from "@/components/ui";
import ActivityFeed from "@/components/social/ActivityFeed";
import { API_MODE, fmtUsd, type ActivityScope } from "@/lib/api";
import { usePaperAccount } from "@/lib/paper/use-paper-account";
import Link from "@/components/Link";

function PaperActivity({ scope }: { scope: ActivityScope }) {
  const account = usePaperAccount(true);
  const [limit, setLimit] = useState(25);
  if (scope === "following" || !account?.activity.length) return <ActivityFeed scope={scope} />;
  const activity = account.activity;
  return <div><ol className="divide-y divide-line">{activity.slice(0, limit).map(event => <li className="flex items-start justify-between gap-4 py-4" key={event.id}>
    <div><Link href={event.href} className="text-[14px] font-medium hover:text-accent">{event.strategyName}</Link>
      <p className="mt-1 text-[13px] text-muted">{event.kind === "session_created" ? "Paper session created" : event.detail || event.kind}
        {event.kind !== "session_created" && event.price !== null && <> · {fmtUsd(String(event.price))}</>}</p></div>
    <time className="shrink-0 text-[12px] text-muted" dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
  </li>)}</ol>{activity.length > limit && <button type="button" className="q-action my-3" onClick={() => setLimit(n => n + 25)}>Load more</button>}
    <ActivityFeed scope={scope} empty="" /></div>;
}
const TABS: [ActivityScope, string][] = [["all", "All"], ["following", "Following"], ["mine", "Yours"]];
export default function ActivityView() {
  const [scope, setScope] = useState<ActivityScope>("all");
  const tabs = <div className="flex gap-1" role="tablist" aria-label="Activity scope">{TABS.map(([k, l]) => <button key={k} role="tab" id={`act-tab-${k}`} aria-selected={scope === k} aria-controls="act-panel" onClick={() => setScope(k)} className={`btn rounded-full px-3.5 py-1.5 text-[13px] ${scope === k ? "bg-white/[.08] text-ink" : "text-muted hover:text-ink"}`} data-testid={`act-tab-${k}`}>{l}</button>)}</div>;
  return (
    <Wrap>
      <PageHeader title="Activity" sub="What the traders you follow publish, and your own runs and copies. A trader’s runs are never shown." right={tabs} />
      <Card className="mt-8 px-5 py-2" role="tabpanel" id="act-panel" aria-labelledby={`act-tab-${scope}`}>{<PaperActivity key={scope} scope={scope} />}</Card>
    </Wrap>
  );
}
