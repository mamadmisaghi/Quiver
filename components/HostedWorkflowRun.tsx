"use client";
import { useEffect, useRef, useState } from "react";
import Link from "./Link";
import Wrap from "./Wrap";
import PageHeader from "./PageHeader";
import SignInButton from "./SignInButton";
import { WorkflowScreen } from "./WorkflowRun";
import { getHosted, changeHosted, type HostedView } from "@/lib/paper/hosted";
import { stageLabel } from "@/lib/paper/observations";
import { paperGraphPulses, type EdgePulse } from "@/lib/paper/graph-events";
import { onSession } from "@/lib/api/session";
import { ApiErr } from "@/lib/api/types";
import type { EditOps } from "@/lib/paper/changes";

export default function HostedWorkflowRun({ id }: { id: string }) {
  const [data, setData] = useState<HostedView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [auth, setAuth] = useState(false);
  const [pulses, setPulses] = useState<EdgePulse[]>([]),
    [stopping, setStopping] = useState(false),
    [account, setAccount] = useState(0);
  const seq = useRef(-1),
    epoch = useRef(0);
  function accept(next: HostedView) {
    if (next.serial < seq.current) return;
    if (
      seq.current >= 0 &&
      next.serial > seq.current &&
      next.session.status === "running" &&
      next.session.strategy.workflow &&
      !document.hidden
    )
      setPulses(
        paperGraphPulses(next.session.strategy.workflow, next.trace, next.session.state?.lastAt ?? 0),
      );
    if (next.session.status !== "running") setPulses([]);
    seq.current = next.serial;
    setData(next);
    setError("");
    setAuth(false);
  }
  useEffect(
    () =>
      onSession(() => {
        epoch.current++;
        seq.current = -1;
        setData(null);
        setBusy(false);
        setAccount((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    seq.current = -1;
    setData(null);
    setPulses([]);
    const ticket = ++epoch.current,
      controller = new AbortController();
    let next: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const view = await getHosted(id, controller.signal);
        if (epoch.current === ticket) accept(view);
      } catch (e) {
        if (epoch.current === ticket) {
          setError(e instanceof Error ? e.message : "Could not read this session.");
          if (e instanceof ApiErr && e.status === 401) {
            setData(null);
            setAuth(true);
          }
        }
      } finally {
        if (epoch.current === ticket) next = setTimeout(() => void read(), document.hidden ? 20000 : 4500);
      }
    }
    void read();
    return () => {
      epoch.current++;
      controller.abort();
      clearTimeout(next);
    };
  }, [id, account]);
  useEffect(() => {
    if (!pulses.length) return;
    const t = setTimeout(() => setPulses([]), 360 + Math.max(...pulses.map((p) => p.delay ?? 0)));
    return () => clearTimeout(t);
  }, [pulses]);
  async function act(action: "control" | "approval" | "edit", body: Parameters<typeof changeHosted>[2]) {
    const ticket = epoch.current;
    setBusy(true);
    try {
      const next = await changeHosted(id, action, body);
      if (epoch.current === ticket) accept(next);
    } finally {
      if (epoch.current === ticket) setBusy(false);
    }
  }
  function perform(fn: () => Promise<void>) {
    void fn().catch((e) => setError(e instanceof Error ? e.message : "The request failed."));
  }
  if (!data)
    return (
      <Wrap>
        <PageHeader title="Server paper session" sub={error || "Loading the last recorded observation…"} />
        {auth && <SignInButton />}
        <Link href="/app/run" className="q-action mt-5">
          Paper trades
        </Link>
      </Wrap>
    );
  const { session: s } = data,
    version = s.controlVersion ?? 0;
  const controls = (command: "pause" | "resume" | "stop") =>
    perform(() => act("control", { version, command }));
  async function edit(ops: EditOps, base: number) {
    if (base !== (s.editRevision ?? 0)) throw Error("Preview the latest rules before applying.");
    await act("edit", { version, ops });
  }
  const extra = (
    <>
      {stopping && (
        <section className="q-monitor-panel q-monitor-section p-5">
          <p>Stop observing this strategy and keep its final virtual balances and positions?</p>
          <div className="mt-3 flex gap-2">
            <button className="q-action" onClick={() => setStopping(false)}>
              Keep session
            </button>
            <button
              className="q-action q-primary"
              disabled={busy}
              onClick={() => {
                setStopping(false);
                controls("stop");
              }}
            >
              Stop observation
            </button>
          </div>
        </section>
      )}
      {data.approvals.some((a) => a.decision === "pending") && (
        <section className="q-monitor-panel q-monitor-section">
          <div className="q-monitor-heading">
            <h2>Entry approvals</h2>
            <span>Paper session</span>
          </div>
          {data.approvals
            .filter((a) => a.decision === "pending")
            .map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4"
              >
                <div>
                  <strong>{stageLabel(s.strategy.workflow!, a.stageId)}</strong>
                  <p className="text-muted text-xs">
                    Up to ${a.amount.toFixed(2)} · reference ${a.price} · expires{" "}
                    {new Date(a.expiresAt).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {(["rejected", "approved"] as const).map((decision) => (
                    <button
                      key={decision}
                      disabled={busy}
                      className={"q-action " + (decision === "approved" ? "q-primary" : "")}
                      onClick={() => perform(() => act("approval", { version, id: a.id, decision }))}
                    >
                      {decision === "approved" ? "Approve" : "Reject"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </section>
      )}
    </>
  );
  return (
    <WorkflowScreen
      session={s}
      running={s.status === "running" && !error}
      busy={busy}
      error={error || null}
      items={data.observations}
      pulses={pulses}
      start={() => controls("resume")}
      pause={() => controls("pause")}
      stop={() => setStopping(true)}
      applyChange={edit}
      server
      extra={extra}
    />
  );
}
