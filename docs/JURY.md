# Jury defense: question bank

The answers are short enough to say out loud. Each one points at something you can **show**.

## 60-second live demo script
1. Click **₹500 → Rahul**. Verdict: APPROVED. Point at the trace (L1 → L4 → executor) and the grounding highlight.
2. Click **Memo injection**. BLOCKED / MEMO_INJECTION at L2; the LLM step reads "skipped".
3. Click **Homoglyphs**. Open "What the firewall actually read": the Cyrillic letters are folded and it's BLOCKED / OBFUSCATION.
4. Switch to **☠ Compromised LLM** and click **₹500 → Rahul** again. The hostile LLM says "₹500 to Vikram". It's BLOCKED / GROUNDING_VIOLATION and nothing executes.
5. Open **/eval**: 54 unauthorised executions without a firewall, 0 with Bankism in every config.

## Hard questions

**Q: If someone fully jailbreaks Gemini, can they steal money?**
No. The LLM has no tools; it returns JSON. The policy engine only builds a transfer if the amount is a
number the customer typed, the payee is named in the message *and* is a saved beneficiary, and the
amount is ≤ ₹10,000 (above that needs OTP; above ₹25,000 it's always blocked). *Show:* the Compromised LLM toggle, `tests/invariants.test.ts`, eval row "compromised + rules off".

**Q: Then what can a jailbroken LLM do?**
Deny service: it can make legitimate requests fail. That's visible in the eval (97% of benign requests blocked
in compromised mode). We chose "fail closed" deliberately: an outage is better than theft.

**Q: Your detection rate is 100%. Isn't that overfitting?**
Yes, and the README says so. I wrote the rules and the test set, so detection on it is optimistic. That's
why the claim I defend is containment (0 unauthorised executions), which doesn't depend on detection.
The next step is a blind red-team set written by other people.

**Q: Why not just use Llama Guard / NeMo Guardrails / Lakera?**
They classify; they don't authorise. They'd say "probably an injection" but know nothing about saved payees,
limits or whether the amount came from the user. They'd also be better than my regexes at
classification, and they could plug in as another L2 signal. The policy engine stays the boundary.

**Q: Why regex rules at all if the policy engine is the boundary?**
Three reasons. Cost and latency: obvious attacks never reach the LLM (CRITICAL short-circuit). Explainability:
every block names a rule and the evidence. Defense in depth: they catch exfiltration and
policy-override attempts that aren't transfers, so grounding doesn't apply to them.

**Q: Why max-severity instead of a weighted risk score?**
Weights would be arbitrary numbers I couldn't justify. Max-severity is monotonic and auditable: one
CRITICAL signal is enough, and adding benign context can't dilute it.

**Q: What happens when Gemini is down, slow or returns garbage?**
6-second timeout. A schema violation, error or timeout switches to degraded mode: the regex parser keeps
balance/history working, and transfers go to REVIEW. Any exception returns BLOCKED / SYSTEM_ERROR. *Show:* the
"LLM key missing · degraded mode" badge if it happens live, and the failure tests.

**Q: How do you avoid blocking real customers?**
Three outcomes: medium risk is REVIEW (OTP), not BLOCKED. Rules need context: "ignore" alone doesn't fire,
"ignore … instructions" does. The prompt lists hard negatives. Result: 0% of benign test requests are falsely blocked;
14% go to OTP (new payee, > ₹10k, ambiguous).

**Q: What is spotlighting / the nonce?**
User text is wrapped in tags like `<untrusted_input_3f9a…>` with a random value per request. The model is
told only text outside those tags is instruction. An attacker can't close the tag early because they
don't know the value.

**Q: Couldn't the attacker put the attack in the amount or name itself?**
The amount must parse as a number and the payee must resolve to a saved beneficiary, so free text can't
survive into the executed command. The memo is length- and character-restricted, and it's scanned by the rules.

**Q: What still gets through?**
Novel paraphrases that both the rules and Gemini miss, multi-turn manipulation, languages other than English and Hinglish,
and scams where the real customer is tricked. In all of those, the worst case is a transfer the customer's own words
requested, to someone they saved, under the limit.

**Q: Is this production-ready?**
The architecture is; the MVP isn't. It needs a real auth/session, a persistent ledger, a real OTP flow, a
blind evaluation set and multi-turn context. I'd rather tell you that than overclaim.

**Q: Why Gemini and Next.js?**
Gemini: a free tier and native JSON-schema output. Next.js on Vercel: one repo, one deploy, no cold-start sleep
as on Render's free tier. The model is swappable: it sits behind `geminiParse()` and is validated by Zod.
