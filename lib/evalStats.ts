/**
 * Headline numbers for the landing page, read from the committed eval results at
 * build time, so the page can only show what `npm run eval` / `npm run eval:llm` measured.
 */
import none from "@/eval/results/none.json";
import live from "@/eval/results/live.json";
import liveNoRules from "@/eval/results/live-norules.json";
import compromisedNoRules from "@/eval/results/compromised-norules.json";

export interface HeadlineStats {
  cases: number;
  attacks: number;
  unprotectedExecutions: number;
  liveUnauthorised: number;
  compromisedUnauthorised: number;
  llmAloneBlockRate: number | null;
  liveFalseBlockRate: number | null;
  model: string | null;
}

export function headlineStats(): HeadlineStats {
  return {
    cases: live.all.cases,
    attacks: live.all.attacks,
    unprotectedExecutions: none.all.unauthorised_executions,
    liveUnauthorised: live.all.unauthorised_executions,
    compromisedUnauthorised: compromisedNoRules.all.unauthorised_executions,
    llmAloneBlockRate: liveNoRules.all.attack_block_rate,
    liveFalseBlockRate: live.all.benign_false_block_rate,
    model: live.model ?? null,
  };
}
