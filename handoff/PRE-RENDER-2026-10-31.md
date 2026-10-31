# Quiver — working release before Render activation

## Intended operating state

The existing public Site remains the review address. The task workspace is disposable; it is not a permanent application server or a data backup. GitHub preserves source and release instructions. The Site's D1 database holds signed-in preview drafts and AI cost reservations. Render will host the continuous Node paper engine and its PostgreSQL state after the owner resolves billing. No VPS work or paid Render resource creation is part of this step.

| Capability | State in this release |
| --- | --- |
| Prompt-specific rules and graph | Available; anonymous visitors use the labelled deterministic parser |
| AI text, refinement and chart routes | Implemented for visitors signed in with ChatGPT; uses existing server-only OpenRouter key and selected mini model |
| AI accounting | Atomic D1 reservations across isolates, at most 3 active calls, 60 provider calls per user/day, application budget up to $5/day |
| Uncertain provider cost / timeout | Conservative reservation retained; expired concurrency slots do not refund spend |
| Saved drafts | Browser copy plus user-scoped online copy for signed-in visitors; up to 50 in each store |
| Backup and transfer | Versioned JSON export/import; validates all records before writes, skips duplicate strategies, never starts a run |
| Render migration UI | Live adapter has Move preview drafts; source copies are kept and retries skip completed copies |
| Rule tests | Evaluate the actual draft on explicitly synthetic prices; this is not historical market performance |
| Continuous custom paper runs | Pending Render activation; remains disabled in the preview |
| Real-money execution | Disabled; venue execution, funding and grants are separate work |

ChatGPT Site identity owns temporary drafts. Privy remains the intended identity provider for the Render API. These identities are not silently treated as interchangeable. Import runs through the signed-in target API, which assigns ownership and new strategy IDs. The visitor may need to sign in to both accounts once to move online preview drafts; a downloaded backup also works.

Prompts and chart images are sent to OpenRouter for AI processing. Draft storage contains strategy JSON. The cost ledger contains only reservation metadata, never prompts, images, credentials or identity tokens. Application budgeting is not a provider-side billing guarantee.

## Verification

- Frontend TypeScript and the existing 21 preview integration checks passed.
- 17 new checks use the actual generated migration and production SQL: owner isolation, restart durability, 50-draft capacity, atomic shared budget/concurrency, unknown costs, timeout charging, fail-closed accounting, portable backup validation, deduplication and anonymous/cross-origin refusal.
- Backend typecheck and bundle passed. The broad suite excluding the two local-network fixture files passed 506 tests with 9 skipped. The full suite is not claimed green: the platform's automatic review rejected the local TLS fixture request to `hooks.test`, and the previous pinned transport failures remain unverified here. The tests use local servers and dummy payloads, but no network protection was relaxed to run them.
- Browser QA confirmed prompt-specific ETH rules, browser save, backup download and re-import with one duplicate skipped. Signed-in production AI/storage still require acceptance after publication; anonymous preview tests do not prove an authenticated provider request.
- Publishing status must come from the Sites deployment result, not from this source document.

## Activation after billing is ready

1. Use GOFi on Render. Keep the Hobby workspace; create only the prepared paid API, direct-session PostgreSQL connection and replay disk from `render.yaml`. Keep one engine instance and stop-before-start deploys.
2. Stage existing provider credentials as Render secrets, configure final Privy allowed origins, and verify `/v1/ready` including PostgreSQL readiness. Never put secrets into Git or a browser bundle.
3. Set the Site's fixed HTTPS `QUIVER_API_INTERNAL` to the Render API's `/v1` base. Rebuild and publish the frontend with `NEXT_PUBLIC_API_MODE=live`; a runtime environment edit alone must not be assumed to change an inlined client flag.
4. Disable `QUIVER_PREVIEW_AI_ENABLED` when cutting over to the Render compiler, so the temporary AI path cannot maintain an additional independent daily budget.
5. Sign in to the target Privy account. Use **Move preview drafts** or import the exported backup. Compare counts/content; keep source copies until acceptance succeeds.
6. Verify login/refresh, save/reopen, backtest provenance, paper start/pause/resume/stop, restart recovery, persisted costs and owner isolation against the deployed stack. Mainnet remains disabled.
7. Review real market-feed coverage separately. The prepared Blueprint currently selects synthetic prices; paying for hosting does not make those prices live or finish venue execution adapters.

The database is not automatically moved merely by adding a card. Provisioning, secret wiring, frontend cutover, data import and deployed acceptance are the remaining release gates.
