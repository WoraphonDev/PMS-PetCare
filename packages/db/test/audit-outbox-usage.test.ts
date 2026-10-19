import { randomUUID } from "node:crypto";
import { eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appendOutbox,
  auditLog,
  branch,
  organization,
  outboxEvent,
  recordUsage,
  usageEvent,
  withPlatform,
  withTenant,
  writeAudit,
} from "../src";
import { createTestDb, type TestDb } from "./support/test-db";

let t: TestDb;
const A = randomUUID();
const B = randomUUID();
const NOW = new Date("2026-10-20T03:00:00.000Z");

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, slug] of [
    [A, "audit-a"],
    [B, "audit-b"],
  ] as const) {
    await withTenant(t.runtimeDb, id, (tx) => tx.insert(organization).values({ id, slug, displayName: slug }));
  }
}, 120_000);

afterAll(async () => {
  await t?.stop();
});

const pgCode = (e: unknown) => (e as { cause?: { code?: string } })?.cause?.code;

describe("same transaction as the data change", () => {
  it("rolls back audit, outbox and usage together with the change", async () => {
    const branchId = randomUUID();
    const ABORT = new Error("abort after all writes");
    const outcome = withTenant(t.runtimeDb, A, async (tx) => {
      await tx.insert(branch).values({ id: branchId, orgId: A, name: "rolled-back" });
      await writeAudit(tx, {
        orgId: A,
        actorUserId: null,
        action: "branch.created",
        entityType: "branch",
        entityId: branchId,
        after: { name: "rolled-back" },
        occurredAt: NOW,
      });
      await appendOutbox(tx, {
        orgId: A,
        branchId,
        type: "branch.created",
        aggregateType: "branch",
        aggregateId: branchId,
        aggregateVersion: 1,
        payload: {},
        occurredAt: NOW,
      });
      await recordUsage(tx, { orgId: A, branchId, kind: "email.send", quantity: 1, unitCostSatang: null, occurredAt: NOW });
      throw ABORT;
    });
    // Must reject with our sentinel — proves every write above ran before the rollback.
    await expect(outcome).rejects.toBe(ABORT);

    const counts = await withPlatform(t.platformDb, async (tx) => ({
      branches: (await tx.select().from(branch).where(eq(branch.id, branchId))).length,
      audit: (await tx.select().from(auditLog).where(eq(auditLog.entityId, branchId))).length,
      outbox: (await tx.select().from(outboxEvent).where(eq(outboxEvent.aggregateId, branchId))).length,
      usage: (await tx.select().from(usageEvent).where(eq(usageEvent.branchId, branchId))).length,
    }));
    expect(counts).toEqual({ branches: 0, audit: 0, outbox: 0, usage: 0 });
  });

  it("commits all of them with the tenant's org_id", async () => {
    const branchId = randomUUID();
    await withTenant(t.runtimeDb, A, async (tx) => {
      await tx.insert(branch).values({ id: branchId, orgId: A, name: "committed" });
      await writeAudit(tx, {
        orgId: A,
        actorUserId: null,
        action: "branch.created",
        entityType: "branch",
        entityId: branchId,
        after: { name: "committed" },
        occurredAt: NOW,
      });
      await appendOutbox(tx, {
        orgId: A,
        branchId,
        type: "branch.created",
        aggregateType: "branch",
        aggregateId: branchId,
        aggregateVersion: 1,
        payload: { name: "committed" },
        occurredAt: NOW,
      });
      await recordUsage(tx, { orgId: A, branchId, kind: "email.send", quantity: 2, unitCostSatang: 5, occurredAt: NOW });
    });
    const rows = await withPlatform(t.platformDb, async (tx) => ({
      audit: await tx.select().from(auditLog).where(eq(auditLog.entityId, branchId)),
      outbox: await tx.select().from(outboxEvent).where(eq(outboxEvent.aggregateId, branchId)),
      usage: await tx.select().from(usageEvent).where(eq(usageEvent.branchId, branchId)),
    }));
    expect(rows.audit).toHaveLength(1);
    expect(rows.audit[0]).toMatchObject({ orgId: A, action: "branch.created", occurredAt: NOW });
    expect(rows.outbox[0]).toMatchObject({ orgId: A, publishedAt: null, attempts: 0, occurredAt: NOW });
    expect(rows.usage[0]).toMatchObject({ orgId: A, quantity: 2, unitCostSatang: 5 });
  });
});

describe("tenant isolation", () => {
  it("another organization cannot see A's audit log or usage", async () => {
    const seen = await withTenant(t.runtimeDb, B, async (tx) => ({
      audit: await tx.select().from(auditLog),
      usage: await tx.select().from(usageEvent),
    }));
    expect(seen).toEqual({ audit: [], usage: [] });
  });

  it("cannot write audit or usage rows for another organization", async () => {
    const id = randomUUID();
    const audit = await withTenant(t.runtimeDb, B, (tx) =>
      writeAudit(tx, { orgId: A, actorUserId: null, action: "x", entityType: "branch", entityId: id, occurredAt: NOW }),
    ).catch((e) => e);
    expect(pgCode(audit)).toBe("42501");
    const usage = await withTenant(t.runtimeDb, B, (tx) =>
      recordUsage(tx, { orgId: A, kind: "x", quantity: 1, unitCostSatang: null, occurredAt: NOW }),
    ).catch((e) => e);
    expect(pgCode(usage)).toBe("42501");
  });

  it("runtime role cannot write platform-level audit rows (org_id null)", async () => {
    const res = await withTenant(t.runtimeDb, A, (tx) =>
      writeAudit(tx, { orgId: null, actorUserId: null, action: "platform.x", entityType: "organization", entityId: A, occurredAt: NOW }),
    ).catch((e) => e);
    expect(pgCode(res)).toBe("42501");
    await withPlatform(t.platformDb, (tx) =>
      writeAudit(tx, {
        orgId: null,
        actorUserId: null,
        action: "platform.org_status_changed",
        entityType: "organization",
        entityId: A,
        occurredAt: NOW,
      }),
    );
  });
});

describe("branch must belong to the row's organization", () => {
  let branchOfB: string;

  beforeAll(async () => {
    branchOfB = randomUUID();
    await withTenant(t.runtimeDb, B, (tx) => tx.insert(branch).values({ id: branchOfB, orgId: B, name: "b-branch" }));
  });

  it("recordUsage rejects another organization's branch", async () => {
    await expect(
      withTenant(t.runtimeDb, A, (tx) =>
        recordUsage(tx, { orgId: A, branchId: branchOfB, kind: "x", quantity: 1, unitCostSatang: null, occurredAt: NOW }),
      ),
    ).rejects.toThrow(/branch .* does not belong/);
  });

  it("appendOutbox rejects another organization's branch", async () => {
    await expect(
      withTenant(t.runtimeDb, A, (tx) =>
        appendOutbox(tx, {
          orgId: A,
          branchId: branchOfB,
          type: "x",
          aggregateType: "branch",
          aggregateId: branchOfB,
          aggregateVersion: 1,
          payload: {},
          occurredAt: NOW,
        }),
      ),
    ).rejects.toThrow(/branch .* does not belong/);
  });

  it("is also enforced on the platform connection (no RLS there)", async () => {
    await expect(
      withPlatform(t.platformDb, (tx) =>
        appendOutbox(tx, {
          orgId: A,
          branchId: branchOfB,
          type: "x",
          aggregateType: "branch",
          aggregateId: branchOfB,
          aggregateVersion: 1,
          payload: {},
          occurredAt: NOW,
        }),
      ),
    ).rejects.toThrow(/branch .* does not belong/);
  });

  it("an outbox event without an organization cannot name a branch", async () => {
    await expect(
      withPlatform(t.platformDb, (tx) =>
        appendOutbox(tx, {
          orgId: null,
          branchId: branchOfB,
          type: "x",
          aggregateType: "branch",
          aggregateId: branchOfB,
          aggregateVersion: 1,
          payload: {},
          occurredAt: NOW,
        }),
      ),
    ).rejects.toThrow(/branch .* does not belong/);
  });
});

describe("append-only grants", () => {
  it.each([
    ["update audit_log", sql`update audit_log set action = 'tampered'`],
    ["delete audit_log", sql`delete from audit_log`],
    ["update usage_event", sql`update usage_event set quantity = 0`],
    ["delete usage_event", sql`delete from usage_event`],
    ["select outbox_event", sql`select * from outbox_event`],
    ["update outbox_event", sql`update outbox_event set attempts = 9`],
    ["delete outbox_event", sql`delete from outbox_event`],
  ])("app_runtime cannot %s", async (_label, stmt) => {
    const res = await withTenant(t.runtimeDb, A, (tx) => tx.execute(stmt)).catch((e) => e);
    expect(pgCode(res)).toBe("42501");
  });

  it("the platform role (outbox worker) can read pending events and mark them published", async () => {
    const pending = await withPlatform(t.platformDb, (tx) => tx.select().from(outboxEvent).where(isNull(outboxEvent.publishedAt)));
    expect(pending.length).toBeGreaterThan(0);
    const first = pending[0];
    if (!first) throw new Error("no pending outbox event");
    const updated = await withPlatform(t.platformDb, (tx) =>
      tx.update(outboxEvent).set({ publishedAt: NOW, attempts: 1 }).where(eq(outboxEvent.id, first.id)).returning(),
    );
    expect(updated[0]).toMatchObject({ publishedAt: NOW, attempts: 1 });
  });
});

describe("writeAudit", () => {
  it("drops secret keys from before/after at any depth", async () => {
    const id = randomUUID();
    await withTenant(t.runtimeDb, A, (tx) =>
      writeAudit(tx, {
        orgId: A,
        actorUserId: null,
        action: "staff.password_reset",
        entityType: "membership",
        entityId: id,
        before: { password: "old", name: "y" },
        after: { password: "x", name: "y", nested: { token: "t", token_hash: "h", tokenHash: "h2", secret: "s", keep: 1 } },
        occurredAt: NOW,
      }),
    );
    const [row] = await withPlatform(t.platformDb, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, id)));
    expect(row?.before).toEqual({ name: "y" });
    expect(row?.after).toEqual({ name: "y", nested: { keep: 1 } });
  });
});

describe("recordUsage", () => {
  it.each([1.5, Number.NaN])("rejects non-integer quantity %s", async (quantity) => {
    await expect(
      withTenant(t.runtimeDb, A, (tx) => recordUsage(tx, { orgId: A, kind: "x", quantity, unitCostSatang: null, occurredAt: NOW })),
    ).rejects.toThrow(TypeError);
  });

  it("rejects non-integer satang (money is integer satang)", async () => {
    await expect(
      withTenant(t.runtimeDb, A, (tx) => recordUsage(tx, { orgId: A, kind: "x", quantity: 1, unitCostSatang: 0.25, occurredAt: NOW })),
    ).rejects.toThrow(TypeError);
  });
});

describe("helpers accept a transaction only", () => {
  it("is enforced by the type system", () => {
    // @ts-expect-error — a plain Db client is not a transaction
    const _bad = () => writeAudit(t.runtimeDb, { orgId: A, actorUserId: null, action: "x", entityType: "x", entityId: A, occurredAt: NOW });
    expect(typeof _bad).toBe("function");
  });
});
