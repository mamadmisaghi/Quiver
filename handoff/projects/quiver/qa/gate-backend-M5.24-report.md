# Gate: backend 5637e10 (M5.24a–f on top of e6303b3)
Robin, 2026-10-28 ~20:30 Tehran (UTC+3:30). **Verdict: PASS, deployed 20:32.** Owner of the findings: Sage.

## Suite
- 548/548 tests (80 files, 0 skipped; this count includes my own scratch tests), tsc 0, lint 0, forge 62/62. Lockfile unchanged.
- `foundry/broadcast` is gitignored with 0 tracked files. Nothing was broadcast.
- My adversarial file `zz524.test.ts`: 6/6.

## Commits
- **14da220 (refunds + 120/min/IP invalid cap): OK.**
  - Only `validation_failed` and `payload_too_large` refund.
  - Expensive work doesn't refund:
    - /compile streams, so later errors never reach onError.
    - /instruct LLM refusals are `unsupported_prompt` or `strategy_invalid` and restore only the compile quota, not ins/insd.
  - I couldn't get any RPC to run before a refunded 422: the 19-dp amount is rejected by the schema before getCode.
  - XFF:
    - Without TRUST_PROXY, rotating XFF does not bypass the cap.
    - With TRUST_PROXY on, the leftmost XFF entry is used, so rotation would bypass it.
    - On the VPS that's safe: Caddy 2.11.7 sets `header_up X-Forwarded-For {remote_host}`, overwriting any client value, and 8987 is loopback-only.
  - **Low:** if Caddy ever appends instead, the per-IP caps (all of them, not new) are spoofable. Keep the overwrite, or use the rightmost entry.
- **c528514 (low-s): OK.**
  - The high-s twin is refused for wallet link and session keys. Sage's test proves viem alone accepts it.
  - The nonce is single-use even on a bad signature.
  - 64-byte compact (EIP-2098) signatures are refused.
- **9d5d94a (JWKS 30 s + single-flight): OK.**
  - 50 concurrent unknown kids cause 1 fetch.
  - A rotated kid that arrives inside the cooldown is rejected until the window ends, then accepted. Existing kids keep working, so there's no lockout beyond 30 s.
  - **Info:** an attacker sending a rogue kid every 30 s can keep a genuine new kid waiting up to 30 s after rotation.
- **755aaae (smart_account_not_deployed): MEDIUM. It fails open.**
  - "0x" or no code gives 409 as intended.
  - But a getCode error or exception, an unreachable RPC, or a wrong-chain RPC all return **200 with `recipientCode:"unchecked"`** and an unsigned tx. This is documented in the contract, but it is not fail-closed.
  - Impact is low: testnet only, the assets have no value, the user signs, and the web doesn't call this route.
  - Recommend: return 503 `venue_unavailable` when an RPC is configured but the read fails. Keep "unchecked" only when no RPC is configured.
  - Not blocking.
- **1c00fdd (insufficient_balance): OK.** It's a read-only balanceOf before building txs. The test pool is off on the VPS.
- **5637e10 (tNVDA): OK.**
  - With no TEST_NVDA_ADDRESS (the VPS), it returns 503.
  - When set, `to` is exactly that address, with chainId 46630, value 0 and `testnet:true`.
  - An extra `token` field, an address as `asset`, chainId 1, or an amount over 10000 are each refused with 422. There's no arbitrary token path.

## Defaults review
- **JWKS 30 s.** Keep it. One fetch every 30 s per process is negligible, and Privy rotations are rare and announced. You could go to 60 s, but don't go lower than 10 s.
- **Invalid cap 120/min/IP.** OK for a public preview. A per-user secondary cap of about 60/min would stop one signed-in account spreading across IPs, but that's optional.
- Earlier e6303b3 Lows still stand: the `Number()` deposit cap (1 ETH + 1 wei) and the SIGNOFF line 108 wording.

## Deploy
- Release `5637e10-726e6a2\backend`, from a git archive with sha256 29f61e3a…5e69 verified by certutil. node_modules robocopied (lock identical). tsx import OK.
- Backup `api-start.726e6a2-e6303b3.bat`. Edit guard passed: TEST_POOL, REVENUE, TIINGO value, SECRETS and Telegram all absent.
- 0 active runs. Graceful stop 20:32:37 → 20:32:38, RC 0, then `/end` and `/run`. API PID 2696.
- testpool/status `enabled:false`. PumPals 12968 untouched.
