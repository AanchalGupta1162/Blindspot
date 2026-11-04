"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Run } from "../lib/agent/run";
import AgentFlow from "./AgentFlow";
import { Badge } from "./ui";
import { LiveRequestEpoch } from "../lib/ui/live-request";

interface Snap {
  id: string;
  status: "running" | "needs_input" | "done" | "error";
  events: Run["events"];
  pending: { id: string; action: Record<string, unknown>; reason: string; gate: { expectedImprovementC: number | null; worstCaseImprovementC: number | null } } | null;
  run: Run | null;
  error: string | null;
}

/** Live agent controls. Renders nothing unless the local server reports a key and a non-Vercel environment. */
export default function LivePanel({ kind, seed }: { kind: string; seed: number }) {
  const [caps, setCaps] = useState<{ live: boolean; canRun: boolean; canApprove: boolean; role: string | null; org: string | null; orgId: string | null; spentUsd: number; budgetUsd: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [busy, setBusy] = useState(false);
  const requests = useRef(new LiveRequestEpoch());
  const submitting = useRef(false);
  const [decisionBusy, setDecisionBusy] = useState<"approved" | "rejected" | null>(null);

  useEffect(() => {
    fetch("/api/agent/capabilities").then((r) => r.json()).then(setCaps).catch(() => setCaps(null));
  }, []);
  useEffect(() => {
    if (!caps?.orgId) return;
    const epoch = requests.current.capture();
    let cancelled = false;
    let saved: string | null = null;
    try { saved = localStorage.getItem(`blindspot-live:${caps.orgId}`); } catch { /* Storage may be unavailable. */ }
    if (saved) fetch(`/api/agent/run/${encodeURIComponent(saved)}`, { cache: "no-store" }).then(async r => {
      if (r.ok) { const next = await r.json(); if (!cancelled && requests.current.accepts(epoch)) setSnap(next); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [caps?.orgId]);
  useEffect(() => {
    if (caps?.orgId && snap) {
      try { localStorage.setItem(`blindspot-live:${caps.orgId}`, snap.id); } catch { /* Run remains usable without storage. */ }
    }
  }, [caps?.orgId, snap?.id]);
  useEffect(() => {
    if (!snap || snap.status === "done" || snap.status === "error" || busy || decisionBusy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const runId = snap.id;
    const poll = async () => {
      if (submitting.current) { if (!cancelled) timer = setTimeout(poll, 1000); return; }
      const epoch = requests.current.capture();
      try {
        const r = await fetch(`/api/agent/run/${encodeURIComponent(runId)}`, { cache: "no-store", signal: controller.signal });
        if (!r.ok) throw new Error("Live updates interrupted. Retrying…");
        const next = await r.json();
        if (!cancelled && requests.current.accepts(epoch)) { setSnap(next); setErr(null); }
      } catch (error) {
        if (!cancelled && requests.current.accepts(epoch)) setErr(error instanceof Error ? error.message : "Live updates interrupted. Retrying…");
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1000);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [snap?.id, snap?.status, busy, decisionBusy]);

  if (!caps) return <p role="status" className="text-sm text-muted">Connecting to the agent…</p>;
  if (!caps.live) return <p className="text-sm text-muted">Live agent unavailable. Configure the local model connection to start a run.</p>;
  const start = async () => {
    if (submitting.current) return;
    submitting.current = true;
    requests.current.invalidate();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/agent/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, seed }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not start the run.");
      setSnap(j);
    } catch (error) { setErr(error instanceof Error ? error.message : "Could not start the run. Check your connection and retry."); }
    finally { requests.current.invalidate(); submitting.current = false; setBusy(false); }
  };
  const decide = async (decision: "approved" | "rejected") => {
    if (submitting.current || !snap?.pending || !caps.canApprove) return;
    submitting.current = true;
    requests.current.invalidate();
    setDecisionBusy(decision);
    setErr(null);
    const runId = snap.id;
    const approvalId = snap.pending.id;
    try {
      const r = await fetch(`/api/agent/run/${encodeURIComponent(runId)}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, approvalId }) });
      const next = await r.json();
      if (!r.ok) throw new Error(next.error ?? "Could not record your decision.");
      setSnap(next);
    } catch (error) { setErr(error instanceof Error ? error.message : "Could not record your decision. Check your connection and retry."); }
    finally { requests.current.invalidate(); submitting.current = false; setDecisionBusy(null); }
  };

  return (
    <div className="mb-5 border-b border-line pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Live agent <span className="ml-2 text-xs text-faint">Actions require approval</span></p>
          {!caps.canRun && <p className="mt-1 text-xs text-amber">Your role ({caps.role ?? "none"}) is read-only. Ask a workspace admin for the operator role to run the agent.</p>}
          {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
        </div>
        <button onClick={start} disabled={!caps.canRun || busy || snap?.status === "running" || snap?.status === "needs_input"} className="btn btn-primary" aria-busy={busy}>{busy ? "Starting agent…" : "Run live agent"}</button>
      </div>
      {!snap && <AgentFlow events={[]} />}
      {snap && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2"><Badge tone={snap.status === "done" ? "green" : snap.status === "error" ? "red" : "amber"}>{snap.status.replace("_", " ")}</Badge></div>
          {snap.pending && (
            <div className="approval-request mt-5 border-t border-line pt-5">
              <h3 className="text-sm font-semibold">Approve this action?</h3>
              <p className="mt-2 text-sm">{actionLabel(snap.pending.action)}</p>
              <details className="mt-3 text-xs text-muted"><summary>Reason and checks</summary><p className="mt-2 leading-relaxed">{snap.pending.reason}</p><p className="mt-2">Safety gate passed. Expected improvement: {snap.pending.gate.expectedImprovementC}°C; worst plausible: {snap.pending.gate.worstCaseImprovementC}°C.</p></details>

              {caps.canApprove ? (
                <div className="mt-3 flex gap-2">
                  <button disabled={!!decisionBusy} aria-busy={decisionBusy === "approved"} onClick={() => decide("approved")} className="btn btn-primary">{decisionBusy === "approved" ? "Recording approval…" : "Approve"}</button>
                  <button disabled={!!decisionBusy} aria-busy={decisionBusy === "rejected"} onClick={() => decide("rejected")} className="btn btn-danger">{decisionBusy === "rejected" ? "Recording rejection…" : "Reject"}</button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-amber">An operator or admin must approve.</p>
              )}
            </div>
          )}
          <AgentFlow events={snap.events} waiting={snap.status === "needs_input"} />
          {snap.error && <p role="alert" className="text-danger">{snap.error}</p>}

          {snap.status === "done" && snap.run && <Link href={`/replay/${snap.id}`} className="mt-3 inline-block text-sm text-teal hover:underline">Open the recorded replay →</Link>}
        </div>
      )}
    </div>
  );
}

function actionLabel(a: Record<string, unknown>) {
  const zone = String(a.zone ?? a.rack ?? "").replace("rack", "Rack ").replace("desk", "Desk ");
  switch (a.kind) {
    case "dispatch_human_check": return "Send a technician to inspect and repair the fault.";
    case "shed_noncritical_load": return "Reduce noncritical equipment load.";
    case "power_cap_rack": return `Limit ${zone} to ${Math.round(Number(a.fraction) * 100)}% power.`;
    case "switch_backup_cooling": return `Enable backup cooling for ${zone}.`;
    case "clear_vent": return `Send a technician to clear the vent for ${zone}.`;
    case "cut_power_circuit": return `Disconnect circuit ${a.circuit}.`;
    default: return String(a.kind).replaceAll("_", " ");
  }
}
