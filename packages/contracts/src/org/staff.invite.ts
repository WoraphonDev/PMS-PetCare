import { z } from "zod";
import { StaffRole } from "../identity/me.get";
import { strictBody } from "./fields";

const ORG_WIDE = new Set(["owner", "manager"]);

export const BranchIds = z.array(z.uuid().transform((id) => id.toLowerCase()));

/**
 * #contract-staff-invite role/branch rules, shared with #contract-staff-account-create. BRANCH_REQUIRED (a branch role
 * with no branch) is decided by the use case after the manager rule, so an empty list passes here.
 */
export function roleBranchRules(value: { role?: string; branchIds?: readonly string[] }, ctx: z.RefinementCtx): void {
  const branchIds = value.branchIds ?? [];
  if (new Set(branchIds).size !== branchIds.length) {
    ctx.addIssue({ code: "custom", path: ["branchIds"], message: "Branch ids must be unique" });
  }
  if (value.role !== undefined && ORG_WIDE.has(value.role) && branchIds.length > 0) {
    ctx.addIssue({ code: "custom", path: ["branchIds"], message: "Owner and manager take no branches" });
  }
}

// docs/spec/features/foundation.md#contract-staff-invite
export const StaffInviteRequest = strictBody({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email())
    .refine((email) => !email.endsWith("@managed.invalid"), "Must be a real email address"),
  role: StaffRole,
  branchIds: BranchIds,
}).superRefine(roleBranchRules);
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
