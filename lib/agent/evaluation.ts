import { z } from "zod";
export const EvaluationRowSchema = z.object({
  id: z.string(), alertMin: z.number().nullable(), breachMin: z.number().nullable(), costUsd: z.number().nonnegative(),
  status: z.string().optional(), turns: z.number().optional(), action: z.record(z.string(), z.unknown()).nullable().optional(),
  peakImprovementC: z.number().nullable().optional(), breachAvoided: z.boolean().nullable().optional(),
});
export type EvaluationRow = z.infer<typeof EvaluationRowSchema>;
export function summarizeEvaluation(rows: EvaluationRow[], plannedN: number, model: string) {
  const breaching = rows.filter((r) => r.breachMin !== null);
  const early = breaching.filter((r) => r.alertMin !== null && r.alertMin < r.breachMin!).map((r) => r.breachMin! - r.alertMin!).sort((a, b) => a - b);
  const controls = rows.filter((r) => r.id.startsWith("control-"));
  const mid = Math.floor(early.length / 2);
  return {
    version: "followup-v2", generatedAt: new Date().toISOString(), model,
    note: "LLM agent on a simulated subset with auto-simulated approvals. Do not extrapolate to the full 50-scenario set. Seeds were also used in earlier evaluation; this is a regression evaluation, not a new blind test.",
    n: rows.length, plannedN, complete: rows.length === plannedN,
    breachScenarios: breaching.length, detectedBeforeBreach: early.length,
    medianLeadMin: early.length ? (early.length % 2 ? early[mid] : (early[mid - 1] + early[mid]) / 2) : null,
    controlsWithAlert: controls.filter((r) => r.alertMin !== null).length, controls: controls.length,
    totalCostUsd: Number(rows.reduce((a, r) => a + r.costUsd, 0).toFixed(4)), rows,
  };
}

export const ResearchEvaluationSchema = z.object({
 version:z.literal("research-v3"), model:z.string(), note:z.string(), n:z.number().int(), plannedN:z.number().int(), complete:z.boolean(), controlsWithAlert:z.number().int(), controls:z.number().int(), batchSpentUsd:z.number().nonnegative(), batchCapUsd:z.number().positive(),
 originalComparison:z.array(z.object({id:z.string(),before:EvaluationRowSchema.nullable(),after:EvaluationRowSchema})),
});
