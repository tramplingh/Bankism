# Security model

## Assets and trust boundaries
| Asset | Protected by |
|---|---|
| Customer funds (transfers) | Only `decide()` in [`lib/firewall/policy.ts`](lib/firewall/policy.ts) can construct an `ApprovedTransfer`; the executor accepts nothing else |
| Other customers' data | Read actions always use the session account; the text can never select an account |
| The model's instructions | Nonce-fenced input, extraction-only role, and exfiltration rules (`EXF-*`) |
| Shared LLM quota | Per-client token bucket ([`rateLimit.ts`](lib/server/rateLimit.ts)), parse cache, CRITICAL short-circuit |

**Untrusted:** the customer message, the memo, and **everything the LLM returns**.
**Trusted:** deterministic code in `lib/firewall/` and `lib/bank/`, and the session account.

## Threats and controls
| Threat | Control | Evidence |
|---|---|---|
| Direct prompt injection / rule override | L2 `INJ-*` rules (CRITICAL short-circuits before the LLM); LLM flags | `eval/results/*.json` per-category rates |
| Roleplay jailbreak | L2 `RP-*` rules; LLM flags | same |
| Fake authority / policy override | L2 `POL-*` rules; limits are code, not prompt | same |
| Instructions in payment memos | Memo scanned separately (hits labelled `MEMO_INJECTION`) + structural memo policy | `tests/llm-only.test.ts`, dataset |
| Token obfuscation | L1 normalization + scan views; obfuscation itself is a signal | `tests/normalize.test.ts` |
| **Compromised / jailbroken LLM** | Grounding (amount and payee must appear in the customer's text), saved-payee check, limits, monotonic risk | `tests/invariants.test.ts`; `eval/results/compromised-norules.json`: 0 unauthorised |
| LLM outage, timeout, malformed output | Degraded mode: regex parser, transfers go to REVIEW; Zod validation; abortable 10 s timeout | `tests/invariants.test.ts` failure suite |
| Internal exception | `analyze()` fails closed → BLOCKED / SYSTEM_ERROR | `tests/invariants.test.ts` |
| Oversized / malformed requests | 8 KB body cap, 1000-char text, 200-char memo, JSON validation | `tests/api.test.ts` |
| Quota exhaustion / abuse | Token bucket per IP (429 + Retry-After), bounded memory | `tests/efficiency.test.ts`, `tests/api.test.ts` |
| Markup / SQL payloads in a request (`<script>`, `'; DROP TABLE`) | L2 `INJ-CODE` (MEDIUM → REVIEW, never auto-approved); text is never executed or rendered unescaped | `tests/code-injection.test.ts` |
| Clickjacking, MIME sniffing, XSS impact | CSP (`default-src 'self'`, `frame-ancestors 'none'`), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy; `X-Powered-By` removed | `tests/api.test.ts` |
| Secret leakage | `.env*` git-ignored; key only in Vercel env; health endpoint exposes status, never the key | `tests/api.test.ts` |

## Known gaps
- The CSP allows `'unsafe-inline'` scripts, because Next.js hydration requires it without per-request nonces.
- The rate limit and parse cache are per serverless instance, not distributed.
- Single-turn only; no defence against multi-turn or indirect (document-borne) injection.
- Detection is evaluated on a self-authored dataset. Containment is the property we rely on.

## Reporting
Open a GitHub issue marked `security`. This is a competition prototype with a mock ledger and no real funds.
