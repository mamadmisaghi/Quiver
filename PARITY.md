# Parity: Weft teardown vs Quiver (M5, updated 2026-10-28)

Source: everything in `/workspace/research/weft-teardown`, including REPORT.md §1–6, the animation spec, pages/, shots/ and api/. We studied mechanics only. Quiver uses its own design, copy and code.
Status: **done** means shipped, **partial** means some of it is shipped, **missing** means none of it is. **n/a** marks something we chose not to build.
Backend need: "—" means the frontend alone covers it.

## Marketing site
| Section / feature | Quiver | Backend need |
|---|---|---|
| Nav + "Open app" | done | — |
| Hero with animated signal visual | done (our own motif, not a loom) | — |
| Interactive "type an idea" demo | done (`SayIt`) | — |
| Two-tone statement | done | — |
| What it trades | done | — |
| What it reads (signal grid) | done | — |
| How it works / paper preview | done | — |
| Safety section ("can trade, can't withdraw" diagram) | done | — |
| Start from someone else's strategy | done (Fork on the public strategy page: POST /public/strategies/:id/fork → private v1 draft, no run; or Copy to paper) | — |
| Token / fee split section | done (draft) | Token, buyback and legal decisions (product) |
| FAQ | done | — |
| Final CTA idea input | done | — |
| Footer and legal pages (terms, privacy, eligibility, risk) | done (`/privacy` route added in M4.9.2; the copy is still a draft pending counsel) | — |
| Light theme toggle | n/a (dark-first is a deliberate choice) | — |
| Smooth scroll (Lenis-style) | n/a (native scroll; reduced-motion respected) | — |

## App shell
| Section / feature | Quiver | Backend need |
|---|---|---|
| Sidebar, New strategy, nav, Account group | done | — |
| ⌘K search | done (M4.9.2 palette; M5.17 grouped GET /v1/search: markets, public strategies, traders; 250ms debounce, q≤80, quiet 422/429) | — |
| Online / status dot | done ("Paper mode · live prices") | — |
| Sign in (email / X / wallet) | partial (dev login; "Connect wallet" is a placeholder) | Privy verification in `/auth/exchange` |

## Create and edit
| Section / feature | Quiver | Backend need |
|---|---|---|
| Idea → AI rules (streamed progress) | done | — |
| Rules card (Watch / When / Do) and humanizer | done | — |
| Strategy graph with ghost / enter / hot-edge states | done (`StrategyGraph`) | — |
| Refine a draft in plain English | done (builder refine via compile baseStrategy+instruction, M5; paper-run instruct) | — |
| Chart screenshot input | done (M5.6: attach PNG/JPEG/WebP ≤2 MB → `/compile/image` NDJSON; image_invalid reasons) | — (needs a vision-capable model configured in prod) |
| Validate / save / version | done | — |
| AI quota display, 429 countdown | done | — |
| Backtest | done (`BacktestPanel`; M5.18 "Data: Tiingo/fallback" tag) | **needs product decision** (not frontend): real historical stock data needs a data vendor |

## Run
| Section / feature | Quiver | Backend need |
|---|---|---|
| Paper run with live SSE (tick / trigger / fill) | done | — |
| Trigger wait states (ready / cooldown / holding / done) | done (`TriggerStates`) | — |
| Pause / stop, close a fraction of a position | done | — |
| Human-in-the-loop approvals | done (`/app/approvals`) | — |
| Instruct (plan → apply) | done | — |
| Write-off of a stuck position | done (`WriteOff` in LiveRun) | — |
| Replay ("films") | done (M5.7: share link `/r/:token`, noindex, revoke → gone; video shows when rendered) | Real video renderer (server stub returns not_configured) |
| Result / share card | done (`/c/:token`) | — |
| Go live: session key, signing steps | partial (testnet flow and UI; testnet deposit + test-pool swap on /app/wallets, M5.23–M5.25; mainnet is gated) | Live (mainnet) execution, mainnet deposit and bridge flows |

## Discover and social
| Section / feature | Quiver | Backend need |
|---|---|---|
| Public strategies feed + fork | done (feed cards → /app/strategies/[id]: thesis, graph, plain-word rules, lineage, 30d paper return, Fork / Copy to paper) | Guest (signed-out) view and share links: backend requires auth |
| Publish | done | — |
| Leaderboard | done | — |
| Traders (top traders) | done (list; external-wallet copy labelled "Coming soon", 501 not_available handled calmly) | **needs product decision** (not frontend): copy-trading an external address |
| Profiles, follow, feed | done (M5.5 profiles/follow; M5.12 /app/activity; M5.16 per-handle feed) | — |

## Markets
| Section / feature | Quiver | Backend need |
|---|---|---|
| Market tabs (stock tokens / perps / Solana / predictions) + search | done | — |
| Market-closed and stale states, geo note | done | — |
| Per-market detail page (chart, stats) | done (`/app/markets/:id`, custom SVG chart, M5.18 data-source tag) | — |
| Options, LP, lending venues | missing | New venue adapters (out of MVP scope) |
| Separate "papertrade" synthetic venue | n/a (paper is a run mode on every venue) | — |

## Account and money
| Section / feature | Quiver | Backend need |
|---|---|---|
| Portfolio (runs, allocation, history) | done | — |
| Autopilot (plan, guardrails, kill, log) | done (paper; M4.9.2 friendly kill reasons) | Streaming AI plan (`/autopilot/plan/stream` equivalent) |
| Wallets | done | — |
| Rewards / Revenue | done (mock-labelled) | Real reward distribution and fee accounting |
| Risk page | done | — |
| Settings: limits, session key defaults, stop all | done | — |
| Settings: alerts | done (webhook + M5.8 Telegram/X targets with validation) | Bot tokens for real Telegram/X sending (stub now) |
| Settings: your own RPC, your own AI keys | done (M5.9: write-only, hints only, cleared after save) | `SECRETS_MASTER_KEY` in prod; wire stored RPC/key into chain reads and compiles |
| Token launchpad | n/a | Product and legal decision |

## Summary
Updated 2026-10-28 (Wren, final pass, contracts @ backend bd0ec27). Done since M5: activity feed (M5.12), testnet chain account + RPC tag (M5.13/16), alert status (M5.14), replay media (M5.15), per-handle feed (M5.16), global ⌘K search (M5.17), data-source tags + calm 501 external copy (M5.18), write-off, market detail.

Needs product decision (not frontend): copy-trading an external address; real historical stock data (data vendor); token/buyback/legal; token launchpad.

Backend asks (Sage), exact:
1. Privy token verification in `POST /v1/auth/exchange` (frontend placeholder stays until keys exist).
2. Real video renderer for replays (currently `not_configured`).
3. Real Telegram/X senders (bot tokens in prod).
4. Vision-capable model for `/compile/image` and `SECRETS_MASTER_KEY` in prod; use stored per-user RPC/AI keys at call time.
5. Streaming autopilot plan (`/autopilot/plan/stream`).
6. Live execution, deposit and bridge flows (mainnet stays gated).
7. Real reward distribution and fee accounting.
8. New venue adapters (options, LP, lending) — out of MVP scope.

## Hosted navigation repair — 2026-10-29
The first production bundle threw `TypeError: e is not a function` in the hosted runtime's `next/link` dynamic navigation import. All application link call sites now use `components/Link.tsx`, which retains anchors and uses the public `useRouter` API directly for internal route changes. Same-page hashes, modifier/new-tab clicks, downloads and external links retain browser behavior. Product features and backend scope are unchanged.

Header Skills now points to /app/skills: the imported header used /#skills, but the landing page contains no such section.

## Preview readiness repair — 2026-10-29
- Prompt-specific text compilation now runs the shared backend deterministic compiler at /api/preview/compile (not AI). Fixed F.PARTIAL_NODES output removed from the web mock adapter.
- Browser-local draft saving, persistent preview forks, View drafts, and ?strategy= reopening added. Account/database persistence remains missing on the hosted preview.
- Explicit Draft action replaces automatic compile. Changed prompt cannot save/run the previous graph.
- Backtest results are explicitly example-only; custom preview runs are unavailable until the backend engine is connected. Chart and AI refine do not claim simulated success.
- See handoff/READINESS-2026-10-29.md for verified P0/P1 findings, exact key list and paper/testnet/mainnet acceptance gates.

## Render paper beta preparation — 2026-10-29
- The latest implementation/status is documented in `handoff/RENDER-PAPER-BETA.md`; it supersedes the preceding example-only backtest and missing-backend-storage notes.
- Preview rule simulation now evaluates the submitted strategy on synthetic bars. Canonical market IDs match the compiler. Same-origin `/v1` routing is prepared for the Render service.
- The backend now has PostgreSQL checkpoints, paper account recovery, durable save acknowledgments and shutdown; source and Blueprint are prepared, but the Render infrastructure is not yet deployed.

## Provider setup — 2026-10-29
- OpenRouter, Privy and Tiingo credentials were checked against real provider endpoints and stored only in protected environment settings.
- The initial model is GPT-4.1 Mini for text and vision. English/Persian compiler samples passed validation after bounded repairs; the preview remains explicitly separate from the authenticated live adapter.
- Provider parameter compatibility and PostgreSQL-backed AI cost reservations were added. See `handoff/PROVIDER-SETUP-2026-10-29.md` for measured samples and remaining activation steps.
