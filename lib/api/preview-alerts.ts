import { z } from "zod";
import * as C from "@/lib/contracts";
import { readSetting, writeSetting } from "./browser-settings";
import { connectionRequest } from "./preview-connections";
import { ApiErr, type QuiverApi } from "./types";

const path = "/api/preview/alerts";
const rules = z.array(C.AlertRule).max(20);
const readRules = () => readSetting("alert-rules", rules, []);
const post = (method: string, value: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
const subscribed = z.boolean();
export const previewAlerts: Pick<
  QuiverApi,
  | "alertSettings"
  | "putAlertSettings"
  | "alertRules"
  | "createAlertRule"
  | "deleteAlertRule"
  | "alertDeliveries"
  | "testAlert"
> = {
  async alertSettings() {
    const result = C.AlertSettings.parse(await connectionRequest(path));
    writeSetting("webhook-on", subscribed, !!result.webhookUrl);
    return result;
  },
  async putAlertSettings(input) {
    const result = C.PutAlertSettingsRes.parse(
      await connectionRequest(path, post("PUT", input)),
    );
    writeSetting("webhook-on", subscribed, !!result.webhookUrl);
    return result;
  },
  async alertRules() {
    return readRules();
  },
  async createAlertRule(input) {
    const current = readRules();
    if (current.length >= 20)
      throw new ApiErr(
        "validation_failed",
        "A maximum of 20 rules can be saved.",
        422,
      );
    const rule = C.AlertRule.parse({
      ...C.CreateAlertRuleReq.parse(input),
      id: "alr_" + crypto.randomUUID().replaceAll("-", "").slice(0, 24),
      createdAt: new Date().toISOString(),
    });
    writeSetting("alert-rules", rules, [...current, rule]);
    return rule;
  },
  async deleteAlertRule(id) {
    writeSetting(
      "alert-rules",
      rules,
      readRules().filter((rule) => rule.id !== id),
    );
  },
  async alertDeliveries() {
    const data = z
      .object({ deliveries: z.array(C.AlertDelivery) })
      .parse(await connectionRequest(path));
    return { items: data.deliveries, nextCursor: null };
  },
  async testAlert() {
    return C.AlertDelivery.parse(
      await connectionRequest(path, post("POST", { kind: "test" })),
    );
  },
};
export function notifyPaperEvent(
  session: string,
  event: "fill" | "status" | "risk_halt" | "rejected",
  at: number,
  message: string,
) {
  if (
    !readSetting("webhook-on", subscribed, false) ||
    !readRules().some(
      (r) => r.enabled && r.runId === null && r.events.includes(event),
    )
  )
    return;
  void connectionRequest(
    path,
    post("POST", { kind: "run_event", session, event, at, message }),
  ).catch(() => {
    /* The paper engine is independent of alert delivery. */
  });
}
