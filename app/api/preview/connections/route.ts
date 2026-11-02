import { PutAiKeySecretReq, PutRpcSecretReq } from "@/lib/contracts";
import {
  previewDatabase,
  previewJson,
  previewOwner,
  readPreviewBody,
  sameOrigin,
} from "@/lib/preview/server";
import {
  listConnections,
  saveConnection,
  vault,
  verifyRpc,
} from "@/lib/preview/connections";

export async function GET(req: Request) {
  const owner = previewOwner(req);
  const shared = {
    ai: !!process.env.OPENROUTER_API_KEY,
    stocks: !!process.env.TIINGO_API_KEY,
  };
  if (!owner || !vault().available)
    return previewJson({
      items: [],
      vault: "unavailable",
      authenticated: !!owner,
      shared,
    });
  try {
    return previewJson({
      items: await listConnections(await previewDatabase(), owner),
      vault: "ok",
      authenticated: true,
      shared,
    });
  } catch {
    return previewJson(
      { message: "Cannot load your connections right now." },
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
      { message: "Sign in with ChatGPT to save a private connection." },
      401,
    );
  if (!vault().available)
    return previewJson(
      { message: "Private connection storage is unavailable." },
      503,
    );
  let input: unknown;
  try {
    input = await readPreviewBody(req, 2500);
  } catch {
    return previewJson({ message: "Invalid connection request." }, 422);
  }
  const ai = PutAiKeySecretReq.safeParse(input),
    rpc = PutRpcSecretReq.safeParse(input);
  if (!ai.success && !rpc.success)
    return previewJson(
      { message: "Check the provider, label and connection value." },
      422,
    );
  if (rpc.success) {
    try {
      await verifyRpc(rpc.data.url);
    } catch {
      return previewJson(
        {
          message:
            "Could not verify chain 46630. Use the official testnet RPC or an approved Alchemy endpoint.",
        },
        422,
      );
    }
  }
  try {
    const db = await previewDatabase();
    const id = ai.success
      ? await saveConnection(
          db,
          owner,
          "ai_key",
          ai.data.apiKey,
          ai.data.label || "OpenRouter",
          "sk-or-…" + ai.data.apiKey.slice(-4),
        )
      : await saveConnection(
          db,
          owner,
          "rpc",
          rpc.data!.url,
          rpc.data!.label || "Robinhood testnet",
          new URL(rpc.data!.url).origin + "/…",
        );
    return previewJson(
      (await listConnections(db, owner)).find((item) => item.id === id),
    );
  } catch {
    return previewJson(
      { message: "Could not save your private connection." },
      503,
    );
  }
}
export async function DELETE(req: Request) {
  const owner = previewOwner(req);
  if (!sameOrigin(req))
    return previewJson({ message: "Use the Quiver website." }, 403);
  if (!owner) return previewJson({ message: "Sign in first." }, 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^sec_[a-z0-9]{10,32}$/.test(id))
    return previewJson({ message: "Invalid connection." }, 422);
  try {
    const result = await (await previewDatabase())
      .prepare(
        "DELETE FROM preview_connections WHERE owner=? AND id=? AND kind IN ('ai_key','rpc')",
      )
      .bind(owner, id)
      .run();
    return result.meta.changes
      ? previewJson({ deleted: true })
      : previewJson({ message: "Connection not found." }, 404);
  } catch {
    return previewJson({ message: "Could not remove the connection." }, 503);
  }
}
