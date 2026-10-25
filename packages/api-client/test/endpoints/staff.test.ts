import {
  Invitation,
  StaffAccountCreateRequest,
  StaffInviteRequest,
  StaffListResponse,
  StaffMember,
  StaffPasswordResetRequest,
  StaffUpdateRequest,
} from "@app/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createApiClient,
  staffAccountCreate,
  staffInvitationRevoke,
  staffInvite,
  staffList,
  staffPasswordReset,
  staffRemove,
  staffUpdate,
} from "../../src/index";

const ORG_ID = "6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21";
const BRANCH_ID = "8a0b5c1d-3e2f-4a6b-8c7d-9e0f1a2b3c4d";
const USER_ID = "0b6f8f0e-6d8a-4f0f-9a3e-3c1f3b6f2a10";
const INVITATION_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const at = "2030-01-01T00:00:00.000Z";
const member = {
  membershipId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
  userId: USER_ID,
  displayName: "น้องเอ",
  email: null,
  username: "nong.a",
  role: "groomer",
  branchIds: [BRANCH_ID],
  status: "active",
  isManaged: true,
  twoFactorEnabled: false,
  createdAt: at,
};
const invitation = {
  id: INVITATION_ID,
  email: "staff@example.com",
  role: "front_desk",
  branchIds: [BRANCH_ID],
  expiresAt: "2030-01-08T00:00:00.000Z",
  invitedByUserId: USER_ID,
  createdAt: at,
};

function setup(status: number, body?: unknown) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  const api = createApiClient({ baseUrl: "/api/v1", fetch });
  const sent = () => {
    const [url, init] = fetch.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    return { url, method: init?.method, body: init?.body, orgId: headers.get("x-org-id"), contentType: headers.get("content-type") };
  };
  return { api, sent };
}

describe("staff descriptors (T-0026, foundation#contract-staff-list / -invite / -invitation-revoke / -account-create)", () => {
  it("staff.list: GET /staff with X-Org-Id → { members, invitations }", async () => {
    const { api, sent } = setup(200, { members: [member], invitations: [invitation] });
    await expect(api.request(staffList, { orgId: ORG_ID })).resolves.toEqual({ members: [member], invitations: [invitation] });
    expect(sent()).toEqual({ url: "/api/v1/staff", method: "GET", body: undefined, orgId: ORG_ID, contentType: null });
    expect(staffList.response).toBe(StaffListResponse);
  });

  it("staff.invite: POST /staff/invitations with the JSON body → 201 Invitation", async () => {
    const { api, sent } = setup(201, invitation);
    const body = { email: "staff@example.com", role: "front_desk" as const, branchIds: [BRANCH_ID] };
    await expect(api.request(staffInvite, { orgId: ORG_ID, body })).resolves.toEqual(invitation);
    expect(sent()).toEqual({
      url: "/api/v1/staff/invitations",
      method: "POST",
      body: JSON.stringify(body),
      orgId: ORG_ID,
      contentType: "application/json",
    });
    expect(staffInvite.body).toBe(StaffInviteRequest);
    expect(staffInvite.response).toBe(Invitation);
  });

  it("staff.invitation.revoke: DELETE /staff/invitations/{invitationId} (encoded), no body → 204", async () => {
    const { api, sent } = setup(204);
    await expect(api.request(staffInvitationRevoke, { orgId: ORG_ID, params: { invitationId: INVITATION_ID } })).resolves.toBeUndefined();
    expect(sent()).toEqual({
      url: `/api/v1/staff/invitations/${INVITATION_ID}`,
      method: "DELETE",
      body: undefined,
      orgId: ORG_ID,
      contentType: null,
    });
    expect(staffInvitationRevoke.response).toBeNull();
  });

  it("staff.invitation.revoke requires the invitationId path param", async () => {
    const { api } = setup(204);
    // @ts-expect-error params is required
    await expect(api.request(staffInvitationRevoke, { orgId: ORG_ID })).rejects.toThrow(TypeError);
  });

  it("staff.account.create: POST /staff/accounts with the JSON body → 201 StaffMember", async () => {
    const { api, sent } = setup(201, member);
    const body = { displayName: "น้องเอ", username: "nong.a", password: "temp-pass-123", role: "groomer" as const, branchIds: [BRANCH_ID] };
    await expect(api.request(staffAccountCreate, { orgId: ORG_ID, body })).resolves.toEqual(member);
    expect(sent()).toEqual({
      url: "/api/v1/staff/accounts",
      method: "POST",
      body: JSON.stringify(body),
      orgId: ORG_ID,
      contentType: "application/json",
    });
    expect(staffAccountCreate.body).toBe(StaffAccountCreateRequest);
    expect(staffAccountCreate.response).toBe(StaffMember);
  });
});

describe("staff manage descriptors (T-0047, foundation#contract-staff-update / -remove / -password-reset)", () => {
  const MEMBERSHIP_ID = member.membershipId;

  it("staff.update: PATCH /staff/{membershipId} with only the given fields → 200 StaffMember", async () => {
    const { api, sent } = setup(200, member);
    const body = { role: "groomer" as const, branchIds: [BRANCH_ID] };
    await expect(api.request(staffUpdate, { orgId: ORG_ID, params: { membershipId: MEMBERSHIP_ID }, body })).resolves.toEqual(member);
    expect(sent()).toEqual({
      url: `/api/v1/staff/${MEMBERSHIP_ID}`,
      method: "PATCH",
      body: JSON.stringify(body),
      orgId: ORG_ID,
      contentType: "application/json",
    });
    expect(staffUpdate.body).toBe(StaffUpdateRequest);
    expect(staffUpdate.response).toBe(StaffMember);
  });

  it("staff.remove: DELETE /staff/{membershipId}, no body → 204", async () => {
    const { api, sent } = setup(204);
    await expect(api.request(staffRemove, { orgId: ORG_ID, params: { membershipId: MEMBERSHIP_ID } })).resolves.toBeUndefined();
    expect(sent()).toEqual({ url: `/api/v1/staff/${MEMBERSHIP_ID}`, method: "DELETE", body: undefined, orgId: ORG_ID, contentType: null });
    expect(staffRemove.response).toBeNull();
  });

  it("staff.password.reset: PUT /staff/{membershipId}/password { newPassword } → 204", async () => {
    const { api, sent } = setup(204);
    const body = { newPassword: "temp-pass-456" };
    await expect(
      api.request(staffPasswordReset, { orgId: ORG_ID, params: { membershipId: MEMBERSHIP_ID }, body }),
    ).resolves.toBeUndefined();
    expect(sent()).toEqual({
      url: `/api/v1/staff/${MEMBERSHIP_ID}/password`,
      method: "PUT",
      body: JSON.stringify(body),
      orgId: ORG_ID,
      contentType: "application/json",
    });
    expect(staffPasswordReset.body).toBe(StaffPasswordResetRequest);
    expect(staffPasswordReset.response).toBeNull();
  });

  it("the membershipId path param is required", async () => {
    const { api } = setup(204);
    // @ts-expect-error params is required
    await expect(api.request(staffRemove, { orgId: ORG_ID })).rejects.toThrow(TypeError);
  });
});
