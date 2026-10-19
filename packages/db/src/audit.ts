import type { Tx } from "./client";
import { auditLog } from "./schema";

export interface AuditEntry {
  orgId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  /** From ctx.now — never the database clock. */
  occurredAt: Date;
}

const SECRET_KEYS = new Set(["password", "token", "secret", "token_hash", "tokenHash", "password_hash", "passwordHash"]);

function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !SECRET_KEYS.has(k))
        .map(([k, v]) => [k, withoutSecrets(v)]),
    );
  }
  return value;
}

/** Appends an audit row (R: every money/permission-sensitive change) inside the caller's transaction. */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    ...entry,
    before: entry.before ? (withoutSecrets(entry.before) as Record<string, unknown>) : null,
    after: entry.after ? (withoutSecrets(entry.after) as Record<string, unknown>) : null,
  });
}
