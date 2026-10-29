// M5.9 user-supplied RPC endpoints and AI keys. Write-only: values are encrypted at rest and NEVER returned.
import { z } from "zod";
import { Id, IsoTime } from "./common";

export const UserSecretId = Id("sec");
/** PUT /v1/me/secrets/rpc: upsert the RPC for a chain. Testnet 46630 only. https, public host (SSRF-guarded). */
export const PutRpcSecretReq = z.object({ chainId: z.literal(46630), url: z.string().url().max(512), label: z.string().trim().max(40).optional() });
/** PUT /v1/me/secrets/ai: upsert the AI key for a provider (used for your compiles instead of the shared key). */
export const PutAiKeySecretReq = z.object({ provider: z.literal("openrouter"), apiKey: z.string().regex(/^sk-or-[A-Za-z0-9_-]{16,200}$/), label: z.string().trim().max(40).optional() });
export const UserSecretView = z.object({
  id: UserSecretId, kind: z.enum(["rpc", "ai_key"]), chainId: z.number().int().nullable(), provider: z.string().nullable(), label: z.string(),
  hint: z.string(), // rpc: "https://host/…" (no path/query/creds); ai_key: "sk-or-…abcd"
  status: z.enum(["ok", "undecryptable"]), // undecryptable = master key changed; re-enter it
  createdAt: IsoTime, updatedAt: IsoTime, lastUsedAt: IsoTime.nullable(),
});
export const UserSecretList = z.object({ items: z.array(UserSecretView), vault: z.enum(["ok", "unavailable"]) });
export const MAX_SECRETS_PER_USER = 10;
