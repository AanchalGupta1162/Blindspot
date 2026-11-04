import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { DEMO_ROLES, demoEmail, demoEnabled, demoRequestAllowed } from "@/lib/auth/demo";
const Body = z.object({ role: z.enum(DEMO_ROLES) }).strict();
export async function POST(req: Request) {
  if (!demoEnabled() || !demoRequestAllowed(req)) return Response.json({ error: "Demo login is unavailable." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose a demo role." }, { status: 400 });
  return auth.api.signInEmail({ body: { email: demoEmail(parsed.data.role), password: process.env.BLINDSPOT_DEMO_PASSWORD! }, headers: req.headers, asResponse: true });
}
