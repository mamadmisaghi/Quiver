"use client";
import { useEffect, useState } from "react";
import { getPreviewWorkspace, type PreviewWorkspace } from "@/lib/api/preview-workspace";

export default function PreviewWorkspaceNotice({ onReady }: { onReady?: (ready: boolean) => void }) {
  const [workspace, setWorkspace] = useState<PreviewWorkspace | null>(null);
  useEffect(() => { let active = true; getPreviewWorkspace().then((v) => { if (active) { setWorkspace(v); onReady?.(v.aiAvailable); } }); return () => { active = false; }; }, [onReady]);
  if (!workspace) return null;
  return <div className="mt-4 flex flex-wrap items-center gap-x-3 text-[12.5px] text-muted">
    <span>{workspace.aiAvailable
      ? workspace.authenticated && workspace.cloudAvailable ? "Drafts sync to your workspace." : "Drafts are saved in this browser."
      : workspace.aiConfigured ? "Sign in to use AI drafting and chart reading." : "Rule-based drafting is available."}</span>
    {!workspace.authenticated && <a href="/signin-with-chatgpt?return_to=%2Fapp%2Fnew" target="_top" className="inline-flex min-h-9 items-center text-accent underline-offset-4 hover:underline">Sign in with ChatGPT →</a>}
  </div>;
}
