import type { Organization, OrgUpdateRequest } from "@app/contracts";
import { writeAudit } from "@app/db";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import { changedFields, pick } from "../changes";
import { lockOrg, toOrganization, updateOrg } from "../org.repository";

/**
 * docs/spec/features/foundation.md#ep-org.update · #contract-org · #org-branch-technical-gates (1)
 * A PATCH that changes nothing returns the current DTO without UPDATE or audit.
 */
export async function orgUpdate(ctx: OrgRequestContext, input: OrgUpdateRequest): Promise<Organization> {
  return ctx.db.run(async (tx) => {
    const row = await lockOrg(tx, ctx.org.id);
    if (!row) throw new AppError("NOT_FOUND");
    const current = toOrganization(row);
    const fields = changedFields(current, input);
    if (fields.length === 0) return current;
    const updated = toOrganization(await updateOrg(tx, ctx.org.id, { ...current, ...input }, ctx.now));
    await writeAudit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.user.id,
      action: "org.updated",
      entityType: "organization",
      entityId: ctx.org.id,
      before: pick(current, fields),
      after: pick(updated, fields),
      occurredAt: ctx.now,
    });
    return updated;
  });
}
