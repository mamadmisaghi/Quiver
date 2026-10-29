import { randomBytes } from "node:crypto";
const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Prefixed, time-sortable id: <prefix>_<10 time chars><10 random chars> */
/** M3.7: test/fixture hook. A deterministic byte source makes ids reproducible (fixture generator); null = crypto. */
let idBytes: ((n: number) => Uint8Array) | null = null;
export function setIdRandom(f: ((n: number) => Uint8Array) | null) { idBytes = f; }
/** Seeded byte source (mulberry32) for setIdRandom. Never use for secrets. */
export function seededBytes(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) & 0xff; };
  return (n: number) => Uint8Array.from({ length: n }, next);
}
export function newId(prefix: string, now = Date.now()): string {
  let t = now, ts = "";
  for (let i = 0; i < 10; i++) { ts = ALPHA[t % 32] + ts; t = Math.floor(t / 32); }
  const rb = idBytes ? idBytes(10) : randomBytes(10);
  let r = ""; for (const b of rb) r += ALPHA[b % 32];
  return `${prefix}_${ts}${r}`;
}
