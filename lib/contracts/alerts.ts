// M4.0 Alerts: user rules over run events, delivered by a pluggable provider (ALERTS_PROVIDER) through a retry queue.
import { z } from "zod";
import { Id, IsoTime, RunId } from "./common";
import { RunEvent } from "./events";

export const AlertRuleId = Id("alr");
export const AlertDeliveryId = Id("ald");
export const AlertProviderName = z.enum(["webhook", "email", "telegram", "x"]);
/** Run event types a rule can match. */
export const AlertEventType = z.enum(["fill", "rejected", "risk_halt", "error", "warning", "trigger_fired", "status"]);

export const AlertSettings = z.object({
  provider: AlertProviderName, // server-chosen (ALERTS_PROVIDER); not user-settable
  providerStatus: z.enum(["ok", "not_configured"]), // email/telegram/x are stubs → not_configured
  webhookUrl: z.string().url().nullable(),
  signingSecretSet: z.boolean(),
});
/** PUT /v1/alerts/settings. webhookUrl null removes it. rotateSecret forces a new secret. */
export const PutAlertSettingsReq = z.object({ webhookUrl: z.string().url().max(2048).nullable(), rotateSecret: z.boolean().optional() });
/** signingSecret is returned ONLY when it was just created or rotated (show once; server keeps it to sign). */
export const PutAlertSettingsRes = AlertSettings.extend({ signingSecret: z.string().regex(/^whsec_[0-9a-f]{64}$/).nullable() });

export const CreateAlertRuleReq = z.object({ runId: RunId.nullable().default(null) /* null = all my runs */, events: z.array(AlertEventType).min(1).max(7), enabled: z.boolean().default(true) });
export const AlertRule = z.object({ id: AlertRuleId, runId: RunId.nullable(), events: z.array(AlertEventType), enabled: z.boolean(), createdAt: IsoTime });
export const AlertRuleList = z.object({ items: z.array(AlertRule) });

export const AlertDeliveryStatus = z.enum(["queued", "delivered", "failed", "not_configured", "dropped"]);
export const AlertDelivery = z.object({
  id: AlertDeliveryId, ruleId: AlertRuleId.nullable(), runId: RunId.nullable(), kind: z.enum(["run_event", "test"]), eventType: z.string(), eventSeq: z.number().int().nullable(),
  provider: AlertProviderName, status: AlertDeliveryStatus, attempts: z.number().int(), lastError: z.string().nullable(), lastStatusCode: z.number().int().nullable(),
  nextAttemptAt: IsoTime.nullable(), createdAt: IsoTime, deliveredAt: IsoTime.nullable(),
});
export const AlertDeliveryList = z.object({ items: z.array(AlertDelivery), nextCursor: z.string().nullable() });

/** Body POSTed to the user's webhook. Headers: X-Quiver-Delivery, X-Quiver-Timestamp (unix s),
 *  X-Quiver-Signature: "v1=" + hex(HMAC-SHA256(signingSecret, `${timestamp}.${rawBody}`)). Reject if |now − timestamp| > 300 s.
 *  X-Quiver-Delivery: the delivery id (also payload.deliveryId). It is identical on every retry of the same alert; receivers must dedupe on it
 *  (retries re-sign with a fresh timestamp, so the signature alone does not identify a replay). */
export const AlertWebhookPayload = z.object({
  v: z.literal(1), deliveryId: AlertDeliveryId, kind: z.enum(["run_event", "test"]), ruleId: AlertRuleId.nullable(), runId: RunId.nullable(),
  event: RunEvent.nullable(), message: z.string(), sentAt: IsoTime,
});
export const ALERT_RETRY_BACKOFF_SEC = [10, 60, 300, 1800] as const; // attempts 2..5; then failed
export const ALERT_MAX_ATTEMPTS = 5;

/** M5.8 extra chat channels (stubs). Webhook stays configured via /alerts/settings and keeps working unchanged. */
export const AlertChannelName = z.enum(["telegram", "x"]);
export const AlertChannel = z.object({ name: AlertChannelName, label: z.string(), primary: z.boolean(), status: z.enum(["ok", "stub", "not_configured"]),
  target: z.string().nullable(), targetHint: z.string(), maxMessageLength: z.number().int() });
export const AlertChannelList = z.object({ items: z.array(AlertChannel) });
/** PUT /v1/alerts/channels/:name. target null = stop sending to this channel. */
export const PutAlertChannelReq = z.object({ target: z.string().max(64).nullable() });
