import { describe, expect, it } from "vitest";
import { can, canManageMember, isOrgWideRole, type Permission, type Role } from "../src/permissions";

const roles = ["owner", "manager", "front_desk", "groomer", "caretaker"] as const;
// Independent literal transcription of foundation#permissions (including each staff action).
const matrix: Record<Permission, readonly boolean[]> = {
  "org.settings.read": [true, true, true, true, true],
  "org.settings.update": [true, false, false, false, false],
  "branch.create": [true, false, false, false, false],
  "branch.update": [true, true, false, false, false],
  "branch.payment_settings.update": [true, false, false, false, false],
  "staff.read": [true, true, true, false, false],
  "staff.invite": [true, true, false, false, false],
  "staff.update": [true, true, false, false, false],
  "staff.remove": [true, true, false, false, false],
  "audit.read": [true, false, false, false, false],
  "subscription.read": [true, true, false, false, false],
};
const management: Record<Role, readonly boolean[]> = {
  owner: [true, true, true, true, true],
  manager: [false, false, true, true, true],
  front_desk: [false, false, false, false, false],
  groomer: [false, false, false, false, false],
  caretaker: [false, false, false, false, false],
};
describe("foundation permission matrix", () => {
  for (const [permission, expected] of Object.entries(matrix)) {
    roles.forEach((role, i) => {
      it(`${role}: ${permission}`, () => expect(can(role, permission as Permission)).toBe(expected[i]));
    });
  }
  for (const actor of roles) {
    roles.forEach((target, i) => {
      it(`${actor} manages/assigns ${target}`, () => expect(canManageMember(actor, target)).toBe(management[actor][i]));
    });
  }
  it.each([
    ["owner", true],
    ["manager", true],
    ["front_desk", false],
    ["groomer", false],
    ["caretaker", false],
  ] as const)("%s organization scope is %s", (role, expected) => expect(isOrgWideRole(role)).toBe(expected));
});
