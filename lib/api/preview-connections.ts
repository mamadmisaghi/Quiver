import { z } from "zod";
import * as C from "@/lib/contracts";
import { ApiErr, type QuiverSecretsApi } from "./types";
export async function connectionRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiErr(
      response.status === 401
        ? "unauthorized"
        : response.status === 422
          ? "validation_failed"
          : "internal",
      z.object({ message: z.string() }).safeParse(body).data?.message ??
        "Could not reach the connection service.",
      response.status,
    );
  return body;
}
const path = "/api/preview/connections";
const save = async (value: unknown) =>
  C.UserSecretView.parse(
    await connectionRequest(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    }),
  );
export const previewConnections: QuiverSecretsApi = {
  async mySecrets() {
    return C.UserSecretList.extend({
      shared: z.object({ ai: z.boolean(), stocks: z.boolean() }),
      authenticated: z.boolean(),
    }).parse(await connectionRequest(path));
  },
  putRpcSecret: save,
  putAiSecret: save,
  async deleteSecret(id) {
    await connectionRequest(path + "?id=" + encodeURIComponent(id), {
      method: "DELETE",
    });
  },
  async chainAccount(address) {
    const data = await connectionRequest(
      "/api/preview/chain-account?address=" + encodeURIComponent(address),
    );
    return z
      .object({ res: C.AccountReadRes, rpc: z.enum(["user", "server"]) })
      .parse(data);
  },
};
