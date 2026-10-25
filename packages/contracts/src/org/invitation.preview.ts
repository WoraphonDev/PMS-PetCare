import { z } from "zod";
import { StaffRole } from "../identity/me.get";
import { strictBody } from "./fields";

// docs/spec/features/foundation.md#contract-invitation-preview — public; the token comes from the email link's fragment.
export const InvitationPreviewRequest = strictBody({ token: z.string().min(1).max(200) });
export type InvitationPreviewRequest = z.infer<typeof InvitationPreviewRequest>;

// Never says whether an account exists for the email.
export const InvitationPreviewResponse = z.strictObject({
  orgDisplayName: z.string(),
  role: StaffRole,
  branchNames: z.array(z.string()),
  email: z.string(),
  expiresAt: z.iso.datetime(),
});
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponse>;
export const INVITATION_PREVIEW_STATUS = 200;
