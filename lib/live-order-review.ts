import type { Allowance, HandOff, LiveOrder, PublicQuote } from "./live-client";
import type { RobinhoodTx } from "./wallet/live-evm";
const router = "0xcaf681a66d020601342297493863e78c959e5cb2";
const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const weth = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const address = (s: unknown) =>
  typeof s === "string" && /^0x[0-9a-f]{40}$/i.test(s) ? s.toLowerCase() : "";
const must = (ok: unknown, why: string) => {
  if (!ok) throw Error(why);
};
const natural = (s: string) =>
  /^(0|[1-9]\d{0,77})$/.test(s) ? BigInt(s) : undefined;
function abiWord(hex: string, n: number) {
  const start = 64 * n;
  must(
    Number.isSafeInteger(start) && start >= 0 && start + 64 <= hex.length,
    "The wallet call has an invalid ABI layout.",
  );
  return BigInt("0x" + hex.slice(start, start + 64));
}
function abiAddr(hex: string, n: number) {
  const word = hex.slice(64 * n, 64 * n + 64);
  must(
    /^0{24}[0-9a-f]{40}$/.test(word),
    "The transaction contains a malformed recipient.",
  );
  return "0x" + word.slice(24);
}
function dynamicBytes(hex: string, word: number, maxBytes: number) {
  const n = Number(abiWord(hex, word)),
    begin = (word + 1) * 64;
  must(
    Number.isSafeInteger(n) && n > 0 && n <= maxBytes,
    "Invalid transaction payload length.",
  );
  const end = begin + n * 2;
  must(
    hex.length === begin + Math.ceil(n / 32) * 64 &&
      /^0*$/.test(hex.slice(end)),
    "The transaction has extra instructions or noncanonical trailing bytes.",
  );
  return hex.slice(begin, end);
}
export function checkStockAllowance(view: Allowance, tx: RobinhoodTx) {
  must(
    !!address(view.wallet) &&
      !!address(view.asset) &&
      address(tx.from) === address(view.wallet) &&
      address(tx.to) === address(view.asset) &&
      tx.chainId.toLowerCase() === "0x1237" &&
      BigInt(tx.value) === 0n,
    "Wrong approval wallet, contract or chain.",
  );
  must(
    natural(view.amount) !== undefined && natural(view.fee) !== undefined,
    "Invalid reviewed allowance.",
  );
  const d = tx.data.slice(2).toLowerCase();
  must(
    d.startsWith("095ea7b3") && d.length === 8 + 128,
    "Only a single exact ERC-20 approval is supported.",
  );
  const args = d.slice(8);
  must(
    abiAddr(args, 0) === router &&
      abiWord(args, 1) === natural(view.amount) &&
      (view.kind !== "approve_zero" || view.amount === "0"),
    "Approval spender or amount differs from the review.",
  );
  must(
    BigInt(tx.gas) * BigInt(tx.gasPrice) <= BigInt(view.fee),
    "This transaction exceeds your network fee cap.",
  );
}
export function checkStockHandoff(
  order: LiveOrder,
  runId: string,
  id: string,
  h: HandOff,
): PublicQuote {
  must(
    id === runId &&
      h.network === "robinhood-mainnet" &&
      h.orderId === order.id &&
      h.digest === order.digest &&
      address(h.wallet) === address(order.wallet) &&
      h.expiresAt === order.expiresAt &&
      Date.now() < h.expiresAt,
    "The reviewed order expired or changed.",
  );
  const q = order.quote;
  if (!q)
    throw Error(
      "Reopen the order to verify its minimum output and network fee.",
    );
  const tx = h.packet;
  must(
    /^0x[0-9a-f]+$/i.test(tx.nonce) &&
      h.recoveryId.toLowerCase() ===
        "rh:4663:" + address(order.wallet) + ":" + BigInt(tx.nonce).toString(),
    "The wallet nonce differs from the durable execution claim.",
  );
  must(
    tx.chainId.toLowerCase() === "0x1237" &&
      BigInt(tx.value) === 0n &&
      address(tx.from) === address(order.wallet) &&
      address(tx.to) === router,
    "The wallet transaction targets a different venue, wallet or chain.",
  );
  must(
    q.inputUnits === order.spendUnits &&
      q.expiresAt === order.expiresAt &&
      natural(q.inputUnits) !== undefined &&
      natural(q.minimumOutputUnits) !== undefined &&
      BigInt(q.minimumOutputUnits) > 0n &&
      natural(q.maxFeeWei) !== undefined,
    "Invalid reviewed stock swap amounts.",
  );
  must(
    BigInt(tx.gas) * BigInt(tx.gasPrice) <= BigInt(q.maxFeeWei),
    "The transaction exceeds the reviewed network fee cap.",
  );
  const stock = address(order.market.address),
    sell = order.side === "sell" || order.leg === "exit";
  must(
    stock &&
      address(q.inputToken) === (sell ? stock : usdg) &&
      address(q.outputToken) === (sell ? usdg : stock),
    "Swap mints differ from the selected stock market.",
  );
  const d = tx.data.slice(2).toLowerCase();
  must(
    /^5ae401dc[0-9a-f]+$/.test(d),
    "Only an exact, deadline-bound router swap is supported.",
  );
  const args = d.slice(8);
  must(
    abiWord(args, 0) === BigInt(Math.floor(q.expiresAt / 1000)) &&
      abiWord(args, 1) === 64n &&
      abiWord(args, 2) === 1n &&
      abiWord(args, 3) === 32n,
    "Unexpected swap deadline or nested calls.",
  );
  const sub = dynamicBytes(args, 4, 1024);
  must(sub.startsWith("b858183f"), "Unsupported router instruction.");
  const x = sub.slice(8);
  must(
    abiWord(x, 0) === 32n &&
      abiWord(x, 1) === 128n &&
      abiAddr(x, 2) === address(order.wallet) &&
      abiWord(x, 3) === BigInt(q.inputUnits) &&
      abiWord(x, 4) === BigInt(q.minimumOutputUnits),
    "Wallet, exact input or minimum output changed.",
  );
  const path = dynamicBytes(x, 5, 66);
  must(
    path.length === 86 || path.length === 132,
    "Unsupported swap path length.",
  );
  must(
    "0x" + path.slice(0, 40) === address(q.inputToken) &&
      "0x" + path.slice(-40) === address(q.outputToken),
    "The swap path endpoints changed.",
  );
  const fees =
    path.length === 86
      ? [path.slice(40, 46)]
      : [path.slice(40, 46), path.slice(86, 92)];
  must(
    fees.every((f) => [100, 500, 3000, 10000].includes(parseInt(f, 16))),
    "Unverified pool fee tier.",
  );
  if (path.length === 132)
    must("0x" + path.slice(46, 86) === weth, "Unknown intermediate token.");
  return q;
}
