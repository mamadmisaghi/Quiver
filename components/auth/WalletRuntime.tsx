"use client";
import dynamic from "next/dynamic";
import { createContext, useContext, useState, type ReactNode } from "react";
import { API_MODE } from "@/lib/api";
import { useAuthConfig } from "@/lib/auth/useAuthConfig";
import { injectedEvm, type EvmSigner } from "@/lib/wallet/live-evm";
import { injectedPhantom, type SolanaSigner } from "@/lib/wallet/live-solana";

export type WalletRuntime = {
  ready: boolean;
  provider: "browser" | "privy";
  /** These operations are present only when the owner has a verified Privy session. */
  createAdditionalSolanaWallet?: () => Promise<void>;
  addSpotSigner?: (
    address: string,
    signerId: string,
    policyId: string,
  ) => Promise<void>;
  removeSoleSpotSigner?: (address: string) => Promise<void>;
  ethereum: string[];
  solana: string[];
  selectEvm: (address: string) => Promise<EvmSigner>;
  selectSolana: (address: string) => Promise<SolanaSigner>;
  login: () => Promise<void>;
  link: (family: "ethereum" | "solana") => Promise<void>;
};
const browser: WalletRuntime = {
  ready: true,
  provider: "browser",
  ethereum: [],
  solana: [],
  async selectEvm(address) {
    const signer = await injectedEvm();
    if (signer.address.toLowerCase() !== address.toLowerCase())
      throw Error("Select the linked EVM wallet.");
    return signer;
  },
  async selectSolana(address) {
    const signer = await injectedPhantom();
    if (signer.address !== address)
      throw Error("Select the linked Solana wallet.");
    return signer;
  },
  async login() {
    throw Error("Sign-in is not configured on this server.");
  },
  async link() {
    throw Error("Open Wallets to link an account.");
  },
};
const ctx = createContext<WalletRuntime>(browser);
export const useTradingWallets = () => useContext(ctx);
const PrivyWalletBridge = dynamic(() => import("./PrivyWalletBridge"), {
  ssr: false,
});
function LiveWalletRoot({ children }: { children: ReactNode }) {
  const { privyAppId } = useAuthConfig(),
    [binding, setBinding] = useState<WalletRuntime | null>(null);
  // The lazy provider runs as a single sibling so loading config or the SDK never remounts the editor.
  const value = privyAppId
    ? (binding ?? { ...browser, ready: false })
    : browser;
  return (
    <ctx.Provider value={value}>
      {children}
      {privyAppId && (
        <PrivyWalletBridge
          key={privyAppId}
          appId={privyAppId}
          publish={setBinding}
        />
      )}
    </ctx.Provider>
  );
}
export default function WalletRuntimeRoot({
  children,
}: {
  children: ReactNode;
}) {
  return API_MODE === "live" ? (
    <LiveWalletRoot>{children}</LiveWalletRoot>
  ) : (
    <>{children}</>
  );
}
