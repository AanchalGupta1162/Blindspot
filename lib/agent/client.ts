import OpenAI from "openai";

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export interface LLMRequest {
  chargeId?: string; // local ledger identity; never sent in the model API body
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  toolChoice?: "auto" | "none";
  maxOutputTokens: number;
}
export interface LLMResponse {
  chargeId?: string;
  replayed?: boolean; // recovered from a durable local checkpoint, never a second API call
  message: AssistantMessage;
  usage: { prompt_tokens: number; completion_tokens: number; reasoning_tokens?: number };
  model: string;
  finishReason: string | null;
}
export interface LLMClient {
  replayPending?(): boolean;
  complete(req: LLMRequest): Promise<LLMResponse>;
}

export class LLMError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Meta Model API through the OpenAI SDK (Chat Completions). Rate limits are per team, so 429 and 5xx
 * are retried with exponential backoff. If retries fail the caller pauses the run instead of looping.
 * The request-shape knobs (token param name, reasoning effort) are env-configurable because they are [VERIFY] items.
 */
export class MetaClient implements LLMClient {
  private sdk: OpenAI;
  constructor(o: { apiKey?: string; baseURL?: string; maxRetries?: number } = {}) {
    const apiKey = o.apiKey ?? process.env.MODEL_API_KEY;
    if (!apiKey) throw new LLMError("MODEL_API_KEY is not set");
    this.sdk = new OpenAI({ apiKey, baseURL: o.baseURL ?? process.env.MODEL_BASE_URL ?? "https://api.meta.ai/v1", maxRetries: 0 });
    this.retries = o.maxRetries ?? 4;
  }
  private retries: number;

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const tokenParam = process.env.MODEL_MAX_TOKENS_PARAM ?? "max_tokens";
    const effort = process.env.MODEL_REASONING_EFFORT ?? "low";
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      [tokenParam]: req.maxOutputTokens,
    };
    if (req.tools?.length) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? "auto";
    }
    if (effort && effort !== "off") body.reasoning_effort = effort;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = (await this.sdk.chat.completions.create(body as never)) as unknown as {
          choices: { message: AssistantMessage; finish_reason: string | null }[];
          usage?: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } };
          model: string;
        };
        const choice = res.choices[0];
        return {
          message: { role: "assistant", content: choice.message.content ?? null, tool_calls: choice.message.tool_calls },
          usage: {
            prompt_tokens: res.usage?.prompt_tokens ?? 0,
            completion_tokens: res.usage?.completion_tokens ?? 0,
            reasoning_tokens: res.usage?.completion_tokens_details?.reasoning_tokens,
          },
          model: res.model ?? req.model,
          finishReason: choice.finish_reason,
        };
      } catch (e) {
        lastErr = e;
        const status = (e as { status?: number }).status;
        const retryable = status === 429 || (status !== undefined && status >= 500) || status === undefined;
        if (!retryable || attempt === this.retries) break;
        const retryAfter = Number((e as { headers?: Record<string, string> }).headers?.["retry-after"]);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 1000 * 2 ** attempt));
      }
    }
    throw new LLMError(`model call failed: ${(lastErr as Error)?.message ?? lastErr}`, (lastErr as { status?: number })?.status);
  }
}

/** Test double: returns queued responses (functions get the request, so tests can react to tool results). */
export class MockClient implements LLMClient {
  calls: LLMRequest[] = [];
  constructor(private queue: (LLMResponse | ((req: LLMRequest) => LLMResponse))[]) {}
  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(req);
    const next = this.queue.shift();
    if (!next) throw new LLMError("mock queue empty");
    return typeof next === "function" ? next(req) : next;
  }
}
