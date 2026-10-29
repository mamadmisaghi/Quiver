// M5.6: chart-screenshot input. Type is sniffed from magic bytes (the declared type must match), size and
// dimensions are bounded. Images are never stored or logged; only a SHA-256 goes to the audit log.
import { createHash } from "node:crypto";
import { crc32, inflateSync } from "node:zlib";

export const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];
export const IMAGE_MAX_BYTES = 2_000_000; export const IMAGE_MIN_PX = 64; export const IMAGE_MAX_PX = 4096;
/** M5.10: pixel-area cap (bomb guard), e.g. 4096x2048 or 2896x2896. */ export const IMAGE_MAX_AREA = 8_388_608;
export type ImageCheck = { ok: true; mime: ImageMime; width: number; height: number; bytes: number; sha256: string } | { ok: false; reason: "too_large" | "bad_encoding" | "unsupported_type" | "type_mismatch" | "bad_dimensions" | "corrupt"; message: string };

export function sniff(b: Buffer): ImageMime | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
export function dimensions(b: Buffer, m: ImageMime): { width: number; height: number } | null {
  try {
    if (m === "image/png") return b.toString("ascii", 12, 16) === "IHDR" ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
    if (m === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1]; if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
        const len = b.readUInt16BE(i + 2);
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + len;
      }
      return null;
    }
    const k = b.toString("ascii", 12, 16);
    if (k === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (k === "VP8L") { const v = b.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
    if (k === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  } catch { return null; }
}
/** M5.10: per-format structural validation. PNG: chunk CRCs, IHDR first, IEND last with nothing after, IDAT fully inflated
 *  (bounded to the exact expected size) so the pixel stream really decodes. JPEG: marker walk SOI..SOF..SOS..EOI, no trailing bytes.
 *  WebP: RIFF length equals file length, chunk walk with sane sizes. Anything else (polyglots, appended payloads) is "corrupt". */
export function validateStructure(b: Buffer, m: ImageMime, d: { width: number; height: number }): string | null {
  try {
    if (m === "image/png") {
      let i = 8; let first = true; let ihdr: Buffer | null = null; const idat: Buffer[] = []; let end = false;
      while (i + 12 <= b.length) {
        const len = b.readUInt32BE(i); const type = b.toString("latin1", i + 4, i + 8); if (len > b.length - i - 12) return "chunk overruns file";
        const data = b.subarray(i + 8, i + 8 + len); if ((crc32(b.subarray(i + 4, i + 8 + len)) >>> 0) !== b.readUInt32BE(i + 8 + len)) return "bad chunk CRC";
        if (first && type !== "IHDR") return "IHDR must be first"; first = false;
        if (type === "IHDR") ihdr = data; else if (type === "IDAT") idat.push(data); else if (type === "IEND") { end = true; i += 12 + len; break; }
        i += 12 + len;
      }
      if (!ihdr || ihdr.length !== 13 || !end) return "missing IHDR/IEND"; if (i !== b.length) return "data after IEND";
      if (ihdr[12] !== 0) return "interlaced PNG not supported";
      const depth = ihdr[8]!; const ct = ihdr[9]!; const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct]; if (!ch || ![1, 2, 4, 8, 16].includes(depth)) return "bad color type/depth";
      const expected = d.height * (1 + Math.ceil((d.width * ch * depth) / 8));
      const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 }); if (raw.length !== expected) return "pixel data size mismatch";
      for (let y = 0; y < d.height; y++) if (raw[y * (expected / d.height)]! > 4) return "bad filter byte";
      return null;
    }
    if (m === "image/jpeg") {
      let i = 2; let sof = false; let sos = false;
      while (i + 2 <= b.length) {
        if (b[i] !== 0xff) return "bad marker"; const mk = b[i + 1]!;
        if (mk === 0xff) { i++; continue; } if (mk === 0xd9) return sos && sof && i + 2 === b.length ? null : "data after EOI";
        if (mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
        if (i + 4 > b.length) return "truncated"; const len = b.readUInt16BE(i + 2); if (len < 2 || i + 2 + len > b.length) return "segment overruns file";
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) sof = true;
        i += 2 + len;
        if (mk === 0xda) { if (!sof) return "scan before frame"; sos = true; // entropy-coded data: skip to next non-RST marker
          while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1]! >= 0xd0 && b[i + 1]! <= 0xd7))) i++; }
      }
      return "missing EOI";
    }
    if (b.readUInt32LE(4) + 8 !== b.length) return "RIFF size mismatch";
    let i = 12; let img = false;
    while (i + 8 <= b.length) { const k = b.toString("latin1", i, i + 4); const len = b.readUInt32LE(i + 4); const next = i + 8 + len + (len & 1); if (next > b.length) return "chunk overruns file";
      if (k === "VP8 " || k === "VP8L" || k === "ANMF") img = true; i = next; }
    return i === b.length && img ? null : "no image data";
  } catch { return "unreadable"; }
}
export function checkImage(base64: string, declared: string): ImageCheck {
  if (!(IMAGE_MIME as readonly string[]).includes(declared)) return { ok: false, reason: "unsupported_type", message: "Use a PNG, JPEG or WebP screenshot." };
  const pre = /^data:([^;,]+);base64,/.exec(base64); // M5.10: a data-URL prefix must name the declared type
  if (pre && pre[1]!.toLowerCase() !== declared) return { ok: false, reason: "type_mismatch", message: `The data URL says ${pre[1]}, not ${declared}.` };
  const clean = pre ? base64.slice(pre[0].length) : base64;
  if (Math.floor(clean.length * 3 / 4) > IMAGE_MAX_BYTES + 3) return { ok: false, reason: "too_large", message: `Image is over ${IMAGE_MAX_BYTES / 1e6} MB. Crop or compress it.` };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return { ok: false, reason: "bad_encoding", message: "Image must be base64." };
  const b = Buffer.from(clean, "base64");
  if (b.length > IMAGE_MAX_BYTES) return { ok: false, reason: "too_large", message: `Image is over ${IMAGE_MAX_BYTES / 1e6} MB. Crop or compress it.` };
  const m = sniff(b); if (!m) return { ok: false, reason: "unsupported_type", message: "That file isn't a PNG, JPEG or WebP image." };
  if (m !== declared) return { ok: false, reason: "type_mismatch", message: `File content is ${m}, not ${declared}.` };
  const d = dimensions(b, m); if (!d) return { ok: false, reason: "corrupt", message: "Couldn't read the image size; the file may be damaged." };
  if (d.width < IMAGE_MIN_PX || d.height < IMAGE_MIN_PX || d.width > IMAGE_MAX_PX || d.height > IMAGE_MAX_PX) return { ok: false, reason: "bad_dimensions", message: `Image must be ${IMAGE_MIN_PX}–${IMAGE_MAX_PX} px on each side.` };
  if (d.width * d.height > IMAGE_MAX_AREA) return { ok: false, reason: "bad_dimensions", message: "Image has too many pixels; use a smaller screenshot (up to about 8 megapixels)." };
  const bad = validateStructure(b, m, d); if (bad) return { ok: false, reason: "corrupt", message: "That image file is malformed or has extra data appended." };
  return { ok: true, mime: m, ...d, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") };
}
