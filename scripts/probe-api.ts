/**
 * Verifies the [VERIFY] items from plan.md against YOUR key, before any agent code depends on them:
 *   - available model ids (GET /models), incl. whether muse-wonder-1.0 exists
 *   - tool-calling response shape on Chat Completions and on Responses
 *   - how reasoning tokens show up in usage
 *   - which token-limit parameter name is accepted
 * Usage: npm run probe        (costs a few cents at most)
 */
import "./env";
import { writeFileSync } from "node:fs";
import OpenAI from "openai";

const base = process.env.MODEL_BASE_URL ?? "https://api.meta.ai/v1";
const key = process.env.MODEL_API_KEY;
if (!key) {
  console.error("Set MODEL_API_KEY in .env.local first.");
  process.exit(1);
}
const model = process.env.MODEL_DEFAULT ?? "muse-spark-1.3";
const sdk = new OpenAI({ apiKey: key, baseURL: base, maxRetries: 0 });
const report: Record<string, unknown> = { base, model, at: new Date().toISOString() };

const tool = { type: "function", function: { name: "get_reading", description: "Get a sensor reading", parameters: { type: "object", properties: { sensor: { type: "string", enum: ["S1", "S2"] } }, required: ["sensor"] } } };

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    report[name] = await fn();
    console.log(`OK   ${name}`);
  } catch (e) {
    report[name] = { error: (e as Error).message, status: (e as { status?: number }).status };
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

async function main() {
  await step("models", async () => {
    const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
    const j = (await r.json()) as { data?: { id: string }[] };
    return { status: r.status, ids: j.data?.map((m) => m.id) };
  });
  for (const param of ["max_tokens", "max_completion_tokens"])
    await step(`chat_tool_call_${param}`, async () => {
      const body = { model, messages: [{ role: "user", content: "Read sensor S1 using the tool." }], tools: [tool], [param]: 2000 };
      const r = (await sdk.chat.completions.create(body as never)) as unknown as { choices: { message: unknown; finish_reason: string }[]; usage: unknown };
      return { finish_reason: r.choices[0].finish_reason, message: r.choices[0].message, usage: r.usage };
    });
  await step("chat_reasoning_effort_low", async () => {
    const body = { model, messages: [{ role: "user", content: "Say hi." }], max_tokens: 2000, reasoning_effort: "low" };
    const r = (await sdk.chat.completions.create(body as never)) as unknown as { usage: unknown; choices: { message: { content: string } }[] };
    return { content: r.choices[0].message.content, usage: r.usage };
  });
  await step("responses_tool_call", async () => {
    const r = await (sdk as unknown as { responses: { create: (b: unknown) => Promise<{ output: unknown[]; usage: unknown }> } }).responses.create({
      model,
      input: "Read sensor S1 using the tool.",
      tools: [{ type: "function", name: "get_reading", description: "Get a sensor reading", parameters: tool.function.parameters }],
      max_output_tokens: 2000,
    });
    return { output: r.output, usage: r.usage };
  });
  writeFileSync("data/api-probe.json", JSON.stringify(report, null, 1));
  console.log("\nwrote data/api-probe.json. Read it, then settle MODEL_MAX_TOKENS_PARAM / MODEL_REASONING_EFFORT in .env.local.");
}
main();
