import { z } from "zod";

const zone = z.enum(["rackA", "rackB", "desk1", "desk2"]);

/** The action catalog: small and explicit. Anything else fails validation. */
export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("power_cap_rack"), rack: z.enum(["rackA", "rackB"]), fraction: z.number().min(0.4).max(0.95) }),
  z.object({ kind: z.literal("shed_noncritical_load") }),
  z.object({ kind: z.literal("switch_backup_cooling"), zone }),
  z.object({ kind: z.literal("clear_vent"), zone }),
  z.object({ kind: z.literal("dispatch_human_check") }),
  z.object({ kind: z.literal("cut_power_circuit"), circuit: z.literal("B") }),
]);
export type ActionInput = z.infer<typeof ActionSchema>;

export const actionKey = (a: ActionInput) => JSON.stringify(a, Object.keys(a).sort());

export const sensorId = z.enum(["S1", "S2", "S3", "M1", "M2"]);

export const ToolSchemas = {
  list_sensors: z.object({}),
  get_reading: z.object({ sensor: sensorId }),
  get_history: z.object({ sensor: sensorId, window_min: z.number().min(5).max(180).default(60) }),
  sensor_metadata: z.object({ sensor: sensorId }),
  estimate_hidden_zones: z.object({}),
  diagnose: z.object({}),
  simulate_action: z.object({ action: ActionSchema, horizon_min: z.number().min(10).max(120).default(60) }),
  request_action: z.object({ action: ActionSchema, reason: z.string().min(10).max(600) }),
  notify: z.object({ level: z.enum(["info", "warn", "critical"]), message: z.string().min(5).max(500) }),
} as const;
export type ToolName = keyof typeof ToolSchemas;
