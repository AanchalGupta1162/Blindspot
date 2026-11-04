/** Create demo accounts through normal auth routes. Run against the local dev server. */
import { loadEnvConfig } from "@next/env";
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { DEMO_ROLES, demoEmail } from "../lib/auth/demo";
loadEnvConfig(process.cwd());
const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
if (new URL(base).hostname !== "localhost") throw new Error("Demo setup requires localhost");
const password = process.env.BLINDSPOT_DEMO_PASSWORD ?? randomBytes(32).toString("hex");
let cookie = "";
async function post(path: string, body: unknown) {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie }, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok && res.headers.getSetCookie().length) cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  return { res, data };
}
async function main() {
  // Save the password before creating accounts so an interrupted setup can be resumed.
  if (!process.env.BLINDSPOT_DEMO_PASSWORD) appendFileSync(".env.local", `\nBLINDSPOT_DEMO_PASSWORD=${password}\n`);
  for (const role of DEMO_ROLES) {
    cookie = "";
    let result = await post("/api/auth/sign-in/email", { email: demoEmail(role), password });
    if (!result.res.ok) result = await post("/api/auth/sign-up/email", { email: demoEmail(role), password, name: `Demo ${role}` });
    if (!result.res.ok) throw new Error(`Could not prepare demo ${role}; existing credentials may differ.`);
  }
  cookie = "";
  const login = await post("/api/auth/sign-in/email", { email: demoEmail("admin"), password });
  if (!login.res.ok) throw new Error("Admin login failed");
  const list = await fetch(base + "/api/auth/organization/list", { headers: { cookie } }).then(r => r.json());
  let org = list.find((o: { slug: string }) => o.slug === "blindspot-demo");
  if (!org) {
    const created = await post("/api/auth/organization/create", { name: "Blindspot Demo", slug: "blindspot-demo" });
    if (!created.res.ok) throw new Error("Demo workspace creation failed");
    org = created.data;
  }
  await post("/api/auth/organization/set-active", { organizationId: org.id });
  for (const role of ["operator", "viewer"] as const) {
    const result = await post("/api/team", { email: demoEmail(role), role });
    if (!result.res.ok && result.res.status !== 409) throw new Error(`Could not add demo ${role}`);
  }
  if (process.env.BLINDSPOT_DEMO_LOGIN !== "true") appendFileSync(".env.local", "\nBLINDSPOT_DEMO_LOGIN=true\n");
  console.log("Demo admin, operator and viewer are ready in Blindspot Demo. Restart the server to enable the login buttons.");
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
