import { Invitation, StaffAccountCreateRequest, StaffInviteRequest, StaffListResponse, StaffMember } from "@app/contracts";
import { defineEndpoint } from "../client";

// foundation §5 staff endpoints (shop-scoped: callers send `orgId`), alphabetical.
export const staffAccountCreate = defineEndpoint({
  method: "POST",
  path: "/staff/accounts",
  response: StaffMember,
  body: StaffAccountCreateRequest,
});
export const staffInvitationRevoke = defineEndpoint({ method: "DELETE", path: "/staff/invitations/{invitationId}", response: null });
export const staffInvite = defineEndpoint({ method: "POST", path: "/staff/invitations", response: Invitation, body: StaffInviteRequest });
export const staffList = defineEndpoint({ method: "GET", path: "/staff", response: StaffListResponse });
