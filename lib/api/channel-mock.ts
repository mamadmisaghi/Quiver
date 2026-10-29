// MOCK M5.8 alert channels (in-memory, mirrors backend/src/alerts/channels.ts validation).
import { ApiErr, type AlertChannel, type QuiverChannelApi } from "./types";
const ch: AlertChannel[] = [
  { name: "telegram", label: "Telegram", primary: true, status: "not_configured", target: null, maxMessageLength: 4096, targetHint: "numeric chat id (e.g. 123456789 or -1001234567890) or @channelname" },
  { name: "x", label: "X", primary: false, status: "not_configured", target: null, maxMessageLength: 280, targetHint: "your X handle, 4–15 letters, digits or _ (e.g. @alice_q); alerts arrive as a DM" },
];
export const normTarget = (name: string, raw: string): string | null => {
  const t = raw.trim();
  if (name === "telegram") return /^-?\d{5,16}$/.test(t) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(t) ? t : null;
  const h = t.replace(/^@?/, "@"); return /^@[A-Za-z0-9_]{4,15}$/.test(h) && !/twitter|admin/i.test(h) && !/^@\d+$/.test(h) ? h : null;
};
export const mockChannels: QuiverChannelApi = {
  async alertChannels() { return { items: ch.map((c) => ({ ...c })) }; },
  async putAlertChannel(name, target) {
    const c = ch.find((x) => x.name === name); if (!c) throw new ApiErr("not_found", "Unknown alert channel.", 404);
    const t = target === null ? null : normTarget(name, target);
    if (target !== null && !t) throw new ApiErr("validation_failed", `Enter a valid ${c.label} destination: ${c.targetHint}.`, 422, { field: "target" });
    c.target = t; return { ...c };
  },
};
