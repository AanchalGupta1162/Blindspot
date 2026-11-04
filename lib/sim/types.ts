/** Thermal nodes. Indices 0-3 are rooms/zones with vents; 4 is return air; 5 is the power connector. */
export const NODES = ["rackA", "rackB", "desk1", "desk2", "ret", "conn"] as const;
export type Node = (typeof NODES)[number];
export const NODE_LABEL: Record<Node, string> = {
  rackA: "Rack A",
  rackB: "Rack B (critical load)",
  desk1: "Desk row 1",
  desk2: "Desk row 2",
  ret: "Return air",
  conn: "UPS connector (rack B feed)",
};

export const DT = 5; // integration step, seconds
export const SAMPLE_S = 30; // recording / sensing interval, seconds
export const STEPS_PER_SAMPLE = SAMPLE_S / DT;

/** SIMULATED limits. These are configurable thresholds inside the simulation, not real safety limits. */
export const LIMITS: Record<Node, number> = { rackA: 35, rackB: 35, desk1: 32, desk2: 32, ret: 33, conn: 70 };
/** The baseline alarm fires this many degrees below the limit. */
export const ALERT_MARGIN = 3;

export const HIDDEN_NODES: Node[] = ["rackB", "desk2", "conn"];
export const VISIBLE_NODES: Node[] = ["rackA", "desk1", "ret"];

export type ScenarioKind =
  | "ac_failure"
  | "blocked_vent"
  | "load_spike"
  | "loose_connection"
  | "stuck_sensor"
  | "unattended_ac"
  | "control";

export const SCENARIO_KINDS: ScenarioKind[] = [
  "ac_failure",
  "blocked_vent",
  "load_spike",
  "loose_connection",
  "stuck_sensor",
  "unattended_ac",
  "control",
];

export const SCENARIO_LABEL: Record<ScenarioKind, string> = {
  ac_failure: "AC failure",
  blocked_vent: "Blocked vent",
  load_spike: "Load spike on rack B",
  loose_connection: "Loose connection (precursor)",
  stuck_sensor: "Stuck sensor + blocked vent",
  unattended_ac: "Unattended after-hours AC fault",
  control: "No-fault control",
};

/** Time-varying fault state of the (true) system. */
export interface FaultState {
  acCap: number; // 1 = full cooling capacity
  vent: [number, number, number, number]; // airflow factor for rackA, rackB, desk1, desk2
  spike: number; // extra load multiplier on rack B (1 = none)
  rContact: number; // contact resistance of the rack B connector, ohms
}

export const R_CONTACT_NOMINAL = 0.01;
export const nominalFault = (): FaultState => ({
  acCap: 1,
  vent: [1, 1, 1, 1],
  spike: 1,
  rContact: R_CONTACT_NOMINAL,
});

/** Operator / automated actions. */
export type Action =
  | { kind: "power_cap_rack"; rack: "rackA" | "rackB"; fraction: number }
  | { kind: "shed_noncritical_load" }
  | { kind: "switch_backup_cooling"; zone: "rackA" | "rackB" | "desk1" | "desk2" }
  | { kind: "clear_vent"; zone: "rackA" | "rackB" | "desk1" | "desk2" }
  | { kind: "dispatch_human_check" }
  | { kind: "cut_power_circuit"; circuit: "B" };

export interface Intervention {
  tApply: number; // seconds from scenario start when it takes effect
  action: Action;
}

/** One recorded sample of the true system. */
export interface Trace {
  n: number;
  t: Float64Array;
  T: Float64Array[]; // [node][k]
  loadW: Float64Array[]; // [rackA, rackB, desk1, desk2][k]
  rContact: Float64Array;
  vdropMv: Float64Array; // voltage drop across rack-B connector
  totalKw: Float64Array;
}
