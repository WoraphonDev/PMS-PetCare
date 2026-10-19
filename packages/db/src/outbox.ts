import type { Tx } from "./client";
import { outboxEvent } from "./schema";

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
  await tx.insert(outboxEvent).values(event);
}
