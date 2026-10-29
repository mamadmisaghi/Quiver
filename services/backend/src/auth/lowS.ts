// M5.24b: signature malleability guard. Only canonical 65-byte ECDSA signatures with low-s (s <= n/2, EIP-2) and v in {27,28,0,1}.
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const HALF_N = N / 2n;
export function isLowS(sig: string): boolean {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return false;
  const r = BigInt("0x" + sig.slice(2, 66)), s = BigInt("0x" + sig.slice(66, 130)), v = parseInt(sig.slice(130, 132), 16);
  return r > 0n && r < N && s > 0n && s <= HALF_N && [0, 1, 27, 28].includes(v);
}
/** Flip a low-s signature to its high-s twin (tests only: proves the guard). */
export function toHighS(sig: string): string {
  const s = BigInt("0x" + sig.slice(66, 130)); const v = parseInt(sig.slice(130, 132), 16);
  const nv = v === 27 ? 28 : v === 28 ? 27 : v ^ 1;
  return sig.slice(0, 66) + (N - s).toString(16).padStart(64, "0") + nv.toString(16).padStart(2, "0");
}
