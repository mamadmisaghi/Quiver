import { z } from "zod";
import { Workflow } from "@/services/backend/contracts/src/workflow";
import { Risk } from "@/services/backend/contracts/src/strategy";
import { replayWorkflowHistory } from "@/services/backend/src/workflows/history";
import { Registry, MOCK_INSTRUMENTS } from "@/services/backend/src/venues/registry";
import { TiingoHistory } from "@/services/backend/src/venues/tiingo";
import { previewJson, readPreviewBody, sameOrigin } from "@/lib/preview/server";
const schema = z
  .object({
    workflow: Workflow,
    risk: Risk,
    from: z.number().int(),
    to: z.number().int(),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  })
  .strict();
const use = new Map<string, { time: number; n: number }>();
let inflight = 0;
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return previewJson({ message: "Start historical replay from the strategy editor." }, 403);
  const now = Date.now(),
    owner = "guest";
  for (const [key, line] of use) if (line.time <= now - 60000) use.delete(key);
  const row = use.get(owner) ?? { time: now, n: 0 };
  if (inflight >= 3 || row.n >= 6 || use.size > 1000)
    return previewJson({ message: "Historical replay is busy. Try again in a minute." }, 429);
  const input = schema.safeParse(await readPreviewBody(request, 192000).catch(() => null));
  if (!input.success)
    return previewJson({ message: "Choose a reviewed workflow and a valid date range." }, 422);
  inflight++;
  row.n++;
  use.set(owner, row);
  try {
    const v = input.data;
    return previewJson(
      await replayWorkflowHistory(v.workflow, v, v.risk, {
        registry: new Registry(MOCK_INSTRUMENTS),
        tiingo: process.env.TIINGO_API_KEY
          ? new TiingoHistory({ key: process.env.TIINGO_API_KEY })
          : undefined,
        ownerId: owner,
        signal: request.signal,
        now,
      }),
    );
  } catch {
    return previewJson(
      {
        message: "This time range or workflow could not be replayed. Check the selected markets and budget.",
      },
      422,
    );
  } finally {
    inflight--;
  }
}
