import { z } from "zod";
import { StaffRole } from "../identity/me.get";
import { strictBody } from "./fields";

const ORG_WIDE = new Set(["owner", "manager"]);

// docs/spec/features/foundation.md#contract-staff-invite — BRANCH_REQUIRED (a branch role with no branch) is decided
// by the use case after the manager rule, so an empty list passes here.
export const StaffInviteRequest = strictBody({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email())
    .refine((email) => !email.endsWith("@managed.invalid"), "Must be a real email address"),
  role: StaffRole,
  branchIds: z.array(z.uuid().transform((id) => id.toLowerCase())),
}).superRefine((value, ctx) => {
  if (new Set(value.branchIds).size !== value.branchIds.length) {
    ctx.addIssue({ code: "custom", path: ["branchIds"], message: "Branch ids must be unique" });
  }
  if (ORG_WIDE.has(value.role) && value.branchIds.length > 0) {
    ctx.addIssue({ code: "custom", path: ["branchIds"], message: "Owner and manager invitations take no branches" });
  }
});
export type StaffInviteRequest = z.infer<typeof StaffInviteRequest>;

// No token and no hash, ever.
export const Invitation = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  role: StaffRole,
  branchIds: z.array(z.uuid()),
  expiresAt: z.iso.datetime(),
  invitedByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof Invitation>;
export const STAFF_INVITE_STATUS = 201;
