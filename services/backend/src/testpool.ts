// M5.23 Slice 3: read-only client for our own MockPool on testnet 46630. Only eth_call (readContract / getChainId).
// No wallet client, no keys, no sendTransaction anywhere in this file.
import { createPublicClient, http, getAddress, parseAbi } from "viem";

export const POOL_ABI = parseAbi([
  "function token0() view returns (address)", "function token1() view returns (address)",
  "function reserve0() view returns (uint256)", "function reserve1() view returns (uint256)",
  "function quote(address tokenIn, uint256 amountIn) view returns (uint256)",
  "function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to, uint256 deadline) returns (uint256)",
]);
export const ERC20_RO = parseAbi(["function decimals() view returns (uint8)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

/** Minimal read surface (tests inject an anvil-backed client; prod builds one from TEST_POOL_RPC_URL). */
export interface PoolReader { getChainId(): Promise<number>; /** M5.24d */ getCode?(a: { address: `0x${string}` }): Promise<string | undefined>; readContract(a: { address: `0x${string}`; abi: any; functionName: string; args?: readonly unknown[] }): Promise<unknown> }

export interface TestPoolCfg { TEST_POOL_ENABLED: boolean; TEST_POOL_ADDRESS?: string; TEST_USDG_ADDRESS?: string; TEST_NVDA_ADDRESS?: string; TEST_POOL_RPC_URL?: string; TESTNET_RPC_URL: string }
export function testPoolState(cfg: TestPoolCfg) {
  const missing = (["TEST_POOL_ADDRESS", "TEST_USDG_ADDRESS", "TEST_NVDA_ADDRESS"] as const).filter((k) => !cfg[k]);
  if (!cfg.TEST_POOL_ENABLED) missing.unshift("TEST_POOL_ENABLED" as any);
  const a = (v?: string) => (v ? getAddress(v) : null);
  return { enabled: missing.length === 0, missing: missing as string[], pool: a(cfg.TEST_POOL_ADDRESS), usdg: a(cfg.TEST_USDG_ADDRESS), nvda: a(cfg.TEST_NVDA_ADDRESS) };
}
export const defaultReader = (cfg: TestPoolCfg): PoolReader => createPublicClient({ transport: http(cfg.TEST_POOL_RPC_URL || cfg.TESTNET_RPC_URL, { timeout: 8000 }) }) as unknown as PoolReader;
