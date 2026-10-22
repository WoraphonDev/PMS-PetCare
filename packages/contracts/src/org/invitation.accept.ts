import { z } from "zod";
import { StaffRole } from "../identity/me.get";
import { strictBody } from "./fields";

// docs/spec/features/foundation.md#contract-invitation-accept — the token comes from the email link's fragment.
export const InvitationAcceptRequest = strictBody({ token: z.string().min(1).max(200) });
export type InvitationAcceptRequest = z.infer<typeof InvitationAcceptRequest>;

export const InvitationAcceptResponse = z.strictObject({
  orgId: z.uuid(),
  membershipId: z.uuid(),
  role: StaffRole,
  branchIds: z.array(z.uuid()),
});
export type InvitationAcceptResponse = z.infer<typeof InvitationAcceptResponse>;
export const INVITATION_ACCEPT_STATUS = 200;
