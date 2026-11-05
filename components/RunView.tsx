"use client";
import dynamic from "next/dynamic";
const WorkflowRun = dynamic(() => import("./WorkflowRun"), { ssr: false });
const HostedRun = dynamic(() => import("./HostedWorkflowRun"), { ssr: false });
const LiveRun = dynamic(() => import("./LiveRun"), { ssr: false });
export default function RunView({ runId }: { runId: string }) { return runId.startsWith("srvpaper_") ? <HostedRun key={runId} id={runId} /> : runId.startsWith("paper_") ? <WorkflowRun key={runId} runId={runId} /> : <LiveRun key={runId} runId={runId} />; }
