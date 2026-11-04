import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ---- Better Auth tables (users, sessions, organisations, members) ----
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  metadata: text("metadata"),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("viewer").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("member_org_idx").on(t.organizationId), index("member_user_idx").on(t.userId)],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("invitation_org_idx").on(t.organizationId)],
);

// ---- Blindspot application tables ----
/** A recorded agent run owned by an organisation. Bundled sample runs stay in data/runs and belong to nobody. */
export const run = pgTable(
  "run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    approvedBy: text("approved_by"),
    kind: text("kind").notNull(),
    seed: integer("seed").notNull(),
    source: text("source").notNull(),
    model: text("model"),
    status: text("status").notNull(),
    headline: text("headline").notNull(),
    alertMin: doublePrecision("alert_min"),
    breachMin: doublePrecision("breach_min"),
    costUsd: doublePrecision("cost_usd").default(0).notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("run_org_idx").on(t.organizationId, t.createdAt)],
);
