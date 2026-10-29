/** M3.4: strip bearer tokens, JWTs, API keys and URL credentials/query secrets from log strings. */
export function redact(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[key]")
    .replace(/([?&](?:token|key|api_key|apikey|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b0x[0-9a-fA-F]{64}\b/g, "[hex64]")
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[creds]@");
}
