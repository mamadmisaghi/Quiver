# Strategy clarification and drafting progress

The compiler now returns a terminal `clarification` event for missing amounts, drawdown references, repeat semantics, recurring budgets, and additional user questions. The builder collects answers in a compact step-by-step panel and resumes the same workflow. It preserves previously supplied amounts, dependencies, leverage, and inherited risk. Numeric answers are applied directly; free-text answers trigger a fresh plan with the entire answer history, followed by the independent intent check. Conditional lookback questions are collected before another paid call.

The progress UI uses readable labels, an animated active circle, and completed checks. Reduced-motion preferences stop rotation. Old drafts' unresolved questions can no longer be dismissed with a checkbox. Save and run actions are blocked during clarification. The existing dark/amber theme, horizontal graph, and dedicated paper-session routes are retained.

Text model target: `openai/gpt-5.6-sol` via the existing OpenRouter integration; low reasoning, no unsupported temperature override, 6,000 output-token ceiling and 120-second overall draft budget. Chart model remains separately configurable. Preview reservations account conservatively for the larger model; the existing $5 daily/global and $1 anonymous budget limits remain. Render blueprint model/pricing/output configuration is aligned for the later migration; no Render deployment is performed in this change.

Validation before publication:
- 14 focused clarification checks in `scripts/check-clarifications.ts` cover the exact NEET/TROLL/BTC pattern, missing BTC margin, AND conditions, stage order, Persian digits, invalid answers, follow-up lookbacks, preserved risk, free-text context, provider parameters, and unavailable AI.
- 21 preview integration checks and 22 storage/budget checks pass.
- 31 backend intent and provider-budget tests pass.
- Local browser confirms question navigation, contextual numeric validation, and disabled save/run actions.

Production smoke test with the configured GPT-5.6 Sol route succeeded: the exact NEET/TROLL/BTC prompt produced four inline questions (BTC margin, drop reference, budget, and simultaneous-condition meaning). Test answers of $200 BTC margin, peak reference, $1,000 total budget, and both conditions true in the same observation produced a verified nine-node draft. It retained $100 of NEET, $100 of TROLL, an AND of the two 10% drops, and the subsequent 5× BTC long at execution-time market price. The final continuation took 17.5 seconds. No real orders or paper sessions were started. Exact token identity remains an explicit candidate choice because both symbols returned multiple contracts.

This remains a development preview. Market identity must still be resolved from verified candidates. Paper sessions are simulations; this change does not submit real orders or enable unattended 24-hour hosting.
