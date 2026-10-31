"use client";
import { useEffect, useState } from "react";
import { getPreviewWorkspace, type PreviewWorkspace } from "@/lib/api/preview-workspace";

export default function PreviewWorkspaceNotice({ onReady }: { onReady?: (ready: boolean) => void }) {
  const [workspace, setWorkspace] = useState<PreviewWorkspace | null>(null);
  useEffect(() => { let active = true; getPreviewWorkspace().then((v) => { if (active) { setWorkspace(v); onReady?.(v.aiAvailable); } }); return () => { active = false; }; }, [onReady]);
  return <div role="note" className="mt-4 rounded-[12px] border border-line px-4 py-3 text-[13px] leading-relaxed text-ink-2">
    <p>{!workspace ? "Checking your workspace…" : workspace.aiAvailable
      ? "AI drafting, refinement and chart reading are ready. Review the generated rules before saving. Tests use synthetic prices; the continuous paper engine is pending activation."
      : workspace.aiConfigured && !workspace.authenticated ? "AI is configured. Sign in with ChatGPT to use AI drafting, refinement and chart reading. You can try simple rules in English without signing in. Continuous paper runs are pending activation."
      : "Try simple rules in English with the text parser. AI is not available for this session. Tests use synthetic prices; the continuous paper engine is pending activation."}</p>
    {workspace && <p className="mt-2 text-muted">{workspace.message || (workspace.cloudAvailable ? "Signed-in saves include an online copy. Back up older browser drafts from Strategies." : "Drafts save in this browser. Export a backup from Strategies before clearing browser data.")}
      {!workspace.authenticated && <a href="/signin-with-chatgpt?return_to=%2Fapp%2Fnew" target="_top" className="ml-2 inline-flex min-h-11 items-center text-accent underline underline-offset-4">Sign in with ChatGPT →</a>}
    </p>}
  </div>;
}
