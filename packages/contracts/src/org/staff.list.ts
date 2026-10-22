import { z } from "zod";
import { StaffRole } from "../identity/me.get";
import { Invitation } from "./staff.invite";

// docs/spec/features/foundation.md#contract-staff-list — active members only; email is null for managed accounts.
export const StaffMember = z.strictObject({
  membershipId: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  email: z.string().nullable(),
  username: z.string().nullable(),
  role: StaffRole,
  branchIds: z.array(z.uuid()),
  status: z.literal("active"),
  isManaged: z.boolean(),
  twoFactorEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type StaffMember = z.infer<typeof StaffMember>;

export const PendingInvitation = Invitation;
export const StaffListResponse = z.strictObject({ members: z.array(StaffMember), invitations: z.array(PendingInvitation) });
export type StaffListResponse = z.infer<typeof StaffListResponse>;
