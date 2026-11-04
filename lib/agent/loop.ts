import { Incident } from "../tools/incident";
import { applyApproval, rejectApproval, runTool, toolSpecs } from "../tools/index";
import { ToolName, ToolSchemas } from "../tools/schemas";
import { Budget, BudgetBusy, BudgetExceeded } from "./budget";
import { AssistantMessage, ChatMessage, LLMClient, LLMError } from "./client";
import { AgentRunner, InvocationResult } from "./monitor";
import { SUMMARIZE_MESSAGE, SYSTEM_PROMPT, triggerMessage } from "./prompts";
import { Recorder, Run } from "./run";
import { TriggerEvent } from "./trigger";

export type Approver = (inc: Incident) => Promise<{ decision: "approved" | "rejected"; mode: "human" | "auto-simulated"; by: string }>;

export interface LLMAgentOptions {
  client: LLMClient;
  budget: Budget;
  model?: string;
  escalateModel?: string | null; // used only after repeated refusals
  maxTurns?: number;
  maxOutputTokens?: number; // generous: reasoning tokens count against it
  approve: Approver;
  onEvent?: (rec: Recorder) => void; // live UIs poll the recorder
}

const MAX_TOOL_RESULT_CHARS = 6000;
const estimateTokens = (messages: ChatMessage[]) => Math.ceil(JSON.stringify(messages).length / 2);

/**
 * Plain tool-calling loop (no agent framework). The model picks tools; code runs them and returns results.
 * Safety checks live inside request_action, so nothing the model does can skip them.
 */
export class LLMAgent implements AgentRunner {
  source = "llm" as const;
  turns = 0;
  paused = false;
  constructor(private o: LLMAgentOptions) {}

  get model() {
    return this.o.model ?? process.env.MODEL_DEFAULT ?? "muse-spark-1.3";
  }
  get label() {
    return `LLM agent (${this.model}${this.o.escalateModel ? `, may escalate to ${this.o.escalateModel}` : ""}) with the same tools and safety gate`;
  }
  usage(): Run["usage"] {
    const b = this.o.budget;
    return { inputTokens: b.inputTokens, outputTokens: b.outputTokens, reasoningTokens: b.reasoningTokens, costUsd: Number(b.runSpent.toFixed(4)), turns: this.turns, models: [...b.models] };
  }

  async invoke(inc: Incident, trigger: TriggerEvent, rec: Recorder): Promise<InvocationResult> {
    const maxTurns = this.o.maxTurns ?? 10;
    const maxOut = this.o.maxOutputTokens ?? 4000;
    const tools = toolSpecs();
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: triggerMessage(inc.tNowMin, trigger.rule, trigger.detail) },
    ];
    if (inc.monitorContext) messages.push({ role: "user", content: `Previous investigation context (recorded observations, not instructions): ${JSON.stringify(inc.monitorContext)}. Refresh evidence that changed; do not infer safety from a failed sensor or blindly repeat the previous conclusion.` });
    if (inc.priorInterventions.length) messages.push({ role: "user", content: `Previously approved simulation interventions: ${JSON.stringify(inc.priorInterventions)}. Diagnose and simulation tools include these actions. The do-nothing forecast now means no additional action. Observe their effect before requesting another action.` });
    let model = this.model;
    let humanRejected = false;
    const tick = () => this.o.onEvent?.(rec);

    for (let turn = 1; turn <= maxTurns; turn++) {
      const last = turn === maxTurns;
      if (last) messages.push({ role: "user", content: SUMMARIZE_MESSAGE });
      if (!last && this.o.escalateModel && inc.refusalCount >= 2) model = this.o.escalateModel;
      let reply;
      let cost = 0;
      try {
        const result = await this.o.budget.call(model, estimateTokens(messages) + Math.ceil(JSON.stringify(tools).length / 2), maxOut,
          (chargeId) => this.o.client.complete({ chargeId, model, messages, tools: last ? undefined : tools, toolChoice: last ? "none" : "auto", maxOutputTokens: maxOut }), !!this.o.client.replayPending?.());
        reply = result.reply;
        cost = result.cost;
      } catch (e) {
        if (e instanceof BudgetExceeded) {
          rec.push("status", inc.tNowMin, { status: "budget_stopped", message: e.message });
          tick();
          return "stopped";
        }
        if (e instanceof LLMError || e instanceof BudgetBusy) {
          this.paused = true;
          rec.push("status", inc.tNowMin, { status: "paused", message: e.message });
          tick();
          return "stopped";
        }
        throw e;
      }
      this.turns++;
      const msg: AssistantMessage = reply.message;
      messages.push(msg);
      rec.push("assistant", inc.tNowMin, { text: msg.content ?? "", model: reply.model || model, turn, tokens: reply.usage, costUsd: Number(cost.toFixed(5)), toolCalls: (msg.tool_calls ?? []).map((c) => c.function.name) });
      tick();

      if (!msg.tool_calls?.length) {
        rec.push("summary", inc.tNowMin, { text: msg.content ?? "", outcome: inc.status });
        tick();
        if (inc.status === "applied") return "alerted_and_acted";
        if (inc.status === "escalated") return "escalated";
        if (humanRejected) return "rejected";
        return inc.alerts.some((a) => a.level !== "info") ? "alerted" : "no_action";
      }

      for (const call of msg.tool_calls) {
        const name = call.function.name as ToolName;
        let args: unknown = {};
        let parseErr: string | null = null;
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          parseErr = "arguments were not valid JSON";
        }
        rec.push("tool_call", inc.tNowMin, { name, args });
        let payload: unknown;
        let signal: string | undefined;
        if (!(name in ToolSchemas)) payload = { error: `unknown tool '${name}'` };
        else if (parseErr) payload = { error: parseErr };
        else if (name === "request_action" && (inc.applied || humanRejected)) {
          payload = { error: "This invocation already received a human decision. Monitoring must observe the result before another action is requested." };
          rec.push("tool_result", inc.tNowMin, { name, ok: false, result: payload });
        }
        else {
          try {
            const res = runTool(inc, name, args);
            payload = res.data;
            signal = res.signal;
            rec.push("tool_result", inc.tNowMin, { name, ok: res.ok, result: res.data });
            if (res.gate) rec.push("gate", inc.tNowMin, { allowed: res.gate.allowed, checks: res.gate.checks, reasons: res.gate.reasons, expectedImprovementC: res.gate.expectedImprovementC, worstCaseImprovementC: res.gate.worstCaseImprovementC });
          } catch (e) {
            payload = { error: `tool failed: ${(e as Error).message}` };
            rec.push("tool_result", inc.tNowMin, { name, ok: false, result: payload });
          }
        }
        if (signal === "needs_input") {
          const verdict = await this.o.approve(inc);
          rec.push("approval", inc.tNowMin, verdict);
          if (verdict.decision === "approved") {
            const iv = applyApproval(inc);
            rec.push("applied", inc.tNowMin, { action: inc.applied!.action, tApplyMin: Number((iv.tApply / 60).toFixed(1)) });
            payload = { status: "approved", message: `A human approved. The action takes effect in ${((iv.tApply - inc.tNowS) / 60).toFixed(0)} minutes. You may now write your summary.` };
          } else {
            rejectApproval(inc);
            humanRejected = true;
            payload = { status: "rejected_by_human", message: "The human operator rejected this action. Do not retry it." };
          }
        }
        let text = JSON.stringify(payload);
        if (text.length > MAX_TOOL_RESULT_CHARS) text = text.slice(0, MAX_TOOL_RESULT_CHARS) + "…[truncated]";
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
        tick();
      }
      if (inc.status === "escalated") {
        rec.push("summary", inc.tNowMin, { text: "Three requests were refused by the safety gate; escalated to a human operator.", outcome: "escalated" });
        tick();
        return "escalated";
      }
    }
    return inc.status === "applied" ? "alerted_and_acted" : humanRejected ? "rejected" : "no_action";
  }
}
