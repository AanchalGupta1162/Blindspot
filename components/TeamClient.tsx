"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ROLE_BLURB, ROLE_LABEL, ROLE_NAMES, RoleName } from "@/lib/auth/permissions";
import { Badge } from "./ui";

interface Member {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
}

const tone = (r: string) => (r === "admin" ? "teal" : r === "operator" ? "amber" : "muted");

export default function TeamClient({ canManage, meId }: { canManage: boolean; meId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleName>("viewer");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/team");
    if (r.ok) setMembers((await r.json()).members);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const call = async (method: "POST" | "PATCH", body: object) => {
    const r = await fetch("/api/team", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg({ ok: r.ok, text: r.ok ? "Saved." : j.error ?? "Something went wrong." });
    if (r.ok) await load();
    return r.ok;
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await call("POST", { email, role })) setEmail("");
    setBusy(false);
  };

  return (
    <div>
      <h1 className="text-2xl font-medium">Team</h1>

      <div className="mt-6 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Member</th><th>Role</th>{canManage && <th className="text-right">Actions</th>}</tr></thead>
          <tbody>
            {(members ?? []).map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="font-medium">{m.name}{m.userId === meId && <span className="ml-2 text-xs text-faint">(you)</span>}</div>
                  <div className="text-xs text-muted">{m.email}</div>
                </td>
                <td>
                  {canManage ? (
                    <select className="input !w-auto !py-1.5" value={m.role} onChange={(e) => call("PATCH", { memberId: m.id, role: e.target.value })} aria-label={`Role for ${m.name}`}>
                      {ROLE_NAMES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : (
                    <Badge tone={tone(m.role) as never}>{ROLE_LABEL[m.role as RoleName] ?? m.role}</Badge>
                  )}
                </td>
                {canManage && (
                  <td className="text-right">
                    <button className="btn btn-danger !px-3 !py-1.5 text-xs" onClick={() => confirm(`Remove ${m.name} from this workspace?`) && call("PATCH", { memberId: m.id, remove: true })}>Remove</button>
                  </td>
                )}
              </tr>
            ))}
            {members === null && <tr><td colSpan={3} className="text-muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <form onSubmit={add} className="mt-8 border-t border-line pt-6">
          <div className="text-[15px] font-semibold">Add a teammate</div>
          <p className="mt-1 text-sm text-muted">Add an existing account by email.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@lab.edu" aria-label="Teammate email" />
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as RoleName)} aria-label="Role">
              {ROLE_NAMES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="btn btn-primary" disabled={busy}>Add member</button>
          </div>
        </form>
      ) : (
        <p className="mt-6 text-sm text-muted">Only admins can add or change members.</p>
      )}
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
