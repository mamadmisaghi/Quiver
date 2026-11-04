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
    return result;
  },
  async putAlertSettings(input) {
    const result = C.PutAlertSettingsRes.parse(
      await connectionRequest(path, post("PUT", input)),
    );
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
