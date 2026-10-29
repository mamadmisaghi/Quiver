// M5.2: Privy sign-in config + wallet-link scaffold (signature verified server-side; signing stays in the user's wallet).
import { z } from "zod";
import { EvmAddress } from "./common";

export const AuthConfigRes = z.object({
  privy: z.object({ enabled: z.boolean(), appId: z.string().nullable() }),
  devLogin: z.boolean(),
  walletLink: z.object({ enabled: z.boolean(), method: z.literal("personal_sign"), maxWallets: z.number().int() }),
});
export const WalletLinkChallengeReq = z.object({ address: EvmAddress });
export const WalletLinkChallengeRes = z.object({ nonce: z.string(), message: z.string(), expiresAt: z.string(), /** M5.10 EIP-4361 fields */ domain: z.string(), uri: z.string(), chainId: z.literal(46630), version: z.literal("1") });
export const WalletLinkVerifyReq = z.object({ nonce: z.string().min(8).max(64), signature: z.string().regex(/^0x[0-9a-fA-F]{130,}$/).max(2000) });
export const LinkedWallet = z.object({ address: EvmAddress, linkedAt: z.string(), primary: z.boolean() });
export const LinkedWalletsRes = z.object({ items: z.array(LinkedWallet) });
export type AuthConfigRes = z.infer<typeof AuthConfigRes>;
