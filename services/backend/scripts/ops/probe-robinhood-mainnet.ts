// Read-only release evidence. Run in services/backend with: node --import tsx scripts/ops/probe-robinhood-mainnet.ts
import { RobinhoodMainnet } from "../../src/execution/robinhood-mainnet";
const v = new RobinhoodMainnet({
  rpcUrl: process.env.ROBINHOOD_MAINNET_RPC_URL,
});
try {
  const chain = await v.verifyDeployment();
  console.log(
    "Verified Uniswap production bytecode and current Robinhood head",
    JSON.stringify(chain),
  );
  const symbol = (process.argv[2] ?? "AAPL").trim().toUpperCase();
  const mark = await v.spotPrice(symbol);
  console.log(
    "Observed live stock route",
    symbol,
    mark.address,
    mark.price,
    mark.source,
    new Date(mark.observedAt).toISOString(),
  );
} catch {
  console.error(
    "The mainnet deployment or current tradable stock quote could not be verified. Check RPC support, market hours, registry/feeds, DEX liquidity and code pins.",
  );
  process.exitCode = 1;
}
