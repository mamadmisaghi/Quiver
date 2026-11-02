import { EvmAddress } from "@/lib/contracts";
import {
  previewDatabase,
  previewJson,
  previewOwner,
} from "@/lib/preview/server";
import { openConnection, readAccount } from "@/lib/preview/connections";

export async function GET(req: Request) {
  const address = EvmAddress.safeParse(
    new URL(req.url).searchParams.get("address"),
  );
  if (!address.success)
    return previewJson({ message: "Choose a valid EVM address." }, 422);
  try {
    const owner = previewOwner(req);
    const custom = owner
      ? await openConnection(await previewDatabase(), owner, "rpc", true)
      : null;
    const res = await readAccount(
      custom ?? "https://rpc.testnet.chain.robinhood.com",
      address.data,
    );
    return previewJson({ res, rpc: custom ? "user" : "server" });
  } catch {
    return previewJson(
      {
        message:
          "Testnet account data is unavailable. Check your RPC in Settings.",
      },
      503,
    );
  }
}
