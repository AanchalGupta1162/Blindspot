"use client";
import { useState } from "react";
import Link from "next/link";
import { SENSORS, type SensorId } from "../lib/sim/sensors";
const positions: Record<SensorId, [number, number]> = { S1:[245,185], S2:[410,375], S3:[500,92], M1:[135,450], M2:[590,285] };
const fitting: Record<SensorId, string> = {
  S1: "At Rack A’s inlet, representing the local air-temperature channel in the simulator.",
  S2: "Beside the first desk row, representing its local air temperature.",
  S3: "At the AC return duct, representing the air returning from the room.",
  M1: "At the UPS output, measuring the combined simulated equipment load.",
  M2: "Across Rack B’s feed, comparing strip and panel voltage. A rising drop can reveal a deteriorating connector.",
};
export default function RoomModel() {
  const [selected, setSelected] = useState<SensorId>("S1");
  const [hidden, setHidden] = useState(false);
  const sensor = SENSORS.find(s => s.id === selected)!;
  const choose = (id: SensorId) => setSelected(id);
  return <div>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-medium">Room</h1><p className="mt-2 text-sm text-muted">Five measurements. Several blind spots.</p></div><button className="btn" aria-pressed={hidden} onClick={() => setHidden(v => !v)}>{hidden ? "Hide blind spots" : "Show blind spots"}</button></div>
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_250px]">
      <div className="min-w-0">
        <svg viewBox="0 0 800 560" className="room-model w-full" role="group" aria-label="Illustrative lab floor plan with Rack A, Rack B, two desk rows, AC return, UPS and five selectable sensors">
          <defs><pattern id="room-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#e9edf0" strokeWidth="1" /></pattern><marker id="air-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10" fill="#a0b7cd" /></marker></defs>
          <path d="M60 65H735V495H180M105 495H60Z" fill="#fff" stroke="#aeb9c3" strokeWidth="5" />
          <rect x="64" y="69" width="667" height="422" fill="url(#room-grid)" />
          <path d="M105 495V420Q180 420 180 495" fill="none" stroke="#b9c3cc" strokeWidth="1.5" /><text x="114" y="526" className="room-label">Entry</text>
          <rect x="310" y="48" width="240" height="38" rx="3" fill="#edf3f7" stroke="#9db2c5" /><text x="430" y="72" textAnchor="middle" className="room-label">AC / return duct</text>
          <path d="M360 115V265M430 115V265M500 115V265" stroke="#c8d8e5" strokeWidth="2" strokeDasharray="5 7" markerEnd="url(#air-arrow)" />
          {[{x:145,label:"Rack A"},{x:570,label:"Rack B"}].map(r => <g key={r.label}><rect x={r.x+5} y="144" width="93" height="126" rx="4" fill="#dfe5eb" /><rect x={r.x} y="138" width="93" height="126" rx="4" fill="#f4f6f8" stroke="#9aa8b6" />{[0,1,2,3,4].map(n => <g key={n}><rect x={r.x+10} y={150+n*19} width="73" height="13" rx="2" fill="#dce3ea" /><circle cx={r.x+72} cy={156+n*19} r="2" fill="#728c7a" /></g>)}<text x={r.x+46} y="126" textAnchor="middle" className="room-label">{r.label}</text></g>)}
          {[{y:340,label:"Desk row 1"},{y:440,label:"Desk row 2"}].map(row => <g key={row.label}><text x="285" y={row.y-32} className="room-label">{row.label}</text>{[0,1,2].map(n => <g key={n}><rect x={285+n*110} y={row.y-20} width="92" height="45" rx="3" fill="#f0ebe2" stroke="#bcb3a5" /><rect x={307+n*110} y={row.y-15} width="45" height="25" rx="2" fill="#e0e7ed" stroke="#9aa8b6" /><path d={`M${329+n*110} ${row.y+10}v6h-10h20`} stroke="#9aa8b6" fill="none" /><rect x={315+n*110} y={row.y+30} width="28" height="18" rx="5" fill="#f3f4f5" stroke="#b9c3cc" /></g>)}</g>)}
          <rect x="90" y="358" width="75" height="78" rx="4" fill="#edf0f3" stroke="#9aa8b6" /><text x="127" y="389" textAnchor="middle" className="room-label">UPS</text><path d="M105 407h44m-44 8h44" stroke="#b2bdc7" />
          <path d="M166 411H215V285H615V269" fill="none" stroke="#bcc3cc" strokeWidth="3" /><circle cx="615" cy="285" r="6" fill="#fff" stroke="#9b721e" strokeWidth="2" />
          {hidden && <g aria-label="Unmeasured zones"><rect x="557" y="132" width="120" height="143" rx="8" fill="#c54a4a" fillOpacity=".08" stroke="#b96a6a" strokeDasharray="5 4" /><rect x="275" y="409" width="328" height="83" rx="6" fill="#c54a4a" fillOpacity=".08" stroke="#b96a6a" strokeDasharray="5 4" /><circle cx="615" cy="285" r="23" fill="#c54a4a" fillOpacity=".08" stroke="#b96a6a" strokeDasharray="5 4" /></g>}
          {(Object.entries(positions) as [SensorId,[number,number]][]).map(([id,[x,y]]) => <g key={id} role="button" tabIndex={0} aria-label={`${id}: ${SENSORS.find(s => s.id === id)!.label}`} aria-pressed={selected===id} onClick={() => choose(id)} onKeyDown={e => {if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(id)}}} className="sensor-pin">
            <circle cx={x} cy={y} r="22" fill="transparent" />
            <circle cx={x} cy={y} r="17" fill={selected===id ? "#315f9b" : "#fff"} stroke="#315f9b" strokeWidth={selected===id?2:1.5} />
            <text x={x} y={y+4} textAnchor="middle" fontSize="11" fontWeight="600" fill={selected===id ? "#fff" : "#315f9b"}>{id}</text>
          </g>)}
        </svg>
        <p className="mt-3 text-xs text-faint">Illustrative placement, not to scale. Software simulation; no hardware is connected.</p>
      </div>
      <aside className="pt-3" aria-live="polite"><div className="flex gap-2 flex-wrap">{SENSORS.map(s => <button key={s.id} className="btn" aria-pressed={selected===s.id} onClick={() => choose(s.id)}>{s.id}</button>)}</div><h2 className="mt-7 text-base font-medium">{sensor.label}</h2><p className="mt-2 text-sm leading-relaxed text-muted">{fitting[selected]}</p><p className="mt-3 text-xs text-muted">{sensor.kind === "temperature" ? "Temperature" : sensor.kind === "power" ? "Power" : "Voltage drop"} · {sensor.unit}</p>
      {hidden && <div className="mt-7 border-t border-line pt-5"><h3 className="text-sm font-medium">No direct temperature sensor</h3><p className="mt-2 text-sm text-muted">Rack B, desk row 2 and the UPS connector. The agent infers their condition from the five available channels.</p></div>}
      <Link href="/lab" className="mt-8 inline-block text-sm text-teal">Open live agent →</Link></aside>
    </div>
  </div>;
}
