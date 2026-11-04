"use client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Badge } from "./ui";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export default function WorkspaceClient({ activeId }: { activeId: string | null }) {
  const router = useRouter();
  const orgs = authClient.useListOrganizations();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (organizationId: string) => {
    await authClient.organization.setActive({ organizationId });
    router.push("/runs");
    router.refresh();
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // a short random suffix keeps slugs unique without asking the user to invent one
    const slug = `${slugify(name) || "workspace"}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await authClient.organization.create({ name: name.trim(), slug });
    if (res.error || !res.data) {
      setBusy(false);
      return setError(res.error?.message ?? "Could not create the workspace.");
    }
    await authClient.organization.setActive({ organizationId: res.data.id });
    router.push("/runs");
    router.refresh();
  };

  const list = orgs.data ?? [];
  return (
    <div className="mx-auto mt-6 max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">{list.length ? "Your workspaces" : "Create your first workspace"}</h1>


      {list.length > 0 && (
        <div className="mt-6 divide-y divide-line/70">
          {list.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{o.name}</div>
                <div className="mono truncate text-xs text-faint">{o.slug}</div>
              </div>
              <div className="flex items-center gap-3">
                {o.id === activeId && <Badge tone="teal">active</Badge>}
                <button className="btn" onClick={() => open(o.id)}>Open</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={create} className="mt-6 space-y-4 p-6">
        <div>
          <label className="label" htmlFor="org">{list.length ? "New workspace name" : "Workspace name"}</label>
          <input id="org" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} placeholder="e.g. Electrical Engineering Lab, IIT Delhi" />
        </div>
        {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <button className="btn btn-primary" disabled={busy || name.trim().length < 2}>{busy ? "Creating…" : "Create workspace"}</button>
      </form>
    </div>
  );
}
