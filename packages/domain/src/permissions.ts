/** foundation#roles and #permissions. Platform admin is deliberately not an organization role. */
export type Role = "owner" | "manager" | "front_desk" | "groomer" | "caretaker";

const grants = {
  "org.settings.read": ["owner", "manager", "front_desk", "groomer", "caretaker"],
  "org.settings.update": ["owner"],
  "branch.create": ["owner"],
  "branch.update": ["owner", "manager"],
  "branch.payment_settings.update": ["owner"],
  "staff.read": ["owner", "manager", "front_desk"],
  "staff.invite": ["owner", "manager"],
  "staff.update": ["owner", "manager"],
  "staff.remove": ["owner", "manager"],
  "audit.read": ["owner"],
  "subscription.read": ["owner", "manager"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof grants;

export function can(role: Role, permission: Permission): boolean {
  return (grants[permission] as readonly Role[]).includes(role);
}
export function isOrgWideRole(role: Role): boolean {
  return role === "owner" || role === "manager";
}
/** Check both the existing target role and the proposed role when changing a member's role (footnote ¹). */
export function canManageMember(actorRole: Role, targetRole: Role): boolean {
  return actorRole === "owner" || (actorRole === "manager" && !isOrgWideRole(targetRole));
}
