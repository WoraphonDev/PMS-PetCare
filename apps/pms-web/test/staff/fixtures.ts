import { screen } from "@testing-library/react";
import { branch, second } from "../settings-branches/fixtures";
import { BRANCH_1, BRANCH_2, json, me, membership, renderApp, USER } from "../shell/render";

const at = "2030-01-01T00:00:00.000Z";
export const INVITATION_1 = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const INVITATION_2 = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";

export const member = (over: Record<string, unknown> = {}) => ({
  membershipId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
  userId: USER,
  displayName: "สมชาย",
  email: "owner@example.com",
  username: null,
  role: "owner",
  branchIds: [],
  status: "active",
  isManaged: false,
  twoFactorEnabled: true,
  createdAt: at,
  ...over,
});

export const managed = () =>
  member({
    membershipId: "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
    userId: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
    displayName: "น้องเอ",
    email: null,
    username: "nong.a",
    role: "groomer",
    branchIds: [BRANCH_1, BRANCH_2],
    isManaged: true,
    twoFactorEnabled: false,
  });

export const invitation = (over: Record<string, unknown> = {}) => ({
  id: INVITATION_1,
  email: "desk@example.com",
  role: "front_desk",
  branchIds: [BRANCH_2],
  expiresAt: "2030-01-08T00:00:00.000Z",
  invitedByUserId: USER,
  createdAt: at,
  ...over,
});

export const staff = (members = [member(), managed()], invitations = [invitation()]) => ({ members, invitations });

type Role = "owner" | "manager" | "front_desk" | "groomer" | "caretaker";

/** /settings/staff as `role`, with the staff list and both branches answered; waits for the list. */
export async function openStaff(routes: Record<string, Response | Response[]> = {}, role: Role = "owner") {
  const r = renderApp("/settings/staff", {
    "GET /me": json(200, me({}, [membership({ role })])),
    "GET /staff": json(200, staff()),
    "GET /branches": json(200, { items: [branch(), second()] }),
    ...routes,
  });
  await screen.findByRole("heading", { name: "พนักงาน" });
  return r;
}
