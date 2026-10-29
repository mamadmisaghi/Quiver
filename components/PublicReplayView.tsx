"use client";
// M5.7 public replay: frozen snapshot, no auth. Title/handle/strategy name are user text → rendered as text only (M5.10).
import { useEffect, useState } from "react";
import { clientMedia } from "@/lib/api/media";
import Link from "@/components/Link";
import Wrap from "@/components/Wrap";
import Loading from "@/components/Loading";
import { Card, Pill } from "@/components/ui";
import { api, ApiErr, errOf, type PublicReplay } from "@/lib/api";
import HandleLink from "@/components/social/Handle";
import { ReplayPlayer } from "@/components/ReplayView";
export default function PublicReplayView({ token }: { token: string }) {
  const [data, setData] = useState<PublicReplay | null>(null); const [gone, setGone] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.publicReplay(token).then(setData).catch((x) => { if (x instanceof ApiErr && x.code === "not_found") setGone(true); else setErr(errOf(x, "Couldn’t load this replay.")); }); }, [token]);
  const q = { data }; 
  return (
    <Wrap>
      {gone ? <Card className="mt-10 p-8 text-center" data-testid="pr-gone"><h1 className="text-[20px] font-medium">This replay isn’t available</h1><p className="mt-2 text-[14px] text-muted">The link may be wrong, or its owner revoked it.</p><Link href="/leaderboard" className="mt-4 inline-block text-[13.5px] underline text-ink-2">See the leaderboard</Link></Card>
        : err ? <Card className="mt-10 p-6 text-[14px] text-short" role="alert">{err}</Card> : !q.data ? <Loading h={420} /> : <div data-testid="public-replay">
          <div className="flex flex-wrap gap-2"><Pill tone="paper">{q.data.mode === "testnet" ? "Testnet replay" : "Paper replay"}</Pill><Pill tone="muted">Snapshot</Pill></div>
          <h1 className="mt-3 break-words text-[clamp(1.6rem,3vw,2.2rem)] font-medium tracking-[-0.03em]" data-testid="pr-title">{q.data.title}</h1>
          <p className="mt-1 text-[13.5px] text-muted"><span className="text-ink-2">{q.data.strategyName}</span> · by <HandleLink handle={q.data.handle} /> · shared {new Date(q.data.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
          {q.data.render.status === "done" && clientMedia(q.data.render.videoUrl) && <div className="mt-4" data-testid="pr-video"><video controls playsInline preload="none" src={clientMedia(q.data.render.videoUrl)!} poster={clientMedia(q.data.render.posterUrl) ?? undefined} aria-label={`Replay video: ${q.data.title}`} className="max-h-[70vh] w-full rounded-[14px] bg-black" />
            <a href={clientMedia(q.data.render.videoUrl)!} download className="mt-2 inline-block text-[13px] text-ink-2 underline" data-testid="pr-download">Download video (MP4)</a></div>}
          <ReplayPlayer r={q.data} id={token} />
          <p className="mt-4 text-[12px] text-muted">Simulated results from a paper or testnet run. Not investment advice; past results don’t predict future ones.</p>
        </div>}
    </Wrap>
  );
}
