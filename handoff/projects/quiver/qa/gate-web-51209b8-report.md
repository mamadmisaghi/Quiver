# Gate: web 51209b8 (M4.9.1). Verdict: PASS, deployed

lint, tsc and build all return 0. Screenshots and check files are in qa/shots-51209b8/ (checks-real.txt, checks-hook.txt).

## Checks
| Check | Result |
|---|---|
| Real autopilot 422 (1440 and 360) | I rewrote the request body in the browser; the server's response was untouched. Field hints "Max drawdown pct must be at most 50" and "Rotate every min must be at least 15", aria-invalid set, the message "Fix the highlighted fields.", no overflow. PASS |
| Real 207 panel and retry (1440) | Used a TEST-ONLY hooked backend copy (/tmp/robin-g485hook, ROBIN_FAIL_STOP makes the first kill stop throw). The panel listed the run id and reason; the retry returned 200 and the run stopped; no console errors. At 360 the kill returned 200 because the injection fires only once. PASS |
| Invalid instruct (both widths) | 1 issue in the list, "Nothing was changed", no proposal shown. PASS |
| 429 countdown | The message says compiles and changes share the quota; the countdown ticks down and the button is disabled. PASS |
| enabled:false | Real active-run limit (2 runs active): PUT returned 200 with enabled:false and the UI showed the error. PASS |
| Regression | Run 201, share 201, live refused with 403, stop 200. Pages fine at 360, 768, 1024 and 1440. |

### Lighthouse
| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| / | 92 | 100 | 100 | 100 |
| /leaderboard | 98 | 100 | 100 | 100 |
| card page | 86 | 100 | 100 | 91 |

## Findings (all Low)
1. The kill panel shows the raw reason code (for example venue_down).
2. The enabled:false message is missing punctuation: "no strategy could start Check the log below."
3. At 1024 px, /app/markets and the run page overflow horizontally (tables with min-w 860 and 800). This is not from this diff; earlier gates checked 1280.

## Disclosure
To clear a stale local server I ran `pkill -f next-server` limited to my own user. It may have stopped other agents' local Next servers on the box.
