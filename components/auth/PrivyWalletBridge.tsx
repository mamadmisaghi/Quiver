"use client";
import { useEffect, useRef } from "react";
import {
  PrivyProvider,
  useIdentityToken,
  useLogin,
  useSigners,
  useLinkAccount,
  usePrivy,
  useWallets as useEthereumWallets,
  getIdentityToken,
} from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignTransaction,
  useCreateWallet as useCreateSolana,
  useSignMessage,
  toSolanaWalletConnectors,
  defaultSolanaRpcsPlugin,
} from "@privy-io/react-auth/solana";
import { signInWithPrivy, raw } from "@/lib/api/live";
import { CHAINS, type EvmSigner } from "@/lib/wallet/live-evm";
import type { SolanaSigner } from "@/lib/wallet/live-solana";
import type { WalletRuntime } from "./WalletRuntime";

type Waiter = { resolve: () => void; reject: (e: Error) => void };
const connectors = toSolanaWalletConnectors({ shouldAutoConnect: false });
const rpcs = defaultSolanaRpcsPlugin();
const chains = Object.values(CHAINS).map((c) => ({
  ...c,
  rpcUrls: { default: { http: [...c.rpcUrls.default.http] } },
}));
function Bridge({
  publish,
}: {
  publish: (value: WalletRuntime | null) => void;
}) {
  const privy = usePrivy(),
    evm = useEthereumWallets(),
    sol = useSolanaWallets(),
    { addSigners, removeSigners } = useSigners(),
    { createWallet } = useCreateSolana(),
    { signTransaction } = useSignTransaction(),
    { signMessage } = useSignMessage(),
    { identityToken } = useIdentityToken();
  const pending = useRef<Waiter[]>([]),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    working = useRef(false);
  const failed = (e: Error) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    for (const w of pending.current.splice(0)) w.reject(e);
  };
  const exchange = async () => {
    if (!pending.current.length || working.current) return;
    working.current = true;
    try {
      const idToken = await getIdentityToken();
      if (!idToken) return;
      await signInWithPrivy(idToken);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      for (const w of pending.current.splice(0)) w.resolve();
    } catch (e) {
      failed(e instanceof Error ? e : Error("Could not verify your account."));
    } finally {
      working.current = false;
    }
  };
  type Linking = {
    family: "ethereum" | "solana";
    sub: string;
    waiter: Waiter;
    timer: ReturnType<typeof setTimeout>;
    address?: string;
  };
  const linking = useRef<Linking | null>(null),
    linkSyncing = useRef(false);
  const finishLink = (error?: Error) => {
    const l = linking.current;
    if (!l) return;
    clearTimeout(l.timer);
    linking.current = null;
    if (error) l.waiter.reject(error);
    else l.waiter.resolve();
  };
  const syncLinked = async () => {
    const l = linking.current;
    if (!l?.address || linkSyncing.current) return;
    linkSyncing.current = true;
    try {
      const token = await getIdentityToken();
      if (!token) return;
      // Inspect only to wait for the new signed claim; the backend verifies the complete token and linked account.
      const p = JSON.parse(
        atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
      );
      const claims =
        typeof p.linked_accounts === "string"
          ? JSON.parse(p.linked_accounts)
          : p.linked_accounts;
      const same = (a: string, b: string) =>
        l.family === "ethereum" ? a.toLowerCase() === b.toLowerCase() : a === b;
      if (p.sub !== l.sub) {
        finishLink(Error("The signed-in account changed during linking."));
        return;
      }
      if (
        !Array.isArray(claims) ||
        !claims.some(
          (a: Record<string, unknown>) =>
            a.type === "wallet" &&
            (a.chain_type ?? "ethereum") === l.family &&
            typeof a.address === "string" &&
            same(a.address, l.address!),
        )
      )
        return;
      await signInWithPrivy(token);
      const r = await raw("/execution");
      const linked = (await r.json()) as {
        ethereumWallets?: string[];
        solanaWallets?: string[];
      };
      if (linking.current !== l) return;
      const available =
        l.family === "ethereum" ? linked.ethereumWallets : linked.solanaWallets;
      if (!available?.some((a) => same(a, l.address!)))
        throw Error(
          "The server could not attach this wallet. Check the account or its wallet limit.",
        );
      finishLink();
    } catch (e) {
      if (linking.current === l)
        finishLink(
          e instanceof Error ? e : Error("Could not verify the linked wallet."),
        );
    } finally {
      linkSyncing.current = false;
    }
  };
  const { linkWallet } = useLinkAccount({
    onSuccess: ({ user, linkedAccount }) => {
      const l = linking.current;
      if (!l) return;
      if (
        user.id !== l.sub ||
        linkedAccount.type !== "wallet" ||
        linkedAccount.chainType !== l.family
      ) {
        finishLink(Error("Different account or wallet family."));
        return;
      }
      l.address = linkedAccount.address;
      void syncLinked();
    },
    onError: () => finishLink(Error("Wallet linking was not completed.")),
  });
  const { login } = useLogin({
    onComplete: () => void exchange(),
    onError: () => failed(Error("Sign-in was not completed.")),
  });
  const latest = useRef({
    evm,
    sol,
    privy,
    signMessage,
    signTransaction,
    addSigners,
    removeSigners,
    createWallet,
    login,
    exchange,
    linkWallet,
    syncLinked,
  });
  latest.current = {
    evm,
    sol,
    privy,
    signMessage,
    signTransaction,
    addSigners,
    removeSigners,
    createWallet,
    login,
    exchange,
    linkWallet,
    syncLinked,
  };
  useEffect(() => {
    if (identityToken && privy.authenticated) {
      void latest.current.exchange();
      void latest.current.syncLinked();
    }
  }, [identityToken, privy.authenticated]);
  const addresses = evm.wallets
      .map((w) => w.address.toLowerCase())
      .sort()
      .join(","),
    solAddresses = sol.wallets
      .map((w) => w.address)
      .sort()
      .join(",");
  useEffect(() => {
    // Methods resolve the current SDK wallet each time. A retained signer cannot silently switch to another account.
    const evmFor = (addr: string) => {
      const w = latest.current.evm.wallets.find(
        (w) => w.address.toLowerCase() === addr.toLowerCase(),
      );
      if (!w) throw Error("Connect and select the linked EVM wallet.");
      return w;
    };
    const solFor = (addr: string) => {
      const w = latest.current.sol.wallets.find((w) => w.address === addr);
      if (!w) throw Error("Connect and select the linked Solana wallet.");
      return w;
    };
    function requireOwner() {
      const cur = latest.current.privy;
      if (!cur.authenticated || !cur.user?.id)
        throw Error("Sign in to manage wallet permissions.");
      return cur.user.id;
    }
    async function grantFor(
      address: string,
      match: (grant: {
        executor: string;
        id: string;
        signerId: string;
        policyId: string;
        status: string;
      }) => boolean,
    ) {
      const owner = requireOwner();
      const response = await raw("/live/spot-permissions");
      const body = (await response.json()) as {
        enabled: boolean;
        grants: {
          executor: string;
          id: string;
          signerId: string;
          policyId: string;
          status: string;
        }[];
      };
      if (owner !== requireOwner() || !body.enabled)
        throw Error("Wallet authorization is unavailable.");
      const hits = body.grants.filter(
        (g) => g.executor === address && match(g),
      );
      if (hits.length !== 1)
        throw Error("Choose the current execution wallet permission.");
      return { owner, grant: hits[0] };
    }
    publish({
      provider: "privy",
      ready: privy.ready && evm.ready && sol.ready,
      createAdditionalSolanaWallet: async () => {
        const sub = requireOwner();
        await latest.current.createWallet({ createAdditional: true });
        if (sub !== requireOwner())
          throw Error("The account changed during wallet creation.");
      },
      addSpotSigner: async (address, signerId, policyId) => {
        const { owner } = await grantFor(
          address,
          (g) =>
            g.status === "offered" &&
            g.signerId === signerId &&
            g.policyId === policyId,
        );
        await latest.current.addSigners({
          address,
          signers: [{ signerId, policyIds: [policyId] }],
        });
        if (owner !== requireOwner())
          throw Error("The account changed during wallet authorization.");
      },
      removeSoleSpotSigner: async (address) => {
        const owner = requireOwner();
        const response = await raw("/live/spot-permissions");
        const data = (await response.json()) as {
          grants: { executor: string; id: string; status: string }[];
        };
        let safeId: string | undefined;
        for (const grant of data.grants.filter(
          (g) => g.executor === address && g.status === "disabled",
        )) {
          const proof = (await (
            await raw(
              "/live/spot-permissions/" +
                encodeURIComponent(grant.id) +
                "/owner-revoke",
            )
          ).json()) as { removeAllSafe: boolean; executor: string };
          if (proof.removeAllSafe && proof.executor === address) {
            safeId = grant.id;
            break;
          }
        }
        if (!safeId || owner !== requireOwner())
          throw Error(
            "Quiver is not the only signer on this execution wallet.",
          );
        const latestProof = (await (
          await raw(
            "/live/spot-permissions/" +
              encodeURIComponent(safeId) +
              "/owner-revoke",
          )
        ).json()) as { removeAllSafe: boolean; executor: string };
        if (
          !latestProof.removeAllSafe ||
          latestProof.executor !== address ||
          owner !== requireOwner()
        )
          throw Error("Wallet permissions changed. Review them again.");
        await latest.current.removeSigners({ address });
      },
      ethereum: addresses ? addresses.split(",") : [],
      solana: solAddresses ? solAddresses.split(",") : [],
      login: () =>
        new Promise<void>((resolve, reject) => {
          const first = pending.current.length === 0;
          pending.current.push({ resolve, reject });
          if (!first) return;
          timer.current = setTimeout(
            () =>
              failed(
                Error(
                  "Could not retrieve the wallet identity. Check the sign-in window and retry.",
                ),
              ),
            120000,
          );
          try {
            if (latest.current.privy.authenticated)
              void latest.current.exchange();
            else latest.current.login();
          } catch (e) {
            failed(e instanceof Error ? e : Error("Could not start sign-in."));
          }
        }),
      link: (family) =>
        new Promise<void>((resolve, reject) => {
          const { privy, linkWallet } = latest.current;
          if (!privy.authenticated || !privy.user) {
            reject(Error("Sign in before linking another wallet."));
            return;
          }
          if (linking.current) {
            reject(Error("A wallet link is already in progress."));
            return;
          }
          linking.current = {
            family,
            sub: privy.user.id,
            waiter: { resolve, reject },
            timer: setTimeout(
              () =>
                finishLink(
                  Error(
                    "Wallet verification timed out. Refresh your account and retry.",
                  ),
                ),
              120000,
            ),
          };
          try {
            linkWallet({
              walletChainType:
                family === "solana" ? "solana-only" : "ethereum-only",
            });
          } catch (e) {
            finishLink(
              e instanceof Error ? e : Error("Could not start wallet linking."),
            );
          }
        }),
      selectEvm: async (address): Promise<EvmSigner> => {
        evmFor(address);
        return {
          address,
          getProvider: () => evmFor(address).getEthereumProvider(),
          switchChain: (chain) => evmFor(address).switchChain(chain),
        };
      },
      selectSolana: async (address): Promise<SolanaSigner> => {
        solFor(address);
        return {
          address,
          connectedAddress: () => solFor(address).address,
          sign: async (transaction, chain) =>
            (
              await latest.current.signTransaction({
                transaction,
                wallet: solFor(address),
                chain,
              })
            ).signedTransaction,
          signText: async (message) =>
            (
              await latest.current.signMessage({
                message,
                wallet: solFor(address),
              })
            ).signature,
        };
      },
    });
  }, [
    publish,
    privy.ready,
    privy.authenticated,
    evm.ready,
    sol.ready,
    addresses,
    solAddresses,
  ]);
  useEffect(
    () => () => {
      failed(Error("Wallet session closed."));
      finishLink(Error("Wallet session closed."));
      publish(null);
    },
    [publish],
  );
  return null;
}
export default function PrivyWalletBridge({
  appId,
  publish,
}: {
  appId: string;
  publish: (value: WalletRuntime | null) => void;
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: chains.find((c) => c.id === 42161),
        supportedChains: chains,
        plugins: [rpcs],
        appearance: { theme: "dark", walletChainType: "ethereum-and-solana" },
        externalWallets: { solana: { connectors } },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <Bridge publish={publish} />
    </PrivyProvider>
  );
}
