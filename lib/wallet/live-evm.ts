// Wallet operations called only by an explicit user action. Server-side policy, authorization and receipt checks are independent.
export type EvmNetwork = 42161 | 421614 | 4663 | 46630;
export const CHAINS = {
  42161: {
    id: 42161,
    name: "Arbitrum One",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://arb1.arbitrum.io/rpc"] } },
  },
  421614: {
    id: 421614,
    name: "Arbitrum Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
    testnet: true,
  },
  4663: {
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  },
  46630: {
    id: 46630,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
    testnet: true,
  },
} as const;
type Hex = `0x${string}`;
export type EvmProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
export type EvmSigner = {
  address: string;
  getProvider: () => Promise<EvmProvider>;
  switchChain?: (chainId: number) => Promise<void>;
};
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
function object(x: unknown): Record<string, unknown> {
  check(
    x !== null && typeof x === "object" && !Array.isArray(x),
    "Unexpected wallet payload.",
  );
  return x as Record<string, unknown>;
}
function address(s: unknown) {
  check(
    typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s),
    "Invalid wallet address.",
  );
  return s.toLowerCase() as Hex;
}
function quantity(s: unknown) {
  check(
    typeof s === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(s),
    "Invalid RPC quantity.",
  );
  return BigInt(s);
}
function code(error: unknown) {
  return error && typeof error === "object"
    ? Number((error as { code?: unknown }).code)
    : undefined;
}
async function account(
  provider: EvmProvider,
  owner: string,
  network: EvmNetwork,
) {
  const [id, addresses] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  check(
    quantity(id) === BigInt(network),
    "The wallet is on a different network.",
  );
  check(
    Array.isArray(addresses) &&
      addresses.length &&
      address(addresses[0]) === owner,
    "Select the quoted owner account in your wallet.",
  );
}
async function providerFor(
  signer: EvmSigner,
  owner: string,
  network: EvmNetwork,
) {
  check(address(signer.address) === owner, "Select the linked owner wallet.");
  let provider = await signer.getProvider();
  const current = await provider.request({ method: "eth_chainId" });
  if (quantity(current) !== BigInt(network)) {
    if (signer.switchChain) await signer.switchChain(network);
    else {
      const id = "0x" + network.toString(16);
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: id }],
        });
      } catch (e) {
        if (code(e) !== 4902) throw e;
        const c = CHAINS[network];
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: id,
              chainName: c.name,
              nativeCurrency: c.nativeCurrency,
              rpcUrls: c.rpcUrls.default.http,
            },
          ],
        });
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: id }],
        });
      }
    }
    // Privy's switchChain makes existing provider instances stale.
    provider = await signer.getProvider();
  }
  await account(provider, owner, network);
  return provider;
}
/** Use only when the user explicitly chooses the browser wallet instead of a named SDK wallet. */
export async function injectedEvm(): Promise<EvmSigner> {
  const eth = (window as Window & { ethereum?: EvmProvider }).ethereum;
  check(
    eth && typeof eth.request === "function",
    "Connect an EVM wallet in this browser.",
  );
  const owners = await eth.request({ method: "eth_requestAccounts" });
  check(
    Array.isArray(owners) && owners.length,
    "Wallet connection was not granted.",
  );
  return { address: address(owners[0]), getProvider: async () => eth };
}
const domainFields = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;
const grantFields = [
  { name: "hyperliquidChain", type: "string" },
  { name: "agentAddress", type: "address" },
  { name: "agentName", type: "string" },
  { name: "nonce", type: "uint64" },
] as const;
const grantType = "HyperliquidTransaction:ApproveAgent",
  zero = "0x" + "0".repeat(40);
function keys(x: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(x).sort().join("|") === [...expected].sort().join("|");
}
function matchesFields(
  actual: unknown,
  expected: readonly { name: string; type: string }[],
) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((f, i) => {
      const v = actual[i];
      return (
        v &&
        typeof v === "object" &&
        keys(v, ["name", "type"]) &&
        v.name === f.name &&
        v.type === f.type
      );
    })
  );
}
export type GrantChallenge = {
  network: "mainnet" | "testnet";
  master: string;
  agent: string;
  typedData: unknown;
  purpose?: "authorize" | "revoke";
  slotName?: string;
  validUntil?: number;
};
export function inspectHyperliquidGrant(c: GrantChallenge) {
  const owner = address(c.master),
    agent = address(c.agent),
    typed = object(c.typedData),
    domain = object(typed.domain),
    message = object(typed.message),
    types = object(typed.types);
  const chainId = c.network === "mainnet" ? 42161 : 421614,
    networkLabel = c.network === "mainnet" ? "Mainnet" : "Testnet";
  check(
    c.network === "mainnet" || c.network === "testnet",
    "Unknown Hyperliquid network.",
  );
  check(
    owner !== zero &&
      agent !== owner &&
      agent !== zero &&
      keys(typed, ["domain", "types", "primaryType", "message"]) &&
      typed.primaryType === grantType,
    "Unexpected trading authorization.",
  );
  check(
    keys(types, ["EIP712Domain", grantType]) &&
      matchesFields(types.EIP712Domain, domainFields) &&
      matchesFields(types[grantType], grantFields),
    "The EIP-712 fields differ from the venue's agent authorization.",
  );
  check(
    keys(domain, ["name", "version", "chainId", "verifyingContract"]) &&
      domain.name === "HyperliquidSignTransaction" &&
      domain.version === "1" &&
      domain.chainId === chainId &&
      address(domain.verifyingContract) === zero,
    "Unexpected signing network or domain.",
  );
  check(
    keys(
      message,
      grantFields.map((f) => f.name),
    ) &&
      message.hyperliquidChain === networkLabel &&
      address(message.agentAddress) === agent,
    "The agent or network changed.",
  );
  const nonce = message.nonce;
  check(
    typeof nonce === "string" &&
      /^[1-9][0-9]{9,15}$/.test(nonce) &&
      Number.isSafeInteger(Number(nonce)),
    "Invalid grant nonce.",
  );
  const name =
    typeof message.agentName === "string"
      ? /^([A-Za-z0-9_-]{1,16}) valid_until ([1-9][0-9]{9,15})$/.exec(
          message.agentName,
        )
      : null;
  check(
    name && (!c.slotName || c.slotName === name[1]),
    "Unexpected named grant.",
  );
  const expiresAt = Number(name[2]),
    now = Date.now(),
    issued = Number(nonce),
    maxDuration = c.purpose === "revoke" ? 60000 : 86400000;
  check(
    (c.validUntil === undefined || expiresAt === c.validUntil) &&
      Number.isSafeInteger(expiresAt) &&
      expiresAt > now &&
      issued <= now + 10000 &&
      now - issued < 180000 &&
      expiresAt > issued &&
      expiresAt - issued <= maxDuration,
    "The approval has expired or exceeds the permitted lifetime.",
  );
  // Rebuild in protocol order from validated values for an immutable wire payload.
  const data = {
    domain: {
      name: domain.name,
      version: domain.version,
      chainId,
      verifyingContract: zero,
    },
    types: { EIP712Domain: domainFields, [grantType]: grantFields },
    primaryType: grantType,
    message: {
      hyperliquidChain: networkLabel,
      agentAddress: agent,
      agentName: name[0],
      nonce,
    },
  };
  return { owner, agent, chainId, slot: name[1], expiresAt, data } as const;
}
export async function signHyperliquidOwner(
  signer: EvmSigner,
  challenge: GrantChallenge,
) {
  const initial = inspectHyperliquidGrant(challenge);
  const provider = await providerFor(signer, initial.owner, initial.chainId);
  check(Date.now() < initial.expiresAt, "The owner authorization expired.");
  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [initial.owner, JSON.stringify(initial.data)],
  });
  check(
    typeof signature === "string" &&
      /^0x[0-9a-fA-F]{128}(?:1b|1c|00|01)$/i.test(signature),
    "Unexpected EVM signature.",
  );
  await account(provider, initial.owner, initial.chainId);
  check(Date.now() < initial.expiresAt, "The owner authorization expired.");
  return signature as Hex;
}

export type RobinhoodTx = {
  chainId: Hex;
  from: string;
  to: string;
  value: Hex;
  data: Hex;
  nonce: Hex;
  gas: Hex;
  gasPrice: Hex;
};
export type RobinhoodReview = {
  intentId: string;
  step: number;
  expiresAt: number;
  owner: string;
  maxNetworkFeeWei: string;
  tx: RobinhoodTx;
};
export type DispatchOutcome = {
  state: "submitted" | "unknown" | "rejected";
  hash?: Hex;
};
export type DurableDispatch = {
  /** The server must atomically reserve owner, exact transaction/nonce and one-time send permission. */
  claim: () => Promise<"claimed" | "already_claimed">;
  record: (outcome: DispatchOutcome) => Promise<void>;
};
export async function sendRobinhoodEOA(
  signer: EvmSigner,
  review: RobinhoodReview,
  dispatch: DurableDispatch,
): Promise<DispatchOutcome> {
  // Freeze the payload before the first await. RPC input is restricted to one chain, owner, nonce and explicit legacy gas cap.
  const tx = { ...review.tx },
    owner = address(review.owner);
  check(
    review.intentId &&
      Number.isSafeInteger(review.step) &&
      review.step >= 0 &&
      Date.now() < review.expiresAt,
    "The prepared transaction expired.",
  );
  check(
    keys(tx, [
      "chainId",
      "from",
      "to",
      "value",
      "data",
      "nonce",
      "gas",
      "gasPrice",
    ]) &&
      quantity(tx.chainId) === 4663n &&
      address(tx.from) === owner &&
      address(tx.to) !== owner &&
      address(tx.to) !== zero &&
      quantity(tx.value) === 0n,
    "Unexpected Robinhood account, network or value.",
  );
  check(
    /^0x(?:[0-9a-fA-F]{2}){4,8192}$/.test(tx.data) &&
      /^(?:0|[1-9][0-9]{0,35})$/.test(review.maxNetworkFeeWei),
    "Invalid call or gas limit.",
  );
  const gas = quantity(tx.gas),
    price = quantity(tx.gasPrice),
    nonce = quantity(tx.nonce);
  check(
    gas > 0n && price > 0n && gas * price <= BigInt(review.maxNetworkFeeWei),
    "Network fee exceeds your reviewed limit.",
  );
  const provider = await providerFor(signer, owner, 4663);
  check(
    quantity(
      await provider.request({
        method: "eth_getTransactionCount",
        params: [owner, "pending"],
      }),
    ) === nonce,
    "The account nonce changed. Refresh the prepared order.",
  );
  if ((await dispatch.claim()) !== "claimed") return { state: "unknown" };
  let sendStarted = false;
  let outcome: DispatchOutcome;
  try {
    await account(provider, owner, 4663);
    check(Date.now() < review.expiresAt, "The prepared transaction expired.");
    // A network failure from this call is ambiguous. Never resend or pick a replacement nonce.
    sendStarted = true;
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [tx],
    });
    outcome =
      typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)
        ? { state: "submitted", hash: hash as Hex }
        : { state: "unknown" };
  } catch (e) {
    outcome = {
      state: !sendStarted || code(e) === 4001 ? "rejected" : "unknown",
    };
  }
  // If recording fails after broadcast, preserve the hash for a read/reconciliation retry.
  try {
    await dispatch.record(outcome);
  } catch {
    return {
      ...outcome,
      state: outcome.state === "rejected" ? "rejected" : "unknown",
    };
  }
  return outcome;
}

export { providerFor as getReviewedEvmProvider, account as assertEvmAccount };
