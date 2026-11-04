import "server-only";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { saveOrgRun } from "../db/runs";
import { Budget } from "../agent/budget";
import { LLMClient, MetaClient } from "../agent/client";
import { LLMAgent } from "../agent/loop";
import { loadRidge } from "../agent/monitor";
import { executeRun } from "../agent/record";
import { Recorder, Run } from "../agent/run";
import { ScenarioKind } from "../sim/types";
import { Incident } from "../tools/incident";
import { GateDecision } from "../tools/gate";
import { costUsd } from "../agent/pricing";
import { Checkpoint, readCheckpoint, writeCheckpoint } from "./checkpoint";

/** Live runs exist only on the builder's machine: never on Vercel, never without a key. */
export function liveEnabled(): boolean {
  return !process.env.VERCEL && !!process.env.MODEL_API_KEY;
}

export interface PendingApproval {
  id: string;
  action: Record<string, unknown>;
  reason: string;
  gate: Pick<GateDecision, "expectedImprovementC" | "worstCaseImprovementC" | "checks">;
}

export interface LiveSession {
  id: string;
  kind: ScenarioKind;
  seed: number;
  status: "running" | "needs_input" | "done" | "error";
  recorder: Recorder;
  pending: PendingApproval | null;
  resolve: ((v: "approved" | "rejected", by: string) => void) | null;
  run: Run | null;
  error: string | null;
  startedAt: number;
  actor: Actor | null;
}

/** Who started the run, and which organisation owns it. Null for local scripts and tests. */
export interface Actor {
  userId: string;
  orgId: string;
  label: string;
}

const g = globalThis as unknown as { __blindspotLive?: Map<string, LiveSession> };
const sessions = (g.__blindspotLive ??= new Map());

export function getSession(id: string, orgId?: string) {
  const existing = sessions.get(id);
  if (existing) return orgId !== undefined && existing.actor?.orgId !== orgId ? null : existing;
  const checkpoint = readCheckpoint(id);
  if (!checkpoint || (orgId !== undefined && checkpoint.actor?.orgId !== orgId)) return null;
  return recoverLiveRun(id);
}

export function snapshot(s: LiveSession) {
  if (s.pending) s.pending.id ??= `${s.id}:${s.recorder.invocation}`;
  return { id: s.id, orgId: s.actor?.orgId ?? null, kind: s.kind, seed: s.seed, status: s.status, events: s.recorder.events, pending: s.pending, run: s.run, error: s.error };
}

export interface StartOptions { kind: ScenarioKind; seed: number; model?: string; actor?: Actor | null; runCapUsd?: number }

export function startLiveRun(o: StartOptions, makeClient: () => LLMClient = () => new MetaClient()): LiveSession {
  const id = `${o.kind}-${o.seed}-live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const c: Checkpoint = { version: 1, id, ...o, runCapUsd: o.runCapUsd ?? new Budget().runCap, actor: o.actor ?? null, startedAt: Date.now(), status: "running", events: [], replies: [], approvals: [], run: null, error: null, inFlight: false };
  writeCheckpoint(c);
  return launch(c, makeClient);
}

/** Rebuild simulator/tool state by replaying saved model replies and explicit human decisions. */
export function recoverLiveRun(id: string, makeClient: () => LLMClient = () => new MetaClient()): LiveSession | null {
  const c = readCheckpoint(id);
  if (!c) return null;
  return launch(c, makeClient);
}

function launch(c: Checkpoint, makeClient: () => LLMClient): LiveSession {
  const s: LiveSession = { id: c.id, kind: c.kind as ScenarioKind, seed: c.seed, status: c.status, recorder: new Recorder(), pending: null, resolve: null, run: c.run, error: c.error, startedAt: c.startedAt, actor: c.actor };
  sessions.set(s.id, s);
  // Evict completed sessions only: pending approvals must never disappear from memory.
  if (sessions.size > 20) {
    const old = [...sessions.values()].find((v) => v.id !== s.id && ["done", "error"].includes(v.status));
    if (old) sessions.delete(old.id);
  }
  const persist = () => writeCheckpoint({ ...c, status: s.status, events: s.recorder.events, run: s.run, error: s.error });
  if (c.status === "done" || c.status === "error" || c.inFlight) {
    s.recorder.events = c.events;
    if (c.inFlight && c.status !== "done") {
      s.status = "error";
      s.error = "Server stopped during a model request. Billing is uncertain; automatic retry is disabled. Review the spend ledger before starting another run.";
      persist();
    }
    return s;
  }
  s.status = "running";
  let replyIndex = 0;
  let approvalIndex = 0;
  let client: LLMClient | null = null;
  const replayClient: LLMClient = {
    replayPending: () => replyIndex < c.replies.length,
    async complete(req) {
      if (replyIndex < c.replies.length) return { ...c.replies[replyIndex++], replayed: true };
      c.inFlight = true;
      persist();
      client ??= makeClient();
      const response = { ...await client.complete(req), chargeId: req.chargeId ?? `${s.id}:${replyIndex}` };
      c.replies.push(response);
      replyIndex++;
      c.inFlight = false;
      persist();
      return response;
    },
  };
  const agent = new LLMAgent({
    client: replayClient,
    budget: new Budget({ runCapUsd: c.runCapUsd }),
    model: c.model,
    escalateModel: process.env.MODEL_ESCALATE ?? null,
    onEvent: persist,
    approve: (inc: Incident) => {
      if (approvalIndex < c.approvals.length) return Promise.resolve(c.approvals[approvalIndex++]);
      return new Promise((resolve) => {
        const p = inc.pending!;
        s.pending = { id: `${s.id}:${approvalIndex}`, action: p.action as unknown as Record<string, unknown>, reason: p.reason, gate: { expectedImprovementC: p.gate.expectedImprovementC, worstCaseImprovementC: p.gate.worstCaseImprovementC, checks: p.gate.checks } };
        s.status = "needs_input";
        s.resolve = (decision, by) => {
          if (s.status !== "needs_input") return;
          const verdict = { decision, mode: "human" as const, by };
          c.approvals.push(verdict);
          approvalIndex++;
          s.pending = null;
          s.resolve = null;
          s.status = "running";
          persist();
          resolve(verdict);
        };
        persist();
      });
    },
  });
  void (async () => {
    try {
      const run = await executeRun({ kind: s.kind, seed: s.seed, agent, ridge: loadRidge(), recorder: s.recorder });
      run.id = s.id;
      if (s.actor) await saveOrgRun(run, s.actor);
      else {
        const dir = process.env.BLINDSPOT_RUNS_DIR ?? "data/runs";
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/${s.id}.json`, JSON.stringify(run, null, 1));
      }
      s.run = run;
      s.status = "done";
    } catch (e) {
      s.error = (e as Error).message;
      s.status = "error";
    }
    persist();
  })();
  return s;
}

/** Only one active run per workspace; unrecorded failed calls still consume its allowance. */
function workspaceCheckpoints(orgId: string) {
  const dir = process.env.BLINDSPOT_SESSIONS_DIR ?? ".data/live";
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readCheckpoint(f.slice(0, -5))).filter((c): c is Checkpoint => !!c && c.actor?.orgId === orgId) : [];
}
export function outstandingOrgSpendUsd(orgId: string) {
  return workspaceCheckpoints(orgId).filter((c) => c.status !== "done" || c.inFlight).reduce((sum, c) => sum + (c.inFlight ? Math.max(c.runCapUsd ?? 1.5, c.replies.reduce((n, r) => n + costUsd(r.model, r.usage), 0)) : c.replies.reduce((n, r) => n + costUsd(r.model, r.usage), 0)), 0);
}
export function startWorkspaceRun(o: StartOptions & { actor: Actor }, remainingUsd: number, makeClient?: () => LLMClient) {
  if (!Number.isFinite(remainingUsd) || remainingUsd <= 0) throw new Error("Workspace budget reached");
  if (workspaceCheckpoints(o.actor.orgId).some((c) => c.status === "running" || c.status === "needs_input")) throw new Error("This workspace already has an active run. Finish it before starting another.");
  const runCapUsd = Math.min(new Budget().runCap, remainingUsd);
  return startLiveRun({ ...o, runCapUsd }, makeClient);
}

/** Approval tokens bind a decision to the exact action the operator reviewed. */
export function resolveSessionApproval(s: LiveSession, approvalId: string, decision: "approved" | "rejected", by: string) {
  if (s.status !== "needs_input" || !s.pending || s.pending.id !== approvalId || !s.resolve) return false;
  const resolve = s.resolve;
  s.resolve = null;
  resolve(decision, by);
  return true;
}
