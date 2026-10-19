import { randomUUID } from "node:crypto";
import { eq, type SQL, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  branch,
  branchClosure,
  branchHours,
  invitation,
  membership,
  membershipBranch,
  organization,
  outboxEvent,
  plan,
  seedPlans,
  subscription,
  usageEvent,
  user,
  withPlatform,
  withTenant,
} from "../src";
import { createTestDb, type TestDb } from "./support/test-db";

let t: TestDb;
const A = randomUUID();
const B = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();
let userId: string;
let memberA: string;
let memberB: string;
let planId: string;
const NOW = new Date("2026-10-20T03:00:00.000Z");

const one = <T>(rows: T[]): T => {
  const [row] = rows;
  if (!row) throw new Error("expected one row");
  return row;
};
const pg = (e: unknown) => (e as { cause?: { code?: string; constraint?: string } })?.cause ?? {};
const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(t.runtimeDb, A, fn);

beforeAll(async () => {
  t = await createTestDb();
  [{ id: userId }] = (await t.runtimeDb
    .insert(user)
    .values({ name: "Owner", email: `${randomUUID()}@example.com`, emailVerified: true, createdAt: NOW, updatedAt: NOW })
    .returning({ id: user.id })) as [{ id: string }];
  for (const [org, br] of [
    [A, branchA],
    [B, branchB],
  ] as const) {
    await withTenant(t.runtimeDb, org, async (tx) => {
      await tx.insert(organization).values({ id: org, slug: `org-${org.slice(0, 8)}`, displayName: "x" });
      await tx.insert(branch).values({ id: br, orgId: org, name: "main" });
    });
  }
  memberA = one(await inA((tx) => tx.insert(membership).values({ orgId: A, userId, role: "groomer", displayName: "G" }).returning())).id;
  memberB = one(
    await withTenant(t.runtimeDb, B, (tx) =>
      tx.insert(membership).values({ orgId: B, userId, role: "owner", displayName: "O" }).returning(),
    ),
  ).id;
  await withPlatform(t.platformDb, (tx) => seedPlans(tx));
  planId = one(await t.runtimeDb.select().from(plan).where(eq(plan.code, "mvp_free"))).id;
}, 120_000);

afterAll(async () => {
  await t?.stop();
});

describe("composite FKs keep branch / membership inside the row's organization (Q-0014)", () => {
  it.each([
    ["branch_hours", () => inA((tx) => tx.insert(branchHours).values({ orgId: A, branchId: branchB, weekday: 1 }))],
    [
      "branch_closure",
      () => inA((tx) => tx.insert(branchClosure).values({ orgId: A, branchId: branchB, startDate: "2026-12-31", endDate: "2026-12-31" })),
    ],
    [
      "membership_branch.branch",
      () => inA((tx) => tx.insert(membershipBranch).values({ orgId: A, membershipId: memberA, branchId: branchB })),
    ],
    [
      "membership_branch.membership",
      () => inA((tx) => tx.insert(membershipBranch).values({ orgId: A, membershipId: memberB, branchId: branchA })),
    ],
    [
      "outbox_event",
      () =>
        withPlatform(t.platformDb, (tx) =>
          tx.insert(outboxEvent).values({
            orgId: A,
            branchId: branchB,
            type: "x",
            aggregateType: "x",
            aggregateId: A,
            aggregateVersion: 1,
            payload: {},
            occurredAt: NOW,
          }),
        ),
    ],
    [
      "usage_event",
      () =>
        withPlatform(t.platformDb, (tx) =>
          tx.insert(usageEvent).values({ orgId: A, branchId: branchB, kind: "x", quantity: 1, occurredAt: NOW }),
        ),
    ],
  ])("%s rejects another organization's row", async (_name, insert) => {
    expect(pg(await insert().catch((e) => e))).toMatchObject({ code: "23503" });
  });

  it("outbox_event with a branch must have an organization", async () => {
    const res = await withPlatform(t.platformDb, (tx) =>
      tx.insert(outboxEvent).values({
        orgId: null,
        branchId: branchA,
        type: "x",
        aggregateType: "x",
        aggregateId: A,
        aggregateVersion: 1,
        payload: {},
        occurredAt: NOW,
      }),
    ).catch((e) => e);
    expect(pg(res)).toMatchObject({ code: "23514", constraint: "outbox_event_branch_needs_org" });
  });

  it("same-organization rows are accepted", async () => {
    await inA(async (tx) => {
      await tx.insert(membershipBranch).values({ orgId: A, membershipId: memberA, branchId: branchA });
      await tx.insert(branchHours).values({ orgId: A, branchId: branchA, weekday: 2, opensAt: "09:00", closesAt: "18:00" });
    });
  });
});

describe("CHECK constraints", () => {
  it.each([
    ["weekday 0", { weekday: 0 }, "branch_hours_weekday_iso"],
    ["weekday 8", { weekday: 8 }, "branch_hours_weekday_iso"],
    ["opens without closes", { weekday: 3, opensAt: "09:00" }, "branch_hours_open_close"],
    ["closes without opens", { weekday: 3, closesAt: "18:00" }, "branch_hours_open_close"],
    ["opens after closes", { weekday: 3, opensAt: "18:00", closesAt: "09:00" }, "branch_hours_open_close"],
    ["opens equals closes", { weekday: 3, opensAt: "09:00", closesAt: "09:00" }, "branch_hours_open_close"],
  ])("branch_hours rejects %s", async (_label, values, constraint) => {
    const res = await inA((tx) => tx.insert(branchHours).values({ orgId: A, branchId: branchA, ...values })).catch((e) => e);
    expect(pg(res)).toMatchObject({ code: "23514", constraint });
  });

  it("branch_hours accepts a closed day (both null)", async () => {
    await inA((tx) => tx.insert(branchHours).values({ orgId: A, branchId: branchA, weekday: 7 }));
  });

  it("branch_closure requires start_date <= end_date", async () => {
    const bad = await inA((tx) =>
      tx.insert(branchClosure).values({ orgId: A, branchId: branchA, startDate: "2026-12-31", endDate: "2026-12-30" }),
    ).catch((e) => e);
    expect(pg(bad)).toMatchObject({ code: "23514", constraint: "branch_closure_dates" });
    await inA((tx) => tx.insert(branchClosure).values({ orgId: A, branchId: branchA, startDate: "2026-12-31", endDate: "2026-12-31" }));
  });

  it("plan price is a non-negative integer number of satang", async () => {
    const res = await withPlatform(t.platformDb, (tx) =>
      tx.insert(plan).values({ code: "neg", name: "neg", priceSatangPerMonth: -1, isActive: false }),
    ).catch((e) => e);
    expect(pg(res)).toMatchObject({ code: "23514", constraint: "plan_price_non_negative" });
  });
});

describe("unique constraints", () => {
  it("membership (org_id, user_id)", async () => {
    const res = await inA((tx) => tx.insert(membership).values({ orgId: A, userId, role: "manager", displayName: "dup" })).catch((e) => e);
    expect(pg(res)).toMatchObject({ code: "23505" });
  });

  it("branch_hours (branch_id, weekday)", async () => {
    await inA((tx) => tx.insert(branchHours).values({ orgId: A, branchId: branchA, weekday: 4 }));
    const res = await inA((tx) => tx.insert(branchHours).values({ orgId: A, branchId: branchA, weekday: 4 })).catch((e) => e);
    expect(pg(res)).toMatchObject({ code: "23505" });
  });

  it("subscription (org_id)", async () => {
    await inA((tx) => tx.insert(subscription).values({ orgId: A, planId, startedAt: NOW }));
    const res = await inA((tx) => tx.insert(subscription).values({ orgId: A, planId, startedAt: NOW })).catch((e) => e);
    expect(pg(res)).toMatchObject({ code: "23505" });
  });
});

describe("RLS on the new tables", () => {
  it("organization B sees none of A's rows", async () => {
    await inA((tx) =>
      tx.insert(invitation).values({
        orgId: A,
        email: "staff@example.com",
        role: "front_desk",
        branchIds: [branchA],
        tokenHash: "h".repeat(64),
        expiresAt: NOW,
        invitedByUserId: userId,
      }),
    );
    const seen = await withTenant(t.runtimeDb, B, async (tx) => {
      const counts: Record<string, number> = {};
      for (const [name, table] of Object.entries({ branchHours, branchClosure, membershipBranch, invitation, subscription })) {
        counts[name] = (await tx.select().from(table)).length;
      }
      counts.membership = (await tx.select().from(membership).where(eq(membership.orgId, A))).length;
      return counts;
    });
    expect(seen).toEqual({ branchHours: 0, branchClosure: 0, membershipBranch: 0, invitation: 0, subscription: 0, membership: 0 });
  });
});

describe("plan", () => {
  it("is readable by the runtime role but not writable", async () => {
    expect((await t.runtimeDb.select().from(plan)).length).toBeGreaterThan(0);
    const stmts: SQL[] = [
      sql`insert into plan (code, name, price_satang_per_month, is_active) values ('x', 'x', 0, true)`,
      sql`update plan set price_satang_per_month = 1`,
      sql`delete from plan`,
    ];
    for (const stmt of stmts) expect(pg(await t.runtimeDb.execute(stmt).catch((e) => e))).toMatchObject({ code: "42501" });
  });

  it("seedPlans is idempotent and matches the spec", async () => {
    await withPlatform(t.platformDb, (tx) => seedPlans(tx));
    const rows = await t.runtimeDb.select().from(plan).where(eq(plan.code, "mvp_free"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: expect.any(String), maxBranches: 1, maxStaff: 5, priceSatangPerMonth: 0, isActive: true });
  });
});
