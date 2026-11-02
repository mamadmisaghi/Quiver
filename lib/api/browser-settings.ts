import { z } from "zod";
import keyDefaults from "./fixtures/session-key.defaults.json";

const prefix = "quiver.studio.settings.v1.";
export function readSetting<T>(
  name: string,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  if (typeof window === "undefined") return structuredClone(fallback);
  try {
    const raw = localStorage.getItem(prefix + name);
    if (raw !== null) {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    /* Storage may be unavailable in a restricted browser. */
  }
  return structuredClone(fallback);
}
export function writeSetting<T>(
  name: string,
  schema: z.ZodType<T>,
  value: T,
): T {
  const checked = schema.parse(value);
  try {
    localStorage.setItem(prefix + name, JSON.stringify(checked));
  } catch {
    throw new Error(
      "This browser could not save the change. Free some storage and try again.",
    );
  }
  return checked;
}

export const PaperDefaults = z.object({
  mode: z.enum(["scenario", "quotes"]),
  budgetUsd: z.number().finite().positive().max(1e12).nullable(),
});
export type PaperDefaults = z.infer<typeof PaperDefaults>;
export const readPaperDefaults = () =>
  readSetting("paper", PaperDefaults, { mode: "quotes", budgetUsd: null });
export const writePaperDefaults = (value: PaperDefaults) =>
  writeSetting("paper", PaperDefaults, value);

export const KeyDefaults = z
  .object({
    perTradeCapUsd: z.number().positive().max(keyDefaults.perTradeCapUsd),
    dailyCapUsd: z.number().positive().max(keyDefaults.dailyCapUsd),
    maxSlippagePct: z.number().min(0.01).max(keyDefaults.maxSlippagePct),
  })
  .refine(
    (v) =>
      v.dailyCapUsd >= v.perTradeCapUsd &&
      v.dailyCapUsd <= 64 * v.perTradeCapUsd,
    "Daily cap must fall between the per-trade cap and 64 times that cap.",
  );
export const readKeyDefaults = () => {
  const saved = readSetting("key-defaults", KeyDefaults, keyDefaults);
  return {
    ...keyDefaults,
    ...saved,
    minSwapUsd: Math.ceil((saved.dailyCapUsd / 64) * 100) / 100,
  };
};
