import type { Tx } from "../client";
import { plan } from "../schema";

// docs/spec/features/foundation.md#tbl-plan (Q-0005). Run on the platform connection — app_runtime cannot write `plan`.
const PLANS: (typeof plan.$inferInsert)[] = [
  { code: "mvp_free", name: "MVP Free", maxBranches: 1, maxStaff: 5, priceSatangPerMonth: 0, isActive: true },
];

/** Idempotent: inserts missing plans, never changes existing ones (a platform admin may have edited them). */
export async function seedPlans(tx: Tx): Promise<void> {
  await tx.insert(plan).values(PLANS).onConflictDoNothing({ target: plan.code });
}
