import type { Tx } from "./client";
import { usageEvent } from "./schema";

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
  await tx.insert(usageEvent).values(input);
}
