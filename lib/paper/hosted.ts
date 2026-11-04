import { z } from "zod";
import { raw } from "@/lib/api/live";
import { PaperSessionSchema, type PaperSession } from "@/services/backend/src/workflows/session";
import { PaperQuote } from "@/services/backend/src/workflows/paper";
import type { EditOps } from "./changes";

const approval = z.object({
  id: z.string(),
  stageId: z.string(),
  amount: z.number(),
  price: z.number(),
  expiresAt: z.number(),
  decision: z.enum(["pending", "approved", "rejected"]),
});
const view = z.object({
  session: PaperSessionSchema,
  serial: z.number().int(),
  mode: z.enum(["auto", "confirm_each"]),
  approvals: z.array(approval),
  observations: z.array(z.object({ assetId: z.string(), quote: PaperQuote.nullable(), message: z.string() })),
  trace: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("condition"), stageId: z.string(), signals: z.array(z.string()) }),
      z.object({ kind: z.literal("fill"), stageId: z.string(), newDependencies: z.boolean() }),
      z.object({ kind: z.literal("exit"), stageId: z.string() }),
    ]),
  ),
});
export type HostedView = z.infer<typeof view>;
export async function loadHostedSessions(signal?: AbortSignal) {
  const response = await raw("/workflow-sessions", { signal });
  return z.object({ items: z.array(PaperSessionSchema) }).parse(await response.json()).items;
}
const post = (data: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(data) });
export const launchHosted = async (
  strategyId: string,
  version: number,
  confirm: boolean,
  key: string,
  approvalTtlSec = 120,
) =>
  view.parse(
    await (
      await raw(
        "/workflow-sessions",
        post({
          strategyId,
          version,
          mode: confirm ? "confirm_each" : "auto",
          launchKey: key,
          approvalTtlSec,
        }),
      )
    ).json(),
  );
export const getHosted = async (id: string, signal?: AbortSignal) =>
  view.parse(await (await raw("/workflow-sessions/" + encodeURIComponent(id), { signal })).json());
export async function changeHosted(
  id: string,
  action: "control" | "approval" | "edit",
  data: { version: number; command?: string; id?: string; decision?: string; ops?: EditOps },
) {
  return view.parse(
    await (await raw("/workflow-sessions/" + encodeURIComponent(id) + "/" + action, post(data))).json(),
  );
}
export const importHosted = async (s: PaperSession) =>
  view.parse(await (await raw("/workflow-sessions/import", post(s))).json());
