/**
 * L3 — LLM parser (Gemini). Untrusted by design:
 *  - it has NO tools and cannot call any banking API;
 *  - its output is schema-constrained here AND re-validated with Zod in the pipeline;
 *  - its threat flags can only raise risk; its amount/payee are re-grounded by the policy engine.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { GoogleGenAI } from "@google/genai";

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const modelName = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;

let cachedPrompt: string | null = null;
function systemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  const dir = path.join(process.cwd(), "prompts");
  cachedPrompt =
    readFileSync(path.join(dir, "parser.system.md"), "utf8") +
    "\n\n## Examples\n" +
    readFileSync(path.join(dir, "parser.fewshot.md"), "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  return cachedPrompt;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["balance_inquiry", "transaction_history", "p2p_transfer", "help", "other"] },
    amount: { type: ["number", "null"] },
    payee: { type: ["string", "null"] },
    memo: { type: ["string", "null"] },
    threat_flags: {
      type: "array",
      items: {
        type: "string",
        enum: ["PROMPT_INJECTION", "JAILBREAK_ROLEPLAY", "POLICY_OVERRIDE", "MEMO_INJECTION", "OBFUSCATION", "DATA_EXFILTRATION"],
      },
    },
  },
  required: ["intent", "amount", "payee", "memo", "threat_flags"],
  additionalProperties: false,
};

/** Wraps untrusted text in nonce-tagged fences ("spotlighting"). Exported for tests/UI. */
export function fence(text: string, memo: string | null, nonce: string): string {
  let msg = `<untrusted_input_${nonce}>\n${text}\n</untrusted_input_${nonce}>`;
  if (memo) msg += `\n<untrusted_memo_${nonce}>\n${memo}\n</untrusted_memo_${nonce}>`;
  return msg;
}

let client: GoogleGenAI | null = null;

export function llmAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Returns the model's raw JSON (unknown shape — the caller validates). Throws on any failure. */
export async function geminiParse(text: string, memo: string | null, signal?: AbortSignal): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  client ??= new GoogleGenAI({ apiKey });
  const nonce = randomBytes(8).toString("hex");
  const res = await client.models.generateContent({
    model: modelName(),
    contents: [{ role: "user", parts: [{ text: fence(text, memo, nonce) }] }],
    config: {
      systemInstruction: systemPrompt().replaceAll("{{NONCE}}", nonce),
      temperature: 0,
      maxOutputTokens: 2048, // thinking tokens count toward this cap on newer models
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      // thinkingBudget is a Gemini 2.5 setting; newer models use their default thinking.
      ...(modelName().startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      abortSignal: signal,
    },
  });
  const raw = res.text;
  if (!raw) throw new Error("empty LLM response");
  return JSON.parse(raw);
}
