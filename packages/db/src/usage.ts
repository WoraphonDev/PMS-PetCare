import { and, eq } from "drizzle-orm";
import type { Tx } from "./client";
import { branch, usageEvent } from "./schema";

/**
 * The FK only proves the branch exists; it must also belong to the row's organization (on the platform connection
 * RLS does not narrow this). Until branch-scoped tables use a composite FK (Q-0014) this check is the guard.
 */
export async function assertBranchOfOrg(tx: Tx, orgId: string | null, branchId: string | null | undefined): Promise<void> {
  if (branchId == null) return;
  const found =
    orgId === null
      ? []
      : await tx
          .select({ id: branch.id })
          .from(branch)
          .where(and(eq(branch.id, branchId), eq(branch.orgId, orgId)))
          .limit(1);
  if (found.length === 0) throw new TypeError(`branch ${branchId} does not belong to organization ${orgId}`);
}

export interface UsageInput {
  orgId: string;
  branchId?: string | null;
  kind: string;
  quantity: number;
  /** Integer satang, or null when the cost is unknown. */
  unitCostSatang: number | null;
  /** From ctx.now. */
  occurredAt: Date;
}

/** Records a billable usage unit (ADR-0005 §4) inside the caller's transaction. */
export async function recordUsage(tx: Tx, input: UsageInput): Promise<void> {
  if (!Number.isInteger(input.quantity)) throw new TypeError("recordUsage: quantity must be an integer");
  if (input.unitCostSatang !== null && !Number.isInteger(input.unitCostSatang)) {
    throw new TypeError("recordUsage: unitCostSatang must be integer satang");
  }
  await assertBranchOfOrg(tx, input.orgId, input.branchId);
  await tx.insert(usageEvent).values(input);
}
