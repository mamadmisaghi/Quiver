import { z } from "zod";
import { Workflow } from "./workflow";

export const DraftQuestion = z.object({
  id: z.string().min(1).max(80), label: z.string().min(1).max(400),
  kind: z.enum(["number", "choice", "text"]), help: z.string().max(500),
  unit: z.string().max(40).optional(), max: z.number().optional(),
  options: z.array(z.object({ value: z.string().max(80), label: z.string().max(160), detail: z.string().max(250).optional() })).max(8).optional(),
});
export type DraftQuestion = z.infer<typeof DraftQuestion>;
export const DraftAnswer = z.object({ id: z.string().max(80), question: z.string().max(400), answer: z.string().max(1000) });
export const DraftContext = z.object({ workflow: Workflow, history: z.array(DraftAnswer).max(80).default([]) });
export type DraftContext = z.infer<typeof DraftContext>;
export const DraftContinuation = DraftContext.extend({ answers: z.record(z.string().max(80), z.string().min(1).max(1000)).refine((v) => Object.keys(v).length <= 80) });
export type DraftContinuation = z.infer<typeof DraftContinuation>;
