import { z } from "zod";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { AlertDelivery, PutAlertSettingsReq } from "@/lib/contracts";
import {
  openConnection,
  saveConnection,
  vault,
} from "@/lib/preview/connections";
import {
  previewDatabase,
  previewJson,
  previewOwner,
  sameOrigin,
  readPreviewBody,
} from "@/lib/preview/server";

const Hook = z.object({ url: z.string().url(), secret: z.string() });
const Test = z.object({ kind: z.literal("test") });
const Event = z.object({
  kind: z.literal("run_event"),
  session: z.string().regex(/^paper_[a-z0-9-]{1,80}$/i),
  event: z.enum(["fill", "status", "risk_halt", "rejected"]),
  at: z.number().int().positive(),
  message: z.string().min(1).max(250),
});
const blank = {
  webhookUrl: null,
  signingSecretSet: false,
  provider: "webhook" as const,
};
const loadHook = async (db: D1Database, owner: string) => {
  const value = await openConnection(db, owner, "webhook");
  return value ? Hook.parse(JSON.parse(value)) : null;
};
function destination(raw: string) {
  const u = new URL(raw);
  const hosts = (process.env.QUIVER_WEBHOOK_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const permitted =
    u.hostname === "hooks.zapier.com" ||
    /^hook(?:\.[a-z0-9-]+)?\.make\.com$/.test(u.hostname) ||
    hosts.includes(u.hostname);
  if (
    !permitted ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hash
  )
    throw new Error("Unsupported destination");
  return u;
}
export async function GET(req: Request) {
  const owner = previewOwner(req);
  if (!owner || !vault().available)
    return previewJson({
      ...blank,
      providerStatus: "not_configured",
      deliveries: [],
    });
  try {
    const db = await previewDatabase(),
      hook = await loadHook(db, owner);
    const rows = await db
      .prepare(
        "SELECT record FROM preview_alert_deliveries WHERE owner=? ORDER BY created DESC LIMIT 20",
      )
      .bind(owner)
      .all<{ record: string }>();
    return previewJson({
      ...blank,
      providerStatus: "ok",
      webhookUrl: hook?.url ?? null,
      signingSecretSet: !!hook,
      deliveries: rows.results.map((row) => JSON.parse(row.record)),
    });
  } catch {
    return previewJson(
      { message: "Could not load your webhook settings." },
      503,
    );
  }
}
export async function PUT(req: Request) {
  const owner = previewOwner(req);
  if (!sameOrigin(req))
    return previewJson({ message: "Use the Quiver website." }, 403);
  if (!owner)
    return previewJson(
      { message: "Sign in with ChatGPT to save a private webhook." },
      401,
    );
  if (!vault().available)
    return previewJson({ message: "Private storage is unavailable." }, 503);
  const parsed = PutAlertSettingsReq.safeParse(
    await readPreviewBody(req, 3200).catch(() => null),
  );
  if (!parsed.success)
    return previewJson({ message: "Enter a valid HTTPS webhook URL." }, 422);
  try {
    const db = await previewDatabase(),
      url = parsed.data.webhookUrl;
    if (!url) {
      await db
        .prepare(
          "DELETE FROM preview_connections WHERE owner=? AND kind='webhook'",
        )
        .bind(owner)
        .run();
      return previewJson({
        ...blank,
        providerStatus: "ok",
        signingSecret: null,
      });
    }
    let target: URL;
    try {
      target = destination(url);
    } catch {
      return previewJson(
        {
          message:
            "Use a Zapier or Make webhook, or a receiver hostname approved for this workspace.",
        },
        422,
      );
    }
    const current = await loadHook(db, owner);
    const rotate = !current || current.url !== url || parsed.data.rotateSecret;
    const secret = rotate
      ? "whsec_" + randomBytes(32).toString("hex")
      : current!.secret;
    await saveConnection(
      db,
      owner,
      "webhook",
      JSON.stringify({ url, secret }),
      "Webhook",
      target.origin,
    );
    return previewJson({
      ...blank,
      providerStatus: "ok",
      webhookUrl: url,
      signingSecretSet: true,
      signingSecret: rotate ? secret : null,
    });
  } catch {
    return previewJson({ message: "Could not store the webhook." }, 503);
  }
}
export async function POST(req: Request) {
  const owner = previewOwner(req);
  if (!sameOrigin(req))
    return previewJson({ message: "Use the Quiver website." }, 403);
  if (!owner)
    return previewJson(
      { message: "Sign in and configure a webhook before sending a test." },
      401,
    );
  const parsed = z
    .discriminatedUnion("kind", [Test, Event])
    .safeParse(await readPreviewBody(req, 2000).catch(() => null));
  if (!parsed.success)
    return previewJson({ message: "Invalid notification." }, 422);
  try {
    const db = await previewDatabase(),
      hook = await loadHook(db, owner);
    if (!hook)
      return previewJson(
        { message: "Save a webhook before sending a notification." },
        422,
      );
    const url = destination(hook.url),
      event = parsed.data,
      now = Date.now(),
      ts = new Date(now).toISOString();
    const id =
      "ald_" +
      (event.kind === "test"
        ? randomBytes(12).toString("hex")
        : createHash("sha256")
            .update(JSON.stringify([event.session, event.at, event.event]))
            .digest("hex")
            .slice(0, 24));
    const delivery = AlertDelivery.parse({
      id,
      ruleId: null,
      runId: null,
      kind: event.kind,
      eventType: event.kind === "test" ? "test" : event.event,
      eventSeq: null,
      provider: "webhook",
      status: "queued",
      attempts: 0,
      lastError: null,
      lastStatusCode: null,
      nextAttemptAt: null,
      createdAt: ts,
      deliveredAt: null,
    });
    // Reserve once before any outbound call. Duplicates cannot double-send.
    const reservation = await db
      .prepare(
        "INSERT OR IGNORE INTO preview_alert_deliveries (owner,id,created,record) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM preview_alert_deliveries WHERE owner=? AND created>?)<12",
      )
      .bind(owner, id, now, JSON.stringify(delivery), owner, now - 60000)
      .run();
    if (!reservation.meta.changes) {
      const old = await db
        .prepare(
          "SELECT record FROM preview_alert_deliveries WHERE owner=? AND id=?",
        )
        .bind(owner, id)
        .first<{ record: string }>();
      return old
        ? previewJson(JSON.parse(old.record))
        : previewJson(
            {
              message:
                "Please wait a minute before sending another notification.",
            },
            429,
          );
    }
    const stamp = String(Math.floor(now / 1000));
    const body = JSON.stringify({
      v: 1,
      deliveryId: id,
      kind: event.kind,
      ruleId: null,
      runId: null,
      event: null,
      paperSessionId: event.kind === "run_event" ? event.session : null,
      message:
        event.kind === "test"
          ? "Test notification from Quiver."
          : event.message,
      sentAt: ts,
    });
    const signature = createHmac("sha256", hook.secret)
      .update(stamp + "." + body)
      .digest("hex");
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(6500),
        headers: {
          "content-type": "application/json",
          "X-Quiver-Delivery": id,
          "X-Quiver-Timestamp": stamp,
          "X-Quiver-Signature": "v1=" + signature,
        },
        body,
      });
      delivery.lastStatusCode = response.status;
      delivery.status = response.ok ? "delivered" : "failed";
      if (!response.ok)
        delivery.lastError = "Receiver returned HTTP " + response.status;
      await response.body?.cancel();
    } catch {
      delivery.status = "failed";
      delivery.lastError = "Receiver unavailable or timed out.";
    }
    delivery.attempts = 1;
    delivery.deliveredAt =
      delivery.status === "delivered" ? new Date().toISOString() : null;
    await db.batch([
      db
        .prepare(
          "UPDATE preview_alert_deliveries SET record=? WHERE owner=? AND id=?",
        )
        .bind(JSON.stringify(delivery), owner, id),
      db
        .prepare(
          "DELETE FROM preview_alert_deliveries WHERE owner=? AND id NOT IN (SELECT id FROM preview_alert_deliveries WHERE owner=? ORDER BY created DESC LIMIT 100)",
        )
        .bind(owner, owner),
    ]);
    return previewJson(delivery);
  } catch {
    return previewJson(
      {
        message:
          "Could not send this notification. Check your connection settings.",
      },
      503,
    );
  }
}
