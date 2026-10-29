// M5.23: testnet-46630-only "prepare" endpoints. The server returns UNSIGNED transactions; the user's own wallet signs
// and broadcasts them. The server never signs, never broadcasts, never holds a key. Any chain other than 46630 is refused.
import { z } from "zod";
import { EvmAddress, IsoTime } from "./common";

export const TESTNET_CHAIN_ID = 46630 as const;
/** Base-10 integer string (wei / token base units). */
export const UintStr = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
/** Positive decimal with up to 18 fraction digits, e.g. "0.05" or "250". */
export const AmountStr = z.string().regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$/);

export const UnsignedTx = z.object({
  chainId: z.literal(TESTNET_CHAIN_ID), from: EvmAddress, to: EvmAddress,
  data: z.string().regex(/^0x([0-9a-f]{2})*$/), value: UintStr,
}).strict();
export type UnsignedTx = z.infer<typeof UnsignedTx>;

/** M5.24f: tNVDA (18 dp, test stand-in, needs TEST_NVDA_ADDRESS) is optional. */
export const DepositAsset = z.enum(["ETH", "tUSDG", "tNVDA"]);
/** POST /v1/testnet/deposit/prepare (auth). `chainId` must be 46630 (anything else: 422 validation_failed, details.reason "chain_not_allowed"). */
export const DepositPrepareReq = z.object({
  chainId: z.number().int(),
  asset: DepositAsset,
  amount: AmountStr,
  /** One of the caller's linked wallets (409 conflict, reason "wallet_not_linked" otherwise). */
  from: EvmAddress,
}).strict();
export const DepositPrepareRes = z.object({
  tx: UnsignedTx,
  asset: DepositAsset, amount: z.string(), amountBaseUnits: UintStr, decimals: z.number().int(),
  /** The caller's own session smart account on 46630 (latest pending/active session key). */
  recipient: EvmAddress,
  /** M5.24d: "verified" = recipient has code on 46630 (checked via RPC); "unchecked" = no RPC available / read failed. */
  recipientCode: z.enum(["verified", "unchecked"]),
  token: EvmAddress.nullable(), // null for ETH
  humanReadable: z.string(), testnet: z.literal(true), preparedAt: IsoTime,
  notice: z.string(),
}).strict();
export type DepositPrepareReq = z.infer<typeof DepositPrepareReq>;
export type DepositPrepareRes = z.infer<typeof DepositPrepareRes>;

// ---------- M5.23 Slice 3: our own test pool (MockPool tUSDG/tNVDA from DeployTestPool.s.sol) ----------
/** GET /v1/testpool/status (public). enabled = TEST_POOL_ENABLED && all three addresses set. */
export const TestPoolStatusRes = z.object({
  enabled: z.boolean(), chainId: z.literal(TESTNET_CHAIN_ID),
  pool: EvmAddress.nullable(), usdg: EvmAddress.nullable(), nvda: EvmAddress.nullable(),
  missing: z.array(z.string()), // env keys still empty (names only, never values of secrets)
  notice: z.string(),
}).strict();
export const TestPoolSide = z.enum(["buy", "sell"]); // buy = tUSDG -> tNVDA, sell = tNVDA -> tUSDG
/** GET /v1/testpool/quote?side=buy&amount=100 (auth). Read-only eth_call of MockPool.quote. 503 venue_unavailable when disabled. */
export const TestPoolQuoteQuery = z.object({ side: TestPoolSide, amount: AmountStr }).strict();
export const TestPoolQuoteRes = z.object({
  side: TestPoolSide, tokenIn: EvmAddress, tokenOut: EvmAddress, symbolIn: z.string(), symbolOut: z.string(),
  amountIn: z.string(), amountInUnits: UintStr, amountOut: z.string(), amountOutUnits: UintStr,
  priceUsdgPerNvda: z.string(), feeBps: z.literal(30), reserves: z.object({ usdg: UintStr, nvda: UintStr }),
  quotedAt: IsoTime, testnet: z.literal(true),
}).strict();
/** POST /v1/testpool/swap/prepare (auth, linked wallet). Returns unsigned txs in order: [approve?] then swapExactIn (output to `from`). */
export const TestPoolSwapPrepareReq = z.object({
  chainId: z.number().int(), side: TestPoolSide, amount: AmountStr, from: EvmAddress,
  slippageBps: z.number().int().min(1).max(500).default(50),
  deadlineSec: z.number().int().min(60).max(1800).default(600),
}).strict();
export const TestPoolSwapPrepareRes = z.object({
  txs: z.array(z.object({ kind: z.enum(["approve", "swap"]), tx: UnsignedTx, description: z.string() }).strict()).min(1).max(2),
  quote: TestPoolQuoteRes, minAmountOut: z.string(), minAmountOutUnits: UintStr, slippageBps: z.number().int(), deadline: z.number().int(),
  testnet: z.literal(true), notice: z.string(),
}).strict();
export type TestPoolStatusRes = z.infer<typeof TestPoolStatusRes>;
export type TestPoolQuoteRes = z.infer<typeof TestPoolQuoteRes>;
export type TestPoolSwapPrepareReq = z.infer<typeof TestPoolSwapPrepareReq>;
export type TestPoolSwapPrepareRes = z.infer<typeof TestPoolSwapPrepareRes>;
