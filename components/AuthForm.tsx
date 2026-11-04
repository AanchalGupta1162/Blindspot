"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth/client";

export default function AuthForm({ mode, next, demo = false }: { demo?: boolean; mode: "sign-in" | "sign-up"; next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const up = mode === "sign-up";
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/runs";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = up ? await authClient.signUp.email({ name: name.trim(), email, password }) : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? "Something went wrong. Try again.");
    router.push(up ? "/workspace" : dest);
    router.refresh();
  };

  const demoLogin = async (role: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      if (!res.ok) throw new Error("Demo login failed. Check that demo accounts are set up.");
      router.push("/lab");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Demo login failed."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto mt-10 max-w-md">
      <h1 className="text-3xl font-semibold tracking-tight">{up ? "Create account" : "Sign in"}</h1>

      {!up && demo && (
        <div className="mt-7 space-y-3 border-b border-line pb-6">
          <div className="text-sm font-medium">Quick demo login</div>
          <div className="flex flex-wrap gap-2">
            {["admin", "operator", "viewer"].map((role) => <button key={role} type="button" className={role === "admin" ? "btn btn-primary" : "btn"} disabled={busy} onClick={() => demoLogin(role)}>Demo {role[0].toUpperCase() + role.slice(1)}</button>)}
          </div>
        </div>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4">
        {up && (
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Ada Lovelace" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@lab.edu" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={up ? "new-password" : "current-password"} placeholder="At least 8 characters" />
        </div>
        {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Please wait…" : up ? "Create account" : "Sign in"}</button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        {up ? "Already have an account? " : "New to Blindspot? "}
        <Link href={up ? "/sign-in" : "/sign-up"} className="text-teal hover:underline">{up ? "Sign in" : "Create an account"}</Link>
      </p>
    </div>
  );
}
