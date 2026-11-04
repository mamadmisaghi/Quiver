"use client";
import { useEffect, useState } from "react";
import { getPreviewWorkspace, type PreviewWorkspace } from "@/lib/api/preview-workspace";

export default function PreviewWorkspaceNotice({ onReady }: { onReady?: (ready: boolean) => void }) {
  const [workspace, setWorkspace] = useState<PreviewWorkspace | null>(null);
  useEffect(() => { let active = true; getPreviewWorkspace().then((v) => { if (active) { setWorkspace(v); onReady?.(v.aiAvailable); } }); return () => { active = false; }; }, [onReady]);
  if (!workspace) return null;
  return <p className="mt-4 text-[12.5px] text-muted">Drafts are saved in this browser.</p>;
}
