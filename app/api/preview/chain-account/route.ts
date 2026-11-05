import { EvmAddress } from "@/lib/contracts";
import {
  previewJson,
} from "@/lib/preview/server";
import { readAccount } from "@/lib/preview/connections";

export async function GET(req: Request) {
  const address = EvmAddress.safeParse(
    new URL(req.url).searchParams.get("address"),
  );
  if (!address.success)
    return previewJson({ message: "Choose a valid EVM address." }, 422);
  try {
    const res = await readAccount(
      "https://rpc.testnet.chain.robinhood.com",
      address.data,
    );
    return previewJson({ res, rpc: "server" });
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
