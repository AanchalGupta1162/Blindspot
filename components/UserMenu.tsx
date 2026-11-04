"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Badge } from "./ui";

interface U {
  name: string;
  email: string;
  org: string | null;
  role: string | null;
}

export default function UserMenu({ user }: { user: U | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const orgs = authClient.useListOrganizations();

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/sign-in" className="btn">Sign in</Link>
        <Link href="/sign-up" className="btn btn-primary">Create account</Link>
      </div>
    );
  }

  const switchOrg = async (organizationId: string) => {
    await authClient.organization.setActive({ organizationId });
    setOpen(false);
    router.refresh();
  };
  const signOut = async () => {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  };
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5 text-left transition hover:bg-panel2" aria-label="Account and workspaces" aria-haspopup="menu" aria-expanded={open}>
        <span className="grid h-6 w-6 place-items-center rounded-full bg-teal/15 text-[11px] font-semibold text-teal">{initials}</span>
        <span className="hidden leading-tight sm:block">
          <span className="block max-w-[140px] truncate text-[13px] font-medium">{user.org ?? "No workspace"}</span>
          <span className="mono block text-[10px] uppercase tracking-wider text-faint">{user.role ?? "—"}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="panel absolute right-0 mt-2 w-72 p-2 shadow-2xl shadow-black/40">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
          </div>
          <div className="my-1 border-t border-line" />
          <div className="eyebrow px-3 py-1.5">Workspaces</div>
          {(orgs.data ?? []).map((o) => (
            <button key={o.id} onClick={() => switchOrg(o.id)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-panel2">
              <span className="truncate">{o.name}</span>
              {o.name === user.org && <Badge tone="teal">active</Badge>}
            </button>
          ))}
          <Link href="/workspace" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-sm text-teal hover:bg-panel2">New or manage workspaces →</Link>
          <div className="my-1 border-t border-line" />
          <button onClick={signOut} className="w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-panel2 hover:text-danger">Sign out</button>
        </div>
      )}
    </div>
  );
}
