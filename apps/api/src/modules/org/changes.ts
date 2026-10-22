import type { Branch } from "@app/contracts";
import { appendOutbox, type Tx, writeAudit } from "@app/db";
import type { OrgRequestContext } from "../../common/context";

/** Keys of `patch` whose value differs from `current`, sorted (#rule-branch-outbox `changedFields`). */
export function changedFields<T extends object>(current: T, patch: Partial<T>): Array<keyof T & string> {
  return (Object.keys(patch) as Array<keyof T & string>).filter((k) => patch[k] !== undefined && patch[k] !== current[k]).sort();
}

export function pick<T extends object>(source: T, keys: ReadonlyArray<keyof T & string>): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, source[k]]));
}

/**
 * §6 audit + #rule-branch-outbox event for a branch write, on the caller's transaction (same commit as the change).
 * The event payload is the DTO after the change without `promptpayId`; aggregateVersion = branch.version.
 */
export async function recordBranchChange(
  tx: Tx,
  ctx: OrgRequestContext,
  type: "branch.created" | "branch.updated",
  branch: Branch,
  audit: { before: Record<string, unknown> | null; after: Record<string, unknown> },
  changed?: readonly string[],
): Promise<void> {
  const { promptpayId: _excluded, ...dto } = branch;
  const common = { orgId: ctx.org.id, occurredAt: ctx.now };
  await writeAudit(tx, { ...common, actorUserId: ctx.user.id, action: type, entityType: "branch", entityId: branch.id, ...audit });
  await appendOutbox(tx, {
    ...common,
    branchId: branch.id,
    type,
    aggregateType: "branch",
    aggregateId: branch.id,
    aggregateVersion: branch.version,
    payload: changed ? { ...dto, changedFields: changed } : dto,
  });
}

/**
 * #rule-branch-schedule-outbox: one `branch.hours_changed` per effective hours/closure write with the exact minimal
 * payload `{ branchId, version }` (an invalidation signal, not a snapshot). No audit (#rule-branch-schedule-audit).
 */
export async function recordScheduleChange(tx: Tx, ctx: OrgRequestContext, branchId: string, version: number): Promise<void> {
  await appendOutbox(tx, {
    orgId: ctx.org.id,
    branchId,
    type: "branch.hours_changed",
    aggregateType: "branch",
    aggregateId: branchId,
    aggregateVersion: version,
    payload: { branchId, version },
    occurredAt: ctx.now,
  });
}

/** #rule-branch-payment-settings-audit: every digit before the last 4 becomes `*`; null stays null. Audit only. */
export function maskPromptpayId(value: string | null): string | null {
  return value === null ? null : "*".repeat(Math.max(value.length - 4, 0)) + value.slice(-4);
}
