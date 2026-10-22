import type { Branch, BranchPaymentSettingsUpdateRequest } from "@app/contracts";
import { writeAudit } from "@app/db";
import { AppError } from "../../../common/app-error";
import { assertBranchInScope, type OrgRequestContext } from "../../../common/context";
import { maskPromptpayId } from "../changes";
import { lockBranch, toBranch, updateBranchPromptpay } from "../org.repository";

/**
 * docs/spec/features/foundation.md#ep-branch.payment_settings.update · #rule-branch-payment-settings-write ·
 * #rule-branch-payment-settings-audit — equal value writes nothing; a change bumps version and writes a masked audit,
 * never an outbox event (so no recordBranchChange).
 */
export async function branchPaymentSettingsUpdate(
  ctx: OrgRequestContext,
  branchId: string,
  input: BranchPaymentSettingsUpdateRequest,
): Promise<Branch> {
  assertBranchInScope(ctx, branchId);
  try {
    return await ctx.db.run(async (tx) => {
      const row = await lockBranch(tx, branchId);
      if (!row) throw new AppError("NOT_FOUND");
      const current = toBranch(row);
      if (current.promptpayId === input.promptpayId) return current;
      const updated = toBranch(await updateBranchPromptpay(tx, branchId, input.promptpayId, ctx.now));
      await writeAudit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.user.id,
        action: "branch.payment_settings_updated",
        entityType: "branch",
        entityId: branchId,
        before: { promptpayId: maskPromptpayId(current.promptpayId) },
        after: { promptpayId: maskPromptpayId(updated.promptpayId) },
        occurredAt: ctx.now,
      });
      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw redacted(error);
  }
}

/**
 * ErrorFilter logs `{ err }`, and a DrizzleQueryError (or a pg error's `detail`) carries the query params — the full
 * PromptPay ID. Only the SQLSTATE survives into the INTERNAL log entry.
 */
function redacted(error: unknown): Error {
  let e = error as { code?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; e && typeof e === "object" && depth < 5; depth++, e = e.cause as typeof e) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
      return new Error(`branch.paymentSettings.update failed (SQLSTATE ${e.code})`);
    }
  }
  return new Error("branch.paymentSettings.update failed");
}
