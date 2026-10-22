import type { BranchHoursPutRequest, BranchHoursPutResponse } from "@app/contracts";
import { AppError } from "../../../common/app-error";
import { assertBranchInScope, type OrgRequestContext } from "../../../common/context";
import { recordScheduleChange } from "../changes";
import { lockBranch } from "../org.repository";
import { bumpBranchVersion, listHours, updateHoursRow } from "../schedule.repository";

// Input HH:mm equals persisted time text only when the stored value has zero seconds (no truncation into a fake no-op).
const sameTime = (persisted: string | null, input: string | null) => persisted === (input === null ? null : `${input}:00`);

/**
 * docs/spec/features/foundation.md#ep-branch.hours.put · #contract-branch-hours · #rule-branch-schedule-outbox —
 * parent lock first; a semantically equal week writes nothing; otherwise only changed days, one bump and one event.
 */
export async function branchHoursPut(
  ctx: OrgRequestContext,
  branchId: string,
  input: BranchHoursPutRequest,
): Promise<BranchHoursPutResponse> {
  assertBranchInScope(ctx, branchId);
  return ctx.db.run(async (tx) => {
    if (!(await lockBranch(tx, branchId))) throw new AppError("NOT_FOUND");
    const persisted = await listHours(tx, branchId);
    // #tbl-branch_hours invariant: exactly ISO weekdays 1–7. Never repaired here → INTERNAL.
    if (persisted.length !== 7 || persisted.some((row, i) => row.weekday !== i + 1)) {
      throw new Error("branch_hours invariant violated: expected ISO weekdays 1-7");
    }
    const items = [...input.items].sort((a, b) => a.weekday - b.weekday);
    const changed = items.flatMap((day, i) => {
      const row = persisted[i];
      if (!row) return [];
      return sameTime(row.opensAt, day.opensAt) && sameTime(row.closesAt, day.closesAt) ? [] : [{ id: row.id, day }];
    });
    if (changed.length === 0) return { items };
    for (const { id, day } of changed) {
      await updateHoursRow(tx, id, day.opensAt, day.closesAt, ctx.now);
    }
    await recordScheduleChange(tx, ctx, branchId, await bumpBranchVersion(tx, branchId, ctx.now));
    return { items };
  });
}
