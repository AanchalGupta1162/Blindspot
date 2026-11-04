"use client";
import { useId, useState } from "react";
import type { Run } from "../lib/agent/run";
import { eventNode, eventSummary, GRAPH_NODES, type GraphNodeId } from "../lib/ui/agent-flow";
import styles from "./AgentFlow.module.css";
const edges = ["M218 64 H258", "M353 96 V154", "M300 96 V118 H123 V154", "M145 154 V128 H325 V96", "M353 218 V276", "M258 308 H218", "M123 340 V398", "M218 430 H258", "M448 308 H474 V64 H448"];
export default function AgentFlow({ events, waiting = false }: { events: Run["events"]; waiting?: boolean }) {
  const [selected, setSelected] = useState<GraphNodeId | null>(null);
  const marker = useId().replaceAll(":", "");
  const latestInvocation = events.at(-1)?.invocation;
  const current = events.filter(e => e.invocation === latestInvocation);
  const active = waiting ? "approval" : current.length ? eventNode(current[current.length - 1]) : null;
  const visible = selected ? events.filter(e => eventNode(e) === selected) : events;
  const chosen = GRAPH_NODES.find(n => n.id === selected);
  return <section className={styles.workspace} aria-label="Agent workflow and event log">
    <div className={styles.header}><strong>Agent workflow</strong><span role="status">{waiting ? "Waiting for operator approval" : events.length ? `${events.length} events recorded` : "Ready for a live run"}</span></div>
    <div className={styles.panes}>
      <div className={styles.canvas}>
        <svg viewBox="0 0 500 490" role="group" aria-label="Interactive workflow graph. Select a node to inspect its events.">
          <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10" fill="#94a3b8" /></marker></defs>
          {edges.map((d,i)=><path key={i} d={d} fill="none" stroke="#aebdcb" strokeWidth="1.5" markerEnd={`url(#${marker})`} />)}
          {GRAPH_NODES.map(n => {
            const history = events.filter(e => eventNode(e) === n.id);
            const decision = history.filter(e => e.kind === "gate" || e.kind === "approval" || e.kind === "tool_result").at(-1);
            const refused = Boolean(decision && (decision.kind === "gate" && decision.data.allowed === false || decision.kind === "approval" && decision.data.decision === "rejected" || decision.kind === "tool_result" && decision.data.ok === false));
            const status = refused ? "Refused" : active === n.id ? waiting ? "Waiting" : "Latest activity" : history.length ? "Recorded" : "Idle";
            const color = refused ? "#be3346" : active === n.id ? "#0d827b" : "#64748b";
            return <g key={n.id} className={`${styles.node} ${active === n.id ? styles.active : ""}`} role="button" tabIndex={0} aria-label={`${n.label}: ${status}, ${history.length} events`} aria-pressed={selected===n.id} onClick={()=>setSelected(n.id)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setSelected(n.id);}}}>
              <rect x={n.x} y={n.y} width="190" height="64" rx="10" fill={selected===n.id ? "#e8f6f5" : "#fff"} stroke={selected===n.id||active===n.id ? "#0d827b" : "#ced9e3"} strokeWidth={selected===n.id||active===n.id?2:1}/>
              <circle cx={n.x+15} cy={n.y+19} r="4" fill={color}/><text x={n.x+28} y={n.y+23} fontSize="12" fontWeight="600" fill="#243746">{n.label}</text>
              <text x={n.x+15} y={n.y+47} fontSize="10" fill={color}>{status}{history.length ? ` · ${history.length}` : ""}</text>
            </g>;
          })}
        </svg><p className={styles.legend}>Select a node to inspect its events. Loops show investigation and retry paths.</p>
      </div>
      <div className={styles.log}>
        <div className={styles.tools}><strong>{chosen ? chosen.label : "Live event log"}</strong>{selected && <button onClick={()=>setSelected(null)}>Show all events</button>}</div>
        <p className={styles.description}>{chosen?.detail ?? "Actual agent decisions, tool calls and safety checks, in order."}</p>
        <div className={styles.events} role="log" aria-label={chosen ? `${chosen.label} events` : "Agent events"}>
          {!visible.length && <p className={styles.empty}>{events.length ? "No events for this node yet." : "Start a live run to watch observations reach Muse, tools test actions, and the safety gate request your approval."}</p>}
          {visible.map(e=><article key={e.i} className={styles.event}><p className={styles.meta}>#{e.i+1} · t={e.tMin}m · investigation {e.invocation}</p><p>{eventSummary(e)}</p><details><summary>Event data</summary><pre>{JSON.stringify(e.data,null,2)}</pre></details></article>)}
        </div>
      </div>
    </div>
  </section>;
}
