// M5.2 placeholder chain config for Privy's embedded/external wallets. Testnet only: no mainnet chain is defined anywhere in the web app.
export const ROBINHOOD_TESTNET = {
  id: 46630, name: "Robinhood Chain Testnet", network: "robinhood-testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] }, public: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  testnet: true,
} as const;
