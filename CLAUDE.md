# Bankism — project memory for Claude Code sessions

Blue-team AI firewall for LLM-integrated banking (PromptWars @ UVCE). Solo, 8-hour build.
Deliverables: 6–8 slide deck, public repo with README + prompt templates, live Vercel URL.

## Non-negotiable architecture
**Containment over detection.** The LLM is an untrusted parser with NO tools. Deterministic
code is the only thing that can authorise money movement.

```
text(+memo) → L1 normalize → L2 rules → L3 LLM parser → L4 policy engine → verdict → executor
```
- **L1 `lib/firewall/normalize.ts`** — NFKC, strip invisible chars, fold homoglyphs; build scan
  views (collapsed / leet / decoded base64+hex / reversed). Obfuscation itself is a signal.
- **L2 `lib/firewall/rules.ts`** — signatures with fixed severity. Risk = MAX severity (never a
  weighted sum). CRITICAL short-circuits before the LLM. Rules hitting the memo → MEMO_INJECTION.
- **L3 `lib/firewall/llm.ts`** — Gemini, JSON schema, temperature 0, input fenced in random
  per-request nonce tags. Output validated with Zod. Its threat flags can only RAISE risk.
  Prompt templates live in `/prompts/*.md` (versioned, changelog in `prompts/CHANGELOG.md`).
- **L4 `lib/firewall/policy.ts`** — the security boundary: intent allowlist; grounding (amount
  and payee must literally appear in the user's text); saved-beneficiary check; step-up above
  ₹10,000; hard limit ₹25,000; structural memo policy. Debit account comes from session only.
  The rationale string is written by code, never by the LLM.
- **Executor `lib/bank/ledger.ts`** — mock ledger; executes only on APPROVED.

Decisions: APPROVED / REVIEW / BLOCKED. Only APPROVED executes.
Failure: LLM timeout / error / malformed → degraded mode (regex parser; read-only intents OK,
transfers → REVIEW). Any exception → BLOCKED + SYSTEM_ERROR. Fail closed, always.

## Acceptance tests (every change must keep these answerable)
1. Compromised LLM cannot cause a fraudulent transfer → `tests/invariants.test.ts`, eval config `compromised-norules`.
2. Failure/timeout/malformed output → degraded / fail-closed → `tests/invariants.test.ts`.
3. Detection proven by numbers → `npm run eval` (dev vs held-out split, ablation configs).
4. False positives → hard-negative benign cases; REVIEW instead of BLOCK for medium risk.
5. Known gaps documented honestly in README (novel paraphrase, other languages, multi-turn, APP scams).
6. vs. guardrail libraries → they classify; Bankism authorises. They could plug in as an L2 signal.
7. Live demo < 1 min → preset buttons, Compromised-LLM toggle, layer trace, eval page.

## Rules for working here
- Tests before logic. Run `npm test` and `npm run eval` after every significant change; report numbers.
- Never tune rules on held-out cases (`split: "heldout"` in `eval/dataset.json`). Tune on dev only.
- Never commit secrets. `.env*` is git-ignored; only `.env.example` is tracked.
- No complexity for its own sake: every component must map to an acceptance test or the demo.
- Don't put model identifiers or "AI-generated" claims about security that the eval can't back up.
