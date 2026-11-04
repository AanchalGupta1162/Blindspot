import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Blindspot roles (per organisation):
 *  admin    - manages members and the organisation, and can do everything an operator can
 *  operator - runs the live agent and approves or rejects the actions it proposes
 *  viewer   - read-only: replays, results, run history
 */
export const statement = {
  ...defaultStatements,
  run: ["create", "approve"],
} as const;

export const ac = createAccessControl(statement);

export const admin = ac.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  run: ["create", "approve"],
});
export const operator = ac.newRole({ run: ["create", "approve"] });
export const viewer = ac.newRole({});

export const roles = { admin, operator, viewer };
export type RoleName = keyof typeof roles;
export const ROLE_NAMES = ["admin", "operator", "viewer"] as const;
export const ROLE_LABEL: Record<RoleName, string> = { admin: "Admin", operator: "Operator", viewer: "Viewer" };
export const ROLE_BLURB: Record<RoleName, string> = {
  admin: "Manages members and runs the agent",
  operator: "Runs the agent and approves actions",
  viewer: "Read-only access to runs and results",
};
