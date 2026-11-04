/** USD per 1M tokens, from the Meta model list. [VERIFY] against the live pricing page before relying on it. */
export const PRICING: Record<string, { input: number; output: number }> = {
  "muse-spark-1.3": { input: 1.25, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, output: 0.2 },
  "muse-wonder-1.0": { input: 4, output: 20 },
};

/** Unknown models are priced like the most expensive known one, so the cap errs on the safe side. */
export function priceFor(model: string) {
  return PRICING[model] ?? PRICING["muse-wonder-1.0"];
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
}

/**
 * Reasoning tokens bill as output. OpenAI-style APIs already include them in completion_tokens;
 * if a response reports MORE reasoning tokens than completion tokens, treat them as separate and add them.
 */
export function billedOutputTokens(u: Usage): number {
  const r = u.reasoning_tokens ?? 0;
  return r > u.completion_tokens ? u.completion_tokens + r : u.completion_tokens;
}

export function costUsd(model: string, u: Usage): number {
  const p = priceFor(model);
  return (u.prompt_tokens * p.input + billedOutputTokens(u) * p.output) / 1_000_000;
}

/** Worst case for one more call: all input tokens plus a full output allowance. */
export function worstCaseCallUsd(model: string, inputTokensEstimate: number, maxOutputTokens: number): number {
  const p = priceFor(model);
  return (inputTokensEstimate * p.input + maxOutputTokens * p.output) / 1_000_000;
}
