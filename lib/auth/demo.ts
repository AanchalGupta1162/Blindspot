export const DEMO_ROLES = ["admin", "operator", "viewer"] as const;
export type DemoRole = typeof DEMO_ROLES[number];
export const demoEmail = (role: DemoRole) => `demo-${role}@blindspot.example`;

/** Demo credentials stay server-side; the shortcut is opt-in and localhost-only. */
export function demoEnabled(env: Record<string, string | undefined> = process.env) {
  if (env.BLINDSPOT_DEMO_LOGIN !== "true" || !env.BLINDSPOT_DEMO_PASSWORD || env.VERCEL) return false;
  try { return new URL(env.BETTER_AUTH_URL ?? "http://localhost:3000").hostname === "localhost"; }
  catch { return false; }
}
export function demoRequestAllowed(req: Request) {
  const url = new URL(req.url);
  return url.hostname === "localhost" && req.headers.get("origin") === url.origin;
}
