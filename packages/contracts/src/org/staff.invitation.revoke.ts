import { z } from "zod";

// docs/spec/features/foundation.md#contract-staff-invitation-revoke — 204 without body; unusable → NOT_FOUND.
export const StaffInvitationParams = z.strictObject({ invitationId: z.uuid() });
export type StaffInvitationParams = z.infer<typeof StaffInvitationParams>;
export const STAFF_INVITATION_REVOKE_STATUS = 204;
