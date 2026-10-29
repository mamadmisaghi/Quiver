import { z } from "zod";

export const ErrorCode = z.enum([
  "service_unavailable",
  "unauthorized", "forbidden", "not_found", "conflict", "validation_failed", "rate_limited", "payload_too_large",
  "compile_failed", "unsupported_prompt", "compile_quota_exceeded", "compile_cost_cap",
  "strategy_invalid", "geo_restricted", "eligibility_required",
  "venue_unavailable", "venue_read_only", "market_closed", "quote_unavailable", "oracle_stale", "sequencer_down",
  "session_key_missing", "session_key_expired", "session_key_revoked", "session_key_policy_violation",
  "session_key_cap_ratio", "session_key_slippage_above_cap", "session_key_expiry_too_long", "session_key_policy_hash_mismatch", "signing_unavailable", // M3.9
  "alert_url_blocked", // M4.0
  "auth_unavailable", "wallet_link_invalid", // M5.2
  "vision_unavailable", "image_invalid", // M5.6
  "secrets_unavailable", "rpc_url_blocked", // M5.9
  "wallet_link_unavailable", // M5.11
  "not_available", // M5.18: feature exists in the product but is "coming soon" (HTTP 501)
  "mode_not_enabled", // testnet/live gated by user approval
  "backtest_data_unavailable", "backtest_range_invalid", "limit_exceeded", "run_already_active", "insufficient_balance", /* M5.24e */ "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Every non-2xx response body. */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(), // safe to show users
    details: z.unknown().optional(), // e.g. ValidationIssue[]
    requestId: z.string(),
    retryAfterSec: z.number().int().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const HTTP_STATUS: Record<ErrorCode, number> = {
  service_unavailable: 503,
  unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, validation_failed: 422, rate_limited: 429, payload_too_large: 413,
  compile_failed: 422, unsupported_prompt: 422, compile_quota_exceeded: 429, compile_cost_cap: 429,
  strategy_invalid: 422, geo_restricted: 451, eligibility_required: 403,
  venue_unavailable: 503, venue_read_only: 422, market_closed: 409, quote_unavailable: 503, oracle_stale: 503, sequencer_down: 503,
  session_key_missing: 412, session_key_expired: 412, session_key_revoked: 412, session_key_policy_violation: 422,
  session_key_cap_ratio: 422, session_key_slippage_above_cap: 422, session_key_expiry_too_long: 422, session_key_policy_hash_mismatch: 422, signing_unavailable: 503,
  alert_url_blocked: 422, auth_unavailable: 503, wallet_link_invalid: 422, vision_unavailable: 503, image_invalid: 422, secrets_unavailable: 503, rpc_url_blocked: 422, wallet_link_unavailable: 503,
  not_available: 501, mode_not_enabled: 403, backtest_data_unavailable: 422, backtest_range_invalid: 422, limit_exceeded: 429, run_already_active: 409, insufficient_balance: 422, internal: 500,
};
