import { randomUUID } from "node:crypto";
import { branchHours, seedPlans, subscription, transactionQuery, user, withPlatform, withTenantTx } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Reuses @app/db's harness (roles, migrations, RLS) — test-only, not part of the package API.
import { createTestDb, type TestDb } from "../../../../packages/db/test/support/test-db";
import { bootstrapOrganization } from "../../src/modules/org";
import { startFreeSubscription } from "../../src/modules/subscription";

let t: TestDb;
const NOW = new Date("2026-10-21T03:00:00.000Z");

// Failure injection at an exact bootstrap stage: the trigger raises when `app.test_fail` names its table.
const INJECTION_SQL = `
  create function test_fail_stage() returns trigger language plpgsql as $$
  begin
    if current_setting('app.test_fail', true) = TG_TABLE_NAME then
      raise exception 'injected % failure', TG_TABLE_NAME;
    end if;
    return new;
  end $$;
  create trigger test_fail_branch before insert on branch for each row execute function test_fail_stage();
  create trigger test_fail_branch_hours before insert on branch_hours for each row execute function test_fail_stage();
`;

beforeAll(async () => {
  t = await createTestDb();
  await t.migratorDb.$client.query(INJECTION_SQL);
  await withPlatform(t.platformDb, seedPlans);
}, 180_000);

afterAll(async () => {
  await t?.stop();
});

async function createOwnerUser(): Promise<string> {
  const [row] = await withPlatform(t.platformDb, (tx) =>
    tx
      .insert(user)
      .values({ name: "เจ้าของร้าน", email: `${randomUUID()}@example.com` })
      .returning({ id: user.id }),
  );
  return row!.id;
}

/** Counts every bootstrap row of one organization on the BYPASSRLS connection, so rollback is observed from outside. */
async function counts(orgId: string) {
  return withPlatform(t.platformDb, async (tx) => ({
    organization: (await tx.query.organization.findMany({ where: (o, { eq }) => eq(o.id, orgId) })).length,
    branch: (await tx.query.branch.findMany({ where: (b, { eq }) => eq(b.orgId, orgId) })).length,
    branchHours: (await tx.query.branchHours.findMany({ where: (h, { eq }) => eq(h.orgId, orgId) })).length,
    membership: (await tx.query.membership.findMany({ where: (m, { eq }) => eq(m.orgId, orgId) })).length,
    subscription: (await tx.query.subscription.findMany({ where: (s, { eq }) => eq(s.orgId, orgId) })).length,
  }));
}

const ZERO = { organization: 0, branch: 0, branchHours: 0, membership: 0, subscription: 0 };

function input(ownerUserId: string, overrides: Partial<Parameters<typeof bootstrapOrganization>[1]> = {}) {
  return {
    slug: `shop-${randomUUID().slice(0, 8)}`,
    displayName: "ร้านทดสอบ",
    branchName: "สาขาหลัก",
    ownerUserId,
    ownerDisplayName: "เจ้าของ",
    ...overrides,
  };
}

describe("bootstrapOrganization + startFreeSubscription (one caller-owned transaction)", () => {
  it("commits organization, branch, 7 branch_hours rows, the owner membership and the free subscription", async () => {
    const orgId = randomUUID();
    const ownerUserId = await createOwnerUser();
    const values = input(ownerUserId);

    const result = await t.runtimeDb.transaction((tx) =>
      withTenantTx(tx, orgId, async (ctx) => {
        const org = await bootstrapOrganization(ctx, values);
        const sub = await startFreeSubscription(ctx, orgId, NOW);
        return { org, sub };
      }),
    );

    expect(result.org).toMatchObject({ orgId });
    expect(await counts(orgId)).toEqual({ organization: 1, branch: 1, branchHours: 7, membership: 1, subscription: 1 });

    const rows = await withPlatform(t.platformDb, async (tx) => ({
      org: await tx.query.organization.findMany({ where: (o, { eq }) => eq(o.id, orgId) }),
      branches: await tx.query.branch.findMany({ where: (b, { eq }) => eq(b.orgId, orgId) }),
      hours: await tx.query.branchHours.findMany({ where: (h, { eq }) => eq(h.orgId, orgId) }),
      members: await tx.query.membership.findMany({ where: (m, { eq }) => eq(m.orgId, orgId) }),
      memberBranches: await tx.query.membershipBranch.findMany({ where: (mb, { eq }) => eq(mb.orgId, orgId) }),
      subs: await tx.query.subscription.findMany({ where: (s, { eq }) => eq(s.orgId, orgId) }),
      freePlan: await tx.query.plan.findMany({ where: (p, { eq }) => eq(p.code, "mvp_free") }),
    }));

    expect(rows.org[0]).toMatchObject({ slug: values.slug, displayName: "ร้านทดสอบ", status: "active" });
    expect(rows.branches[0]).toMatchObject({ name: "สาขาหลัก", timezone: "Asia/Bangkok", isActive: true, id: result.org.branchId });
    expect(rows.hours.map((h) => h.weekday).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(rows.hours.map((h) => `${h.opensAt}-${h.closesAt}`))).toEqual(new Set(["09:00:00-18:00:00"]));
    expect(rows.hours.every((h) => h.branchId === result.org.branchId)).toBe(true);
    // F02: owner is organization-wide, so no membership_branch rows are invented.
    expect(rows.members[0]).toMatchObject({
      userId: ownerUserId,
      role: "owner",
      status: "active",
      displayName: "เจ้าของ",
      id: result.org.membershipId,
    });
    expect(rows.memberBranches).toEqual([]);
    expect(rows.subs[0]).toMatchObject({ planId: rows.freePlan[0]!.id, startedAt: NOW, currentPeriodEnd: null, note: null });
    expect(result.sub).toMatchObject({ planId: rows.freePlan[0]!.id, subscriptionId: rows.subs[0]!.id });
  });

  it("leaves no row behind when the organization insert conflicts on slug", async () => {
    const first = randomUUID();
    const ownerUserId = await createOwnerUser();
    const values = input(ownerUserId);
    await t.runtimeDb.transaction((tx) => withTenantTx(tx, first, (ctx) => bootstrapOrganization(ctx, values)));

    const orgId = randomUUID();
    const err = await t.runtimeDb
      .transaction((tx) =>
        withTenantTx(tx, orgId, async (ctx) => {
          const org = await bootstrapOrganization(ctx, { ...values, slug: values.slug });
          await startFreeSubscription(ctx, orgId, NOW);
          return org;
        }),
      )
      .catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "23505" });
    expect(await counts(orgId)).toEqual(ZERO);
  });

  it.each(["branch", "branch_hours"] as const)("rolls everything back when the %s insert fails", async (stage) => {
    const orgId = randomUUID();
    const ownerUserId = await createOwnerUser();
    const err = await t.runtimeDb
      .transaction(async (tx) => {
        await transactionQuery(tx)`select set_config('app.test_fail', ${stage}, true)`;
        return withTenantTx(tx, orgId, async (ctx) => {
          const org = await bootstrapOrganization(ctx, input(ownerUserId));
          await startFreeSubscription(ctx, orgId, NOW);
          return org;
        });
      })
      .catch((e) => e);
    expect(err?.cause).toMatchObject({ message: expect.stringContaining(`injected ${stage} failure`) });
    expect(await counts(orgId)).toEqual(ZERO);
  });

  it("rolls everything back when a duplicate weekday row violates the branch_hours unique index", async () => {
    const orgId = randomUUID();
    const ownerUserId = await createOwnerUser();
    const err = await t.runtimeDb
      .transaction((tx) =>
        withTenantTx(tx, orgId, async (ctx) => {
          const org = await bootstrapOrganization(ctx, input(ownerUserId));
          await ctx.tx.insert(branchHours).values({ orgId, branchId: org.branchId, weekday: 1, opensAt: "10:00:00", closesAt: "11:00:00" });
          return org;
        }),
      )
      .catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "23505", constraint: "branch_hours_branch_id_weekday_unique" });
    expect(await counts(orgId)).toEqual(ZERO);
  });

  it("rolls everything back when the owner membership violates the user foreign key", async () => {
    const orgId = randomUUID();
    const err = await t.runtimeDb
      .transaction((tx) =>
        withTenantTx(tx, orgId, async (ctx) => {
          const org = await bootstrapOrganization(ctx, input(randomUUID()));
          await startFreeSubscription(ctx, orgId, NOW);
          return org;
        }),
      )
      .catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "23503" });
    expect(await counts(orgId)).toEqual(ZERO);
  });

  it("rolls everything back when the subscription plan foreign key fails", async () => {
    const orgId = randomUUID();
    const ownerUserId = await createOwnerUser();
    const err = await t.runtimeDb
      .transaction((tx) =>
        withTenantTx(tx, orgId, async (ctx) => {
          await bootstrapOrganization(ctx, input(ownerUserId));
          await ctx.tx.insert(subscription).values({ orgId, planId: randomUUID(), startedAt: NOW });
        }),
      )
      .catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "23503" });
    expect(await counts(orgId)).toEqual(ZERO);
  });

  it("rolls everything back when the application throws after the subscription", async () => {
    const orgId = randomUUID();
    const ownerUserId = await createOwnerUser();
    const err = await t.runtimeDb
      .transaction((tx) =>
        withTenantTx(tx, orgId, async (ctx) => {
          await bootstrapOrganization(ctx, input(ownerUserId));
          await startFreeSubscription(ctx, orgId, NOW);
          throw new Error("post-bootstrap failure");
        }),
      )
      .catch((e) => e);
    expect(err.message).toBe("post-bootstrap failure");
    expect(await counts(orgId)).toEqual(ZERO);
  });

  it("cannot bootstrap without an organization context", async () => {
    const orgId = randomUUID();
    const ownerUserId = await createOwnerUser();
    const err = await t.runtimeDb.transaction((tx) => bootstrapOrganization({ tx, orgId }, input(ownerUserId))).catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
    expect(await counts(orgId)).toEqual(ZERO);
  });

  it("cannot bootstrap under another organization's context", async () => {
    const other = randomUUID();
    const orgId = randomUUID();
    const ownerUserId = await createOwnerUser();
    const err = await t.runtimeDb
      .transaction((tx) => withTenantTx(tx, other, (ctx) => bootstrapOrganization({ tx: ctx.tx, orgId }, input(ownerUserId))))
      .catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
    expect(await counts(orgId)).toEqual(ZERO);
  });

  it("fails closed on a connection that is not the runtime role", async () => {
    const orgId = randomUUID();
    const ownerUserId = await createOwnerUser();
    for (const db of [t.platformDb, t.migratorDb]) {
      const err = await db
        .transaction((tx) => withTenantTx(tx, orgId, (ctx) => bootstrapOrganization(ctx, input(ownerUserId))))
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/refusing to set the organization context/);
      expect(await counts(orgId)).toEqual(ZERO);
    }
  });

  it("does not expose another organization's bootstrap rows", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    for (const orgId of [a, b]) {
      const ownerUserId = await createOwnerUser();
      await t.runtimeDb.transaction((tx) =>
        withTenantTx(tx, orgId, async (ctx) => {
          await bootstrapOrganization(ctx, input(ownerUserId));
          await startFreeSubscription(ctx, orgId, NOW);
        }),
      );
    }
    const seen = await t.runtimeDb.transaction((tx) =>
      withTenantTx(tx, a, async (ctx) => ({
        orgs: await ctx.tx.query.organization.findMany(),
        branches: await ctx.tx.query.branch.findMany(),
        hours: await ctx.tx.query.branchHours.findMany(),
        members: await ctx.tx.query.membership.findMany(),
        subs: await ctx.tx.query.subscription.findMany(),
      })),
    );
    expect(seen.orgs.map((o) => o.id)).toEqual([a]);
    for (const rows of [seen.branches, seen.hours, seen.members, seen.subs]) {
      expect(new Set(rows.map((r) => r.orgId))).toEqual(new Set([a]));
    }
  });
});
