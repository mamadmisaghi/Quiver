// M5.9 user-supplied secrets (RPC URLs, AI keys), encrypted at rest with AES-256-GCM.
// Key = HKDF-SHA256(SECRETS_MASTER_KEY, info "quiver-user-secrets-v1"). AAD binds each ciphertext to owner + kind + id,
// so a row copied to another user or kind fails to decrypt. Plaintext is never returned by the API or logged.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export class VaultUnavailable extends Error {}
export function parseMasterKey(raw: string | undefined): Buffer | null {
  if (!raw) return null; const t = raw.trim();
  const b = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, "hex") : /^[A-Za-z0-9+/_-]{43}=?$/.test(t) ? Buffer.from(t, "base64") : null;
  return b && b.length === 32 ? b : null;
}
export class SecretVault {
  private key: Buffer | null; readonly keyId: string | null;
  constructor(master: string | undefined) {
    const m = parseMasterKey(master); this.key = m ? Buffer.from(hkdfSync("sha256", m, Buffer.alloc(0), "quiver-user-secrets-v1", 32)) : null;
    this.keyId = this.key ? createHash("sha256").update(this.key).digest("hex").slice(0, 12) : null;
  }
  get available() { return !!this.key; }
  seal(plain: string, aad: string): string {
    if (!this.key) throw new VaultUnavailable("SECRETS_MASTER_KEY is not set.");
    const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", this.key, iv, { authTagLength: 16 }); c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return `v1.${this.keyId}.${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url")}`;
  }
  open(sealed: string, aad: string): string | null {
    if (!this.key) return null; const [v, kid, blob] = sealed.split(".");
    if (v !== "v1" || kid !== this.keyId || !blob) return null;
    try { const b = Buffer.from(blob, "base64url"); if (b.length < 28) return null; const d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12), { authTagLength: 16 }); /* M5.10: tag pinned to 16 bytes */ d.setAAD(Buffer.from(aad)); d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); } catch { return null; }
  }
}
