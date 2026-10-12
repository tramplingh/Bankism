import type { Layer, TraceStep, Verdict } from "@/lib/types";
import { STATUS_LABEL } from "./labels";

const STEPS: { layer: Layer; name: string }[] = [
  { layer: "L1_NORMALIZE", name: "Normalize" },
  { layer: "L2_RULES", name: "Rules" },
  { layer: "L3_LLM", name: "AI parser" },
  { layer: "L4_POLICY", name: "Policy" },
  { layer: "EXECUTOR", name: "Execute" },
];

const RANK: Record<TraceStep["status"], number> = { skipped: 0, pass: 1, flag: 2, block: 3, error: 3 };

/** The worst status a layer reported (a layer can log more than one step). */
const worst = (steps: TraceStep[]): TraceStep["status"] =>
  steps.reduce<TraceStep["status"]>((w, t) => (RANK[t.status] > RANK[w] ? t.status : w), "skipped");

/** The request's path through the five layers; steps light up in order (no motion if reduced). */
export default function Stepper({ v }: { v: Verdict }) {
  return (
    <ol className="stepper" aria-label="Path through the five layers">
      {STEPS.map((s, i) => {
        const status = worst(v.trace.filter((t) => t.layer === s.layer));
        return (
          <li key={s.layer} className={`node node-${status}`} style={{ animationDelay: `${i * 140}ms` }}>
            <span className="node-dot" aria-hidden="true">{STATUS_LABEL[status].icon}</span>
            <span className="node-name"><span className="sr-only">Step {i + 1}: </span>{s.name}</span>
            <span className="node-status">{STATUS_LABEL[status].text}</span>
          </li>
        );
      })}
    </ol>
  );
}
