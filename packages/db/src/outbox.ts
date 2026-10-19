import type { Tx } from "./client";
import { outboxEvent } from "./schema";
import { assertBranchOfOrg } from "./usage";

export interface OutboxEventInput {
  orgId: string | null;
  branchId?: string | null;
  type: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
  /** From ctx.now. */
  occurredAt: Date;
}

/** Queues a domain event in the caller's transaction (ADR-0004); the worker publishes it after commit. */
export async function appendOutbox(tx: Tx, event: OutboxEventInput): Promise<void> {
  await assertBranchOfOrg(tx, event.orgId, event.branchId);
  await tx.insert(outboxEvent).values(event);
}
