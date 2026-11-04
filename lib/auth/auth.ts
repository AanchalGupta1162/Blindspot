import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
  // Pick the user's most recent organisation as active at sign-in, so they land in their workspace.
  databaseHooks: {
    session: {
      create: {
        before: async (s) => {
          const [m] = await db.select({ organizationId: schema.member.organizationId }).from(schema.member).where(eq(schema.member.userId, s.userId)).orderBy(desc(schema.member.createdAt)).limit(1);
          return { data: { ...s, activeOrganizationId: m?.organizationId ?? null } };
        },
      },
    },
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "admin",
      // Invitations by email need a mail provider; Blindspot runs locally, so admins add existing users by email instead.
      allowUserToCreateOrganization: true,
    }),
    nextCookies(), // keep last
  ],
});

export type Session = typeof auth.$Infer.Session;
