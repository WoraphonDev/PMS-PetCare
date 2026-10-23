import { randomUUID } from "node:crypto";
import { SubscriptionGetResponse } from "@app/contracts";
import { withTenant } from "@app/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { countSeats } from "../../src/modules/org/staff.repository";
import { addMember, call, expectError, expectGuardErrors, FIXED_NOW, insertInvitationRow, loginCookie, suspend } from "../org/support";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

// docs/spec/features/foundation.md#contract-subscription-get (T-0018-03 A) · #rule-branch-capacity · #rule-staff-capacity
let infra: TestInfra;
let app: NestFastifyApplication;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(FIXED_NOW));
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

const get = (headers: Record<string, string>) => call(app, "GET", "/subscription", headers);
async function plan(fields: { maxBranches: number | null; maxStaff: number | null; isActive?: boolean }) {
  const code = `test_${randomUUID()}`;
  const { rows } = await infra.platformDb.$client.query<{ id: string }>(
    "insert into plan (code, name, max_branches, max_staff, price_satang_per_month, is_active) values ($1, 'Pro plan', $2, $3, 49900, $4) returning id",
    [code, fields.maxBranches, fields.maxStaff, fields.isActive ?? true],
  );
  return { id: rows[0]!.id, code };
}
async function subscribe(orgId: string, planId: string, currentPeriodEnd: Date | null = null) {
  await infra.platformDb.$client.query(
    "insert into subscription (org_id, plan_id, started_at, current_period_end, note) values ($1, $2, $3, $4, 'internal note')",
    [orgId, planId, new Date("2031-01-02T03:04:05.678Z"), currentPeriodEnd],
  );
}

describe("subscription.get", () => {
  it("returns plan, period and usage counted like the limits, for owner and manager; no note, no plan isActive", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A", "B"] });
    const p = await plan({ maxBranches: 3, maxStaff: 10, isActive: false });
    await subscribe(s.orgId, p.id, new Date("2031-06-01T00:00:00Z"));
    await infra.platformDb.$client.query("update branch set is_active = false where id = $1", [s.branchIds[1]]);
    const manager = await addMember(app, infra, s.orgId, { role: "manager" });
    await addMember(app, infra, s.orgId, { role: "groomer", branchIds: s.branchIds, status: "removed" });
    await infra.platformDb.$client.query(
      `insert into "user" (id, name, email, username, is_managed, managed_by_org_id) values ($1, 'M', $2, $3, true, $4)`,
      [randomUUID(), `${randomUUID()}@managed.invalid`, `m.${randomUUID().slice(0, 8)}`, s.orgId],
    );
    const managedId = (
      await infra.platformDb.$client.query<{ id: string }>(`select id from "user" where managed_by_org_id = $1`, [s.orgId])
    ).rows[0]!.id;
    await infra.platformDb.$client.query("insert into membership (org_id, user_id, role, display_name) values ($1, $2, 'caretaker', 'M')", [
      s.orgId,
      managedId,
    ]);
    const invite = (expiresAt: Date, state = {}) =>
      insertInvitationRow(
        infra,
        { orgId: s.orgId, email: `${randomUUID()}@example.com`, role: "groomer", invitedByUserId: s.userId, expiresAt },
        state,
      );
    await invite(new Date("2031-05-10T00:00:00Z"));
    await invite(new Date("2031-05-10T00:00:00Z"));
    await invite(FIXED_NOW);
    await invite(new Date("2031-05-10T00:00:00Z"), { revokedAt: FIXED_NOW });
    await invite(new Date("2031-05-10T00:00:00Z"), { acceptedAt: FIXED_NOW });

    const expected = {
      plan: { code: p.code, name: "Pro plan", maxBranches: 3, maxStaff: 10, priceSatangPerMonth: 49900 },
      startedAt: "2031-01-02T03:04:05.678Z",
      currentPeriodEnd: "2031-06-01T00:00:00.000Z",
      // owner + manager + managed caretaker; 2 unexpired pending invitations; 2 branches incl. the inactive one.
      usage: { branches: 2, staff: { active: 3, pendingInvitations: 2, total: 5 } },
    };
    for (const headers of [s.headers, { cookie: await loginCookie(app, manager.email), "x-org-id": s.orgId }]) {
      const res = await get(headers);
      expect(res.statusCode, res.body).toBe(200);
      expect(SubscriptionGetResponse.parse(res.json())).toEqual(expected);
      expect(res.body).not.toContain("internal note");
      expect(res.body).not.toContain("isActive");
    }
    const seats = await withTenant(infra.runtimeDb, s.orgId, (tx) => countSeats(tx, FIXED_NOW, ""));
    expect(seats).toBe(expected.usage.staff.total);
  });

  it("returns null limits and a null period end as they are", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const p = await plan({ maxBranches: null, maxStaff: null });
    await subscribe(s.orgId, p.id);
    const body = SubscriptionGetResponse.parse((await get(s.headers)).json());
    expect(body.plan).toMatchObject({ maxBranches: null, maxStaff: null });
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.usage).toEqual({ branches: 1, staff: { active: 1, pendingInvitations: 0, total: 1 } });
  });

  it("works for a suspended shop (F04)", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await subscribe(s.orgId, (await plan({ maxBranches: 1, maxStaff: 1 })).id);
    await suspend(infra, s.orgId);
    expect((await get(s.headers)).statusCode).toBe(200);
  });

  it("fails closed with INTERNAL when the shop has no subscription", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await expectError(await get(s.headers), 500, "INTERNAL");
  });

  it("denies branch roles, and applies the org-scoped guard errors", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await subscribe(s.orgId, (await plan({ maxBranches: 1, maxStaff: 5 })).id);
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const m = await addMember(app, infra, s.orgId, { role, branchIds: s.branchIds });
      await expectError(await get({ cookie: await loginCookie(app, m.email), "x-org-id": s.orgId }), 403, "FORBIDDEN");
    }
    await expectGuardErrors(app, infra, "GET", "/subscription");
  });
});
