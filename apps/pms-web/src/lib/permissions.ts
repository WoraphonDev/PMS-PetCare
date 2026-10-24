import { can, type Permission, type Role } from "@app/domain";

// foundation#permissions — the table lives only in @app/domain (T-0024-01 A). Hiding is convenience; the API decides.
export { can, canManageMember, type Permission, type Role } from "@app/domain";

/** Role-gated nav screens (foundation §7 "ผู้ใช้"), each opened by one permission. */
const screenPermission = {
  org: "org.settings.update",
  branches: "branch.update",
  staff: "staff.read",
  audit: "audit.read",
  subscription: "subscription.read",
} as const satisfies Record<string, Permission>;
export type Screen = keyof typeof screenPermission;

export function canSee(screen: Screen, role: Role): boolean {
  return can(role, screenPermission[screen]);
}
