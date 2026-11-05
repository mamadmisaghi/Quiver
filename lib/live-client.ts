"use client";
import { raw } from "@/lib/api/live";
import type { GrantChallenge, RobinhoodTx } from "@/lib/wallet/live-evm";
import type { HlOwnerTerms } from "@/lib/wallet/live-hl-owner";

export const NETWORKS = [
  "hyperliquid-mainnet",
  "solana-mainnet",
  "robinhood-mainnet",
] as const;
export type LiveNetwork = (typeof NETWORKS)[number];
export const NETWORK_DETAILS = {
  "hyperliquid-mainnet": {
    label: "Hyperliquid",
    description: "Perpetual futures",
    unit: "USDC",
    feeAsset: "USDC",
    feeUnit: "USDC",
    feeDecimals: 6,
    settlement: "USDC",
    defaultFee: "0.50",
    fund: "https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/how-to-start-trading",
  },
  "solana-mainnet": {
    label: "Solana",
    description: "Spot tokens",
    unit: "USDC",
    feeAsset: "SOL:lamports",
    feeUnit: "SOL",
    feeDecimals: 9,
    settlement: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    defaultFee: "0.005",
    fund: "https://help.phantom.com/articles/how-to-deposit-crypto-into-phantom-to-fund-your-wallet-4406393831187",
  },
  "robinhood-mainnet": {
    label: "Robinhood Chain",
    description: "Stock tokens",
    unit: "USDG",
    feeAsset: "ETH",
    feeUnit: "ETH",
    feeDecimals: 18,
    settlement: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    defaultFee: "0.0005",
    fund: "https://docs.robinhood.com/chain/bridging/",
  },
} as const;
export type Limits = {
  maxOrderUsd: number;
  dailyUsd: number;
  maxLeverage: number;
  maxSlippageBps: number;
};
export type Grant = {
  master: string;
  agent: string;
  state: string;
  validUntil: number;
  slotName: string;
  nonce: number;
};
export type GrantPrompt = GrantChallenge & { expiresAt: number };
export type Amount = { asset: string; units: string };
export type Allowance = {
  id: string;
  program: string;
  stage: string;
  kind: "approve" | "approve_zero";
  state: string;
  asset: string;
  amount: string;
  expiresAt: number;
  wallet: string;
  fee: string;
  digest: string;
  txHash: string | null;
};
export type RunSummary = {
  id: string;
  name: string;
  strategyId: string;
  version: number;
  status: string;
  mode: "auto" | "confirm_each";
  createdAt: number;
  message: string;
  fills: number;
};
export type LiveAccount = {
  termsVersion: string;
  platformDailyCapUsd: number;
  consent: {
    version: string;
    at: number;
    residence: string;
    nonUs: boolean;
    limits: Limits;
  } | null;
  paused: boolean;
  region: string | null;
  evmWallets: string[];
  solanaWallets: string[];
  agent: Grant | null;
  runs: RunSummary[];
  allowances: Allowance[];
};
export type Account = LiveAccount;
export type LiveBalance = {
  network: LiveNetwork;
  wallet: string;
  stable: string;
  native?: string | null;
  equity?: string;
  observedAt: number;
  positions?: unknown[];
};
export type Balance = LiveBalance;
export type PublicQuote = {
  inputToken: string;
  outputToken: string;
  inputUnits: string;
  minimumOutputUnits: string;
  expectedOutputUnits?: string;
  maxFeeWei: string;
  expiresAt: number;
};
export type OrderStatus =
  | "planned"
  | "reserved"
  | "dispatching"
  | "unknown"
  | "submitted"
  | "partial"
  | "awaiting_final"
  | "reconciling"
  | "filled"
  | "cancelled"
  | "rejected"
  | "revoked";
export type SolPin = {
  unsigned: string;
  messageHash: string;
  expiresAt: number;
  requiredOutput: string;
  intent: {
    taker: string;
    inputMint: string;
    outputMint: string;
    inputAmount: string;
    maxNetworkAndRentLamports: string;
  };
};
export type LiveOrder = {
  id: string;
  stage: string;
  leg: "entry" | "exit";
  sequence: number;
  network: LiveNetwork;
  wallet: string;
  market: {
    id: string;
    symbol: string;
    address: string | null;
    venue: string;
    kind: string;
  };
  side: string;
  leverage: number;
  spendAsset: string;
  spendUnits: string;
  slippageBps: number;
  notionalUsd6: string | null;
  perpetual: null | {
    averagePrice: string | null;
    executedNotional: string;
    realizedClosedPnl: string | null;
    fees: Record<string, string>;
    filledSize: string;
    requestedSize: string;
    status: string;
  };
  digest: string;
  summary: string;
  expiresAt: number;
  targetUnits: string;
  reserves: Amount[];
  unsigned: null | HlOwnerTerms | { pin: SolPin; assetDecimals: number };
  quote?: PublicQuote | null;
  delivery: string | null;
  cancellation: string | null;
  status: OrderStatus;
  filledUnits: string;
  orderRef: string | null;
  recoveryId: string | null;
};
export type LiveStage = {
  symbol?: string;
  when?: string;
  id: string;
  assetId: string;
  side: string;
  after: { stageId: string; event: string }[];
  entryOrders: string[];
  exitOrders: string[];
  holding: null | { asset: string; quantity: string; averageEntryUsd: number };
  canClose: boolean;
};
export type RunView = {
  name?: string;
  id: string;
  strategyId: string;
  version: number;
  revision: number;
  status: "running" | "paused" | "complete" | "stopped";
  message: string;
  mode: "auto" | "confirm_each";
  createdAt: number;
  allocations: {
    venue: string;
    asset: string;
    funded: string;
    free: string;
    held: string;
    debited: string;
    credited: string;
  }[];
  issues: { id: string; reason: string }[];
  stages: LiveStage[];
  orders: LiveOrder[];
};
export type HandOff = {
  orderId: string;
  network: "robinhood-mainnet";
  wallet: string;
  digest: string;
  recoveryId: string;
  expiresAt: number;
  packet: RobinhoodTx;
};
export async function connected<T>(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await raw(
    "/live" + path,
    data === undefined
      ? { signal }
      : { method: "POST", body: JSON.stringify(data), signal },
  );
  return (await res.json()) as T;
}
export const shortAddress = (s: string) =>
  s.length > 19 ? s.slice(0, 7) + "…" + s.slice(-6) : s;
export const money = (value: string | number) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Math.abs(n) > 1000 ? 2 : 4,
      }).format(n)
    : "Unavailable";
};
export function units(s: string, decimals: number) {
  if (!/^(0|[1-9]\d{0,20})(\.\d+)?$/.test(s))
    throw Error("Enter a positive decimal amount.");
  const [n, f = ""] = s.split(".");
  if (f.length > decimals)
    throw Error("Amount exceeds this token’s precision.");
  return String(
    BigInt(n) * 10n ** BigInt(decimals) +
      BigInt(f.padEnd(decimals, "0") || "0"),
  );
}
export function amountLabel(value: string, places: number) {
  if (
    !/^-?\d+$/.test(value) ||
    !Number.isInteger(places) ||
    places < 0 ||
    places > 30
  )
    return "Unavailable";
  const neg = value.startsWith("-"),
    s = neg ? value.slice(1) : value,
    n = BigInt(s),
    p = 10n ** BigInt(places),
    f = (n % p).toString().padStart(places, "0").replace(/0+$/, "");
  return (neg ? "−" : "") + (n / p).toString() + (f ? "." + f : "");
}
export function amountText(net: LiveNetwork, asset: string, v: string) {
  const n = NETWORK_DETAILS[net];
  if (asset === n.settlement) return amountLabel(v, 6) + " " + n.unit;
  if (asset === n.feeAsset)
    return amountLabel(v, n.feeDecimals) + " " + n.feeUnit;
  if (net === "hyperliquid-mainnet" && asset.startsWith("hl:perp:"))
    return amountLabel(v, 18) + " " + asset.slice(8);
  if (net === "robinhood-mainnet") return amountLabel(v, 18) + " tokens";
  return v + " base units";
}
export function timestamp(n: number) {
  return new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
