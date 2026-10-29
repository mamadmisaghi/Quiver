"use client";
// M5.12 feed page: followed traders' publishes/updates plus your own runs and copies (GET /v1/activity).
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import { Card } from "@/components/ui";
import ActivityFeed from "@/components/social/ActivityFeed";
import type { ActivityScope } from "@/lib/api";
const TABS: [ActivityScope, string][] = [["all", "All"], ["following", "Following"], ["mine", "Yours"]];
export default function ActivityView() {
  const [scope, setScope] = useState<ActivityScope>("all");
  const tabs = <div className="flex gap-1" role="tablist" aria-label="Activity scope">{TABS.map(([k, l]) => <button key={k} role="tab" id={`act-tab-${k}`} aria-selected={scope === k} aria-controls="act-panel" onClick={() => setScope(k)} className={`btn rounded-full px-3.5 py-1.5 text-[13px] ${scope === k ? "bg-white/[.08] text-ink" : "text-muted hover:text-ink"}`} data-testid={`act-tab-${k}`}>{l}</button>)}</div>;
  return (
    <Wrap>
      <PageHeader title="Activity" sub="What the traders you follow publish, and your own runs and copies. A trader’s runs are never shown." right={tabs} />
      <Card className="mt-8 px-5 py-2" role="tabpanel" id="act-panel" aria-labelledby={`act-tab-${scope}`}><ActivityFeed key={scope} scope={scope} /></Card>
    </Wrap>
  );
}
