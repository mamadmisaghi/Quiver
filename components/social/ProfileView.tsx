"use client";
// M5.5 public profile (+M5.10 limited state: no public strategies → name, bio and following count are withheld).
import { useCallback, useState } from "react";
import Link from "@/components/Link";
import { api, fmtPct, tone, type Profile } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import { Card, Pill } from "@/components/ui";
import Loading from "@/components/Loading";
import FollowButton from "./FollowButton";
import CopyDialog from "./CopyDialog";
import ActivityFeed from "./ActivityFeed";
export function ProfileNotFound({ handle }: { handle: string }) {
  return <div className="py-16 text-center" data-testid="profile-404"><h1 className="text-[22px] font-medium">Trader not found</h1>
    <p className="mt-2 break-words text-[14px] text-muted">There’s no trader called <span className="font-mono text-ink-2">{handle}</span>. Check the handle, or browse traders.</p>
    <Link href="/app/traders" className="mt-5 inline-block rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:bg-white/5">Browse traders</Link></div>;
}
export default function ProfileView({ handle: raw }: { handle: string }) {
  const handle = raw.startsWith("@") ? raw : "@" + raw; // M5.16: always send the handle with its @
  const at = handle;
  const [missing, setMissing] = useState(false);
  const gone = useCallback(() => setMissing(true), []);
  const q = useQ(() => Promise.all([api.profile(handle), api.copies().catch(() => null)]), [handle]);
  const [p, setP] = useState<Profile | null>(null);
  const [copying, setCopying] = useState<{ id: string; name: string } | null>(null);
  if (missing || (q.error && q.status === 404)) return <ProfileNotFound handle={handle} />;
  if (!q.data) return <><h1 className="sr-only">{handle}</h1><Loading h={360} q={q} /></>;
  const prof = p ?? q.data[0];
  const copied = new Set((q.data[1]?.items ?? []).filter((c) => !c.detached).map((c) => c.publicStrategyId));
  const holdsCopy = (q.data[1]?.items ?? []).some((c) => c.sourceHandle === prof.handle && !c.detached);
  return (
    <div data-testid="profile">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-[26px] font-medium leading-tight">{prof.displayName ?? <span className="font-mono">{prof.handle}</span>}</h1>
          {prof.displayName && <p className="mt-1 font-mono text-[13px] text-muted">{prof.handle}</p>}
          <div className="mt-2 flex flex-wrap gap-2">{prof.isYou && <Pill>You</Pill>}{prof.demo && <Pill>Demo</Pill>}<Pill tone="paper">Paper results</Pill></div>
        </div>
        {prof.isYou ? <Link href="/app/settings#profile" className="btn rounded-full border border-line-2 px-4 py-1.5 text-[13px]" data-testid="edit-profile">Edit profile</Link>
          : <FollowButton handle={prof.handle} following={prof.isFollowing} copying={holdsCopy} onChange={(r) => setP({ ...prof, isFollowing: r.following, followers: r.followers })} />}
      </div>
      {prof.limited ? <p className="mt-5 max-w-[560px] text-[14px] text-muted" data-testid="profile-limited">This trader hasn’t published a strategy yet, so their name, bio and who they follow stay private.</p>
        : prof.bio && <p className="mt-5 max-w-[640px] whitespace-pre-line break-words text-[14.5px] text-ink-2" data-testid="profile-bio">{prof.bio}</p>}
      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[13px]">
        <div><dt className="text-muted">Followers</dt><dd className="tnum font-mono text-[16px]" data-testid="profile-followers">{prof.followers}</dd></div>
        <div><dt className="text-muted">Following</dt><dd className="tnum font-mono text-[16px]">{prof.following ?? "—"}</dd></div>
        <div><dt className="text-muted">Best 30d paper</dt><dd className={`tnum font-mono text-[16px] ${tone(prof.bestPaperReturn30dPct)}`}>{fmtPct(prof.bestPaperReturn30dPct, { sign: true })}</dd></div>
      </dl>
      <h2 className="mt-10 text-[15px] font-medium">Public strategies</h2>
      {prof.strategies.length ? <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{prof.strategies.map((s) => (
        <Card key={s.id} className="flex flex-col p-5" data-testid="profile-strategy">
          <div className="flex items-center justify-between gap-2"><Link href={`/app/strategies/${encodeURIComponent(s.id)}`} className="min-w-0 truncate text-[15px] font-medium hover:text-ink-2" data-testid="profile-strategy-open">{s.name}</Link><span className={`tnum shrink-0 font-mono text-[13px] ${tone(s.paperReturn30dPct)}`}>{fmtPct(s.paperReturn30dPct, { sign: true })}</span></div>
          <p className="mt-1 text-[12.5px] text-muted">{s.venues.join(" · ")} · <span className="tnum">{s.forks}</span> forks</p>
          {!prof.isYou && <div className="mt-4">{copied.has(s.id) ? <Link href="/app/settings#copies" className="text-[13px] text-muted hover:text-ink">Copying · manage →</Link>
            : <button onClick={() => setCopying({ id: s.id, name: s.name })} className="btn rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:bg-white/5" data-testid="copy-open">Copy to paper…</button>}</div>}
        </Card>))}</div>
        : <p className="mt-3 text-[14px] text-muted">No public strategies yet.</p>}
      <h2 className="mt-10 text-[15px] font-medium">Activity</h2>
      <div className="mt-2" data-testid="profile-activity">{prof.isYou ? <ActivityFeed scope="mine" limit={10} />
        : <ActivityFeed handle={at} limit={20} empty="Nothing published recently." onNotFound={gone} />}</div>
      {copying && <CopyDialog publicStrategyId={copying.id} name={copying.name} handle={prof.handle} onClose={() => { setCopying(null); q.reload(); }} />}
    </div>
  );
}
