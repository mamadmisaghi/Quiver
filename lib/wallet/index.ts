// M3.9: minimal EIP-1193 wallet client (window.ethereum). No library, no auto-send: every function here is called
// from a button handler. The server never sees a private key; we only relay signatures and tx hashes.
export type Eip1193 = { request: (a: { method: string; params?: unknown[] | object }) => Promise<unknown> };
export const TESTNET_CHAIN_HEX = "0xb626"; // 46630, Robinhood Chain testnet

export class WalletErr extends Error {
  constructor(public kind: "no_wallet" | "rejected" | "wrong_chain" | "failed", msg: string) { super(msg); }
}
const eth = (): Eip1193 | null => (typeof window !== "undefined" ? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) : null);
export const hasWallet = () => eth() != null;

function wrap(e: unknown): WalletErr {
  const c = (e as { code?: number })?.code;
  if (c === 4001) return new WalletErr("rejected", "You declined in your wallet. Nothing was signed or sent.");
  return new WalletErr("failed", (e as { message?: string })?.message?.slice(0, 200) || "The wallet returned an error.");
}
async function call<T>(method: string, params?: unknown[]): Promise<T> {
  const p = eth(); if (!p) throw new WalletErr("no_wallet", "No browser wallet found. Install or unlock one, then try again.");
  try { return (await p.request({ method, params })) as T; } catch (e) { throw wrap(e); }
}

/** Ask the wallet for the owner account. Must match the account Quiver knows. */
export async function connect(): Promise<string> {
  const a = await call<string[]>("eth_requestAccounts");
  if (!a?.length) throw new WalletErr("failed", "The wallet didn’t share an account.");
  return a[0];
}
export async function ensureChain(): Promise<void> {
  if ((await call<string>("eth_chainId")).toLowerCase() === TESTNET_CHAIN_HEX) return;
  await call("wallet_switchEthereumChain", [{ chainId: TESTNET_CHAIN_HEX }]);
  if ((await call<string>("eth_chainId")).toLowerCase() !== TESTNET_CHAIN_HEX) throw new WalletErr("wrong_chain", "Switch your wallet to Robinhood Chain testnet (46630) and try again.");
}
/** M5.2 wallet link: EIP-191 personal_sign of the server's challenge message. Call from a click handler only. */
export const personalSign = (address: string, message: string) => call<string>("personal_sign", [message, address]);
export const signTypedData = (owner: string, data: unknown) => call<string>("eth_signTypedData_v4", [owner, JSON.stringify(data)]);

type Install = { params: [{ from: string; calls: { to: string; data: string; value: string }[] } & Record<string, unknown>] };
/** EIP-5792 wallet_sendCalls; wallets without it fall back to a single eth_sendTransaction. Returns the tx hash. */
export async function sendInstall(install: Install, onStatus?: (s: string) => void): Promise<{ txHash: string; via: "5792" | "tx" }> {
  let has5792 = true;
  try { await call("wallet_getCapabilities", [install.params[0].from]); } catch { has5792 = false; }
  if (has5792) {
    const r = await call<{ id: string } | string>("wallet_sendCalls", install.params);
    const id = typeof r === "string" ? r : r.id;
    for (let i = 0; i < 60; i++) {
      onStatus?.("Waiting for the install to confirm…");
      const st = await call<{ status: number | string; receipts?: { transactionHash: string }[] }>("wallet_getCallsStatus", [id]);
      if (Number(st.status) === 200 && st.receipts?.[0]?.transactionHash) return { txHash: st.receipts[0].transactionHash, via: "5792" };
      if (Number(st.status) >= 400) throw new WalletErr("failed", "The install transaction failed in your wallet.");
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new WalletErr("failed", "The install is taking too long. Check your wallet’s activity.");
  }
  const c = install.params[0].calls[0];
  return { txHash: await call<string>("eth_sendTransaction", [{ from: install.params[0].from, to: c.to, data: c.data, value: c.value }]), via: "tx" };
}

export type TestnetTx = { chainId: number; from: string; to: string; data: string; value: string };
/** M5.23: send ONE server-prepared unsigned tx from the user's own wallet. Testnet 46630 only: the tx must say 46630,
 *  the wallet must be on 46630 (we ask it to switch, then re-check), and the wallet account must be the tx's `from`.
 *  Call from a click handler only — nothing here runs on its own. Returns the tx hash. */
export async function sendTestnetTx(tx: TestnetTx): Promise<string> {
  if (tx.chainId !== 46630) throw new WalletErr("wrong_chain", "Refused: this transaction isn’t for Robinhood Chain testnet (46630).");
  const acct = (await connect()).toLowerCase();
  if (acct !== tx.from.toLowerCase()) throw new WalletErr("failed", `Switch your wallet to ${tx.from.slice(0, 6)}…${tx.from.slice(-4)}, the address this was prepared for.`);
  await ensureChain();
  if ((await call<string>("eth_chainId")).toLowerCase() !== TESTNET_CHAIN_HEX) throw new WalletErr("wrong_chain", "Switch your wallet to Robinhood Chain testnet (46630) and try again.");
  return call<string>("eth_sendTransaction", [{ from: tx.from, to: tx.to, data: tx.data, value: "0x" + BigInt(tx.value).toString(16), chainId: TESTNET_CHAIN_HEX }]);
}
/** Poll the wallet's RPC until the tx is mined (or ~2 min). true = success, false = reverted, null = still pending. */
export async function waitReceipt(hash: string): Promise<boolean | null> {
  for (let i = 0; i < 60; i++) {
    const r = await call<{ status?: string } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r?.status) return r.status === "0x1";
    await new Promise((res) => setTimeout(res, 2000));
  }
  return null;
}
