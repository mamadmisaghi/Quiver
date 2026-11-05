import { z } from "zod";
import { EditField, EditOps } from "@/lib/paper/changes";
import { previewAi, previewJson, readPreviewBody, sameOrigin } from "@/lib/preview/server";
import { budgeted } from "@/services/backend/src/compile";
import { callOpenRouter } from "@/services/backend/src/compile/openrouter";

import { EditInstruction as Input, EditReply as Reply, simpleChange, EDIT_RULES as RULES } from "@/services/backend/src/workflows/edit-instruction";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return previewJson({ message: "Preview edits from your paper session." }, 403);
  let input: z.infer<typeof Input>;
  try { input = Input.parse(await readPreviewBody(request, 192_000)); }
  catch { return previewJson({ message: "Choose a rule and describe a change in up to 500 characters." }, 422); }
  const direct = simpleChange(input.text, input.fields);
  if (direct) {
    if ("message" in direct) return previewJson(direct, 422);
    const p = EditOps.safeParse(direct.ops);
    return p.success ? previewJson({ ops: p.data }) : previewJson({ message: "Preview up to 24 individual changes at once." }, 422);
  }
  try {
    const ai = await previewAi(request);
    if (!ai) return previewJson({ message: "Choose a rule above and use its field name, for example “Set stop loss to 5%” or “Set order size to $25”." }, 422);
    const out = await budgeted(ai.budget, () => callOpenRouter({ apiKey: ai.apiKey, model: ai.model, maxTokens: Math.min(ai.budget.maxOutputTokens ?? 1400, 2400),
      system: RULES, user: JSON.stringify(input), schema: { name: "PaperRuleChange", schema: z.toJSONSchema(Reply) }, signal: AbortSignal.timeout(ai.callTimeoutMs ?? 30000) }));
    if (!out) return previewJson({ message: "The edit service is busy. Try again or use a field name and value." }, 429);
    const p = Reply.safeParse(out.json);
    if (!p.success || p.data.question || !p.data.ops.length || p.data.ops.some(op => !input.fields.some(f => f.key === op.key)))
      return previewJson({ message: p.success && p.data.question || "Name the rule, the field to change and its new value." }, 422);
    return previewJson({ ops: p.data.ops });
  } catch { return previewJson({ message: "Could not read that change just now. Try again or use a field name and value." }, 503); }
}
