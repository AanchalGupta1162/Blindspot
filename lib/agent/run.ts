import { z } from "zod";

export const EventKind = z.enum(["trigger", "assistant", "tool_call", "tool_result", "gate", "approval", "applied", "alert", "summary", "status"]);

export const EventSchema = z.object({
  i: z.number(),
  tMin: z.number(), // simulated time (minutes since monitoring started)
  invocation: z.number(),
  kind: EventKind,
  data: z.record(z.string(), z.unknown()),
});
export type RunEvent = z.infer<typeof EventSchema>;

const OutcomeSide = z.object({
  limitExceeded: z.boolean(),
  firstBreachMin: z.number().nullable(),
  firstBreachNode: z.string().nullable(),
  degreeMinutesAboveLimit: z.number(),
  peakMarginC: z.number(),
});

export const AppliedActionSchema = z.object({ action: z.record(z.string(), z.unknown()), reason: z.string(), tApplyMin: z.number(), approvalDelayMin: z.number() });

export const RunSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  /** 'llm' = recorded from a real model. 'scripted-policy' = deterministic reference policy, NOT model output. */
  source: z.enum(["llm", "scripted-policy"]),
  model: z.string().nullable(),
  label: z.string(),
  headline: z.string(),
  createdAt: z.string(),
  simulated: z.literal(true),
  scenario: z.object({ kind: z.string(), seed: z.number(), startHour: z.number(), durationMin: z.number(), onsetMin: z.number() }),
  trigger: z.object({ tMin: z.number(), rule: z.string(), detail: z.string() }).nullable(),
  invocations: z.number(),
  status: z.enum(["applied", "escalated", "no_action", "needs_input", "paused", "budget_stopped", "rejected"]),
  alertMin: z.number().nullable(), // first warn/critical alert or passed request, in simulated minutes
  action: AppliedActionSchema.nullable(),
  actions: z.array(AppliedActionSchema).optional(), // absent in original single-action recordings
  approval: z.object({ decision: z.enum(["approved", "rejected"]), mode: z.enum(["human", "auto-simulated"]), by: z.string() }).nullable(),
  outcome: z.object({
    doNothing: OutcomeSide,
    withAction: OutcomeSide.nullable(),
    peakMarginImprovementC: z.number().nullable(),
    degreeMinutesSaved: z.number().nullable(),
  }),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), reasoningTokens: z.number(), costUsd: z.number(), turns: z.number(), models: z.array(z.string()) }),
  events: z.array(EventSchema),
});
export type Run = z.infer<typeof RunSchema>;

export class Recorder {
  events: RunEvent[] = [];
  invocation = 0;
  push(kind: RunEvent["kind"], tMin: number, data: Record<string, unknown>) {
    this.events.push({ i: this.events.length, tMin, invocation: this.invocation, kind, data });
  }
}
