import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EventSchema, RunSchema } from "../agent/run";
import { SCENARIO_KINDS } from "../sim/types";

export const VerdictSchema = z.object({ decision: z.enum(["approved", "rejected"]), mode: z.literal("human"), by: z.string() });
const ResponseSchema = z.object({
  chargeId: z.string().optional(),
  message: z.object({ role: z.literal("assistant"), content: z.string().nullable(), tool_calls: z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) })).optional() }),
  usage: z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative(), reasoning_tokens: z.number().nonnegative().optional() }),
  model: z.string(), finishReason: z.string().nullable(),
});
export const CheckpointSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^[a-z0-9_-]+$/),
  kind: z.enum(SCENARIO_KINDS as [string, ...string[]]), seed: z.number().int().nonnegative(), model: z.string().optional(),
  runCapUsd: z.number().finite().nonnegative().optional(),
  actor: z.object({ userId: z.string(), orgId: z.string(), label: z.string() }).nullable(),
  startedAt: z.number(), status: z.enum(["running", "needs_input", "done", "error"]),
  events: z.array(EventSchema), replies: z.array(ResponseSchema), approvals: z.array(VerdictSchema),
  run: RunSchema.nullable(), error: z.string().nullable(),
  // Mark the interval in which an HTTP response may have been billed but not saved.
  inFlight: z.boolean(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
const dir = () => process.env.BLINDSPOT_SESSIONS_DIR ?? ".data/live";
export function writeCheckpoint(value: Checkpoint) {
  const c = CheckpointSchema.parse(value);
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const file = join(dir(), `${c.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(c), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
export function readCheckpoint(id: string): Checkpoint | null {
  if (!/^[a-z0-9_-]+$/.test(id)) return null;
  const file = join(dir(), `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    const c = CheckpointSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    return c.id === id ? c : null;
  } catch { return null; }
}
