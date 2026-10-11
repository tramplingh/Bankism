# Prompt changelog

Prompts are versioned like code. Any change must be followed by `npm run eval:llm` and the
numbers recorded here.

## parser v1.0.2 — model change
- Default model moved from `gemini-3.8-flash` to `gemini-3.5-flash-lite`. The free tier for 3.8-flash
  allows only 5 requests/min, which degraded the live demo and the eval under load; 3.5-flash-lite
  allows 15/min and 500/day. Prompt and schema unchanged.

## parser v1.0.1 — model change
- Default model moved from `gemini-2.5-flash` (retired for new API keys: 404) to `gemini-3.8-flash`.
  Prompt and schema unchanged. `thinkingBudget: 0` is now sent only to 2.5 models; LLM timeout
  raised from 6 s to 10 s because newer models think by default.

## parser v1.0 — initial
- Role: extraction-only component; explicitly told it cannot approve or execute.
- Spotlighting: user text and memo fenced in tags carrying a random per-request nonce, so an
  attacker cannot forge the closing tag.
- Output constrained by a JSON response schema (enums for intent and threat flags), temperature 0.
- Grounding instructions: copy amount and payee exactly; never compute, total or correct.
- Asymmetric-cost instruction for flags ("when in doubt, flag"): a false flag costs one OTP,
  a miss can cost money. The policy engine treats flags as risk-raising only.
- Hard negatives listed in the prompt ("ignore my previous request", "role in the play") to
  keep false positives down; Hinglish called out as normal input.
- 7 few-shot examples (`parser.fewshot.md`): plain, Hinglish, hard negative, memo injection,
  roleplay, authority claim, read-only.
