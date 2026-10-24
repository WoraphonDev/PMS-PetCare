import { randomUUID } from "node:crypto";
import { PlatformOrgDetail, PlatformPlanListResponse, SubscriptionGetResponse } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import {
  addMember,
  auditOf,
  branchesOf,
  call,
  expectError,
  holdSubscriptionLock,
  invitationWithToken,
  signedInAccount,
} from "../org/support";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import { insertPlan, PLATFORM_NOW, platformAdmin, subscribe } from "./support";

// docs/spec/features/foundation.md §18 #contract-platform-set-plan (T-0020-01 A) · #contract-platform-plan-list
// (T-0020-02 A) · #rule-branch-capacity · #rule-staff-check-and-lock · F05 · F10
let infra: TestInfra;
let app: NestFastifyApplication;
const NOW = PLATFORM_NOW;
const MULTI_STEP_TIMEOUT_MS = 30_000;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(NOW));
}, 180_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await infra?.stop();
});

type Res = Awaited<ReturnType<typeof call>>;
const STARTED = new Date("2031-01-02T03:04:05.678Z");
const admin = (stage?: "no-2fa" | "2fa-pending" | "verified") => platformAdmin(app, infra, stage);
const setPlan = (headers: Record<string, string>, orgId: string, body: unknown) =>
  call(app, "PUT", `/platform/orgs/${orgId}/subscription`, headers, body);
const subscriptionRow = async (orgId: string) =>
  (await infra.platformDb.query.subscription.findFirst({ where: (s, { eq }) => eq(s.orgId, orgId) }))!;
const planChanges = async (orgId: string) => (await auditOf(infra, orgId)).filter((r) => r.action === "platform.plan_changed");

/** A shop with an owner on plan `from`, optionally with a period end and a note. */
async function scene(from: Parameters<typeof insertPlan>[1] = {}, extra: Parameters<typeof subscribe>[3] = {}, branches = ["A"]) {
  const s = await seedOrg(app, infra, { role: "owner", branches });
  const current = await insertPlan(infra, from);
  await subscribe(infra, s.orgId, current.id, extra);
  return { ...s, current };
}

describe("platform.org.setPlan", () => {
  it("changes plan, period and note; started_at = now; one audit row without the note; the shop sees the new plan", async () => {
    const a = await admin();
    const s = await scene({}, { note: "old note" });
    const next = await insertPlan(infra, { name: "Business", maxBranches: 10, maxStaff: null, price: 99900 });
    const res = await setPlan(a.headers, s.orgId.toUpperCase(), {
      planCode: ` ${next.code} `,
      currentPeriodEnd: "2031-07-01T07:00:00+07:00",
      note: "  ลด 50%  ",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(PlatformOrgDetail.parse(res.json()).subscription).toEqual({
      plan: { code: next.code, name: "Business", maxBranches: 10, maxStaff: null, priceSatangPerMonth: 99900, isActive: true },
      startedAt: NOW.toISOString(),
      currentPeriodEnd: "2031-07-01T00:00:00.000Z",
      note: "ลด 50%",
    });
    expect(await subscriptionRow(s.orgId)).toMatchObject({
      planId: next.id,
      startedAt: NOW,
      currentPeriodEnd: new Date("2031-07-01T00:00:00Z"),
      note: "ลด 50%",
      updatedAt: NOW,
    });
    const changes = await planChanges(s.orgId);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      orgId: s.orgId,
      actorUserId: a.userId,
      before: { planCode: s.current.code, currentPeriodEnd: null },
      after: { planCode: next.code, currentPeriodEnd: "2031-07-01T00:00:00.000Z" },
      occurredAt: NOW,
    });
    expect(JSON.stringify(changes)).not.toContain("note");
    expect(JSON.stringify(changes)).not.toContain("ลด 50%");
    const seen = SubscriptionGetResponse.parse((await call(app, "GET", "/subscription", s.headers)).json());
    expect(seen.plan).toMatchObject({ code: next.code, maxBranches: 10 });
    // A detail answer is not a detail read.
    expect((await auditOf(infra, s.orgId)).map((r) => r.action)).toEqual(["platform.plan_changed"]);
  });

  it("period only: audits currentPeriodEnd alone and keeps started_at; omitted note becomes null", async () => {
    const a = await admin();
    const s = await scene({}, { currentPeriodEnd: new Date("2031-06-01T00:00:00Z"), note: "keep?" });
    const res = await setPlan(a.headers, s.orgId, { planCode: s.current.code, currentPeriodEnd: null });
    expect(res.statusCode, res.body).toBe(200);
    expect(await subscriptionRow(s.orgId)).toMatchObject({ planId: s.current.id, startedAt: STARTED, currentPeriodEnd: null, note: null });
    const changes = await planChanges(s.orgId);
    expect(changes.map((r) => [r.before, r.after])).toEqual([
      [{ currentPeriodEnd: "2031-06-01T00:00:00.000Z" }, { currentPeriodEnd: null }],
    ]);
  });

  it("note only: updates the note with no audit row; a past period end is accepted", async () => {
    const a = await admin();
    const s = await scene({}, { currentPeriodEnd: new Date("2020-01-01T00:00:00Z") });
    const res = await setPlan(a.headers, s.orgId, { planCode: s.current.code, currentPeriodEnd: "2020-01-01T00:00:00Z", note: "VIP" });
    expect(res.statusCode, res.body).toBe(200);
    expect(await subscriptionRow(s.orgId)).toMatchObject({ startedAt: STARTED, note: "VIP" });
    expect(await auditOf(infra, s.orgId)).toEqual([]);
  });

  it("no-op: 200 with the detail and nothing written (same instant in another offset counts as equal)", async () => {
    const a = await admin();
    const s = await scene({}, { currentPeriodEnd: new Date("2031-06-01T00:00:00Z"), note: "same" });
    const before = await subscriptionRow(s.orgId);
    const res = await setPlan(a.headers, s.orgId, {
      planCode: s.current.code,
      currentPeriodEnd: "2031-06-01T07:00:00+07:00",
      note: "same",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(PlatformOrgDetail.parse(res.json()).subscription.note).toBe("same");
    expect(await subscriptionRow(s.orgId)).toEqual(before);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
  });

  it(
    "downgrade below usage keeps branches, members and pending invitations; new additions → PLAN_LIMIT_REACHED; accept still works",
    async () => {
      const a = await admin();
      const s = await scene({ maxBranches: 5, maxStaff: 10 }, {}, ["A", "B"]);
      await addMember(app, infra, s.orgId, { role: "manager" });
      const invitee = await signedInAccount(app, infra);
      const pending = await invitationWithToken(infra, {
        orgId: s.orgId,
        email: invitee.email,
        role: "groomer",
        branchIds: s.branchIds,
        invitedByUserId: s.userId,
        expiresAt: new Date(NOW.getTime() + 86_400_000),
      });
      const small = await insertPlan(infra, { maxBranches: 1, maxStaff: 1, price: 0 });
      expect((await setPlan(a.headers, s.orgId, { planCode: small.code })).statusCode).toBe(200);

      expect(await branchesOf(infra, s.orgId)).toHaveLength(2);
      await expectError(await call(app, "POST", "/branches", s.headers, { name: "C" }), 402, "PLAN_LIMIT_REACHED");
      await expectError(
        await call(app, "POST", "/staff/invitations", s.headers, {
          email: `${randomUUID()}@example.com`,
          role: "groomer",
          branchIds: s.branchIds,
        }),
        402,
        "PLAN_LIMIT_REACHED",
      );
      const accepted = await call(app, "POST", "/invitations/accept", { cookie: invitee.cookie }, { token: pending.token });
      expect(accepted.statusCode, accepted.body).toBeLessThan(300);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it("unknown or inactive planCode → VALIDATION_FAILED at planCode; unknown shop → NOT_FOUND; malformed id or body → VALIDATION_FAILED", async () => {
    const a = await admin();
    const s = await scene();
    const inactive = await insertPlan(infra, { isActive: false });
    for (const planCode of [`missing_${randomUUID()}`, inactive.code]) {
      const error = await expectError(await setPlan(a.headers, s.orgId, { planCode }), 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields)).toEqual(["planCode"]);
    }
    await expectError(await setPlan(a.headers, randomUUID(), { planCode: s.current.code }), 404, "NOT_FOUND");
    await expectError(await setPlan(a.headers, randomUUID(), { planCode: inactive.code }), 404, "NOT_FOUND");
    await expectError(await setPlan(a.headers, "not-a-uuid", { planCode: s.current.code }), 400, "VALIDATION_FAILED");
    for (const body of [
      {},
      { planCode: s.current.code, currentPeriodEnd: "2031-02-31T00:00:00Z" },
      { planCode: s.current.code, extra: 1 },
    ]) {
      await expectError(await setPlan(a.headers, s.orgId, body), 400, "VALIDATION_FAILED");
    }
    expect((await subscriptionRow(s.orgId)).planId).toBe(s.current.id);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
  });

  it("a shop without a subscription fails closed with INTERNAL", async () => {
    const a = await admin();
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await expectError(await setPlan(a.headers, s.orgId, { planCode: (await insertPlan(infra)).code }), 500, "INTERNAL");
  });

  it("a failing audit write → INTERNAL and the subscription is unchanged", async () => {
    const a = await admin();
    const s = await scene();
    const before = await subscriptionRow(s.orgId);
    const next = await insertPlan(infra);
    const migrator = (q: string) => infra.db.migratorDb.$client.query(q);
    await migrator(
      "create function test_fail_plan_audit() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$",
    );
    await migrator("create trigger test_fail_plan_audit before insert on audit_log for each row execute function test_fail_plan_audit()");
    try {
      await expectError(await setPlan(a.headers, s.orgId, { planCode: next.code }), 500, "INTERNAL");
    } finally {
      await migrator("drop trigger test_fail_plan_audit on audit_log");
      await migrator("drop function test_fail_plan_audit()");
    }
    expect(await subscriptionRow(s.orgId)).toEqual(before);
  });
});

describe("platform.org.setPlan locking (#rule-branch-capacity: the same subscription row)", () => {
  /** Holds the subscription row, queues `first` then `second`, releases: Postgres grants the lock in arrival order. */
  async function ordered(orgId: string, first: () => Promise<Res>, second?: () => Promise<Res>): Promise<Res[]> {
    const lock = await holdSubscriptionLock(infra, orgId);
    const started: Promise<Res>[] = [];
    try {
      started.push(first());
      await lock.waiting(1);
      if (second) {
        started.push(second());
        await lock.waiting(2);
      }
    } finally {
      await lock.release();
    }
    return Promise.all(started);
  }

  it("a setPlan behind a held lock waits, then commits", async () => {
    const a = await admin();
    const s = await scene();
    const next = await insertPlan(infra);
    const lock = await holdSubscriptionLock(infra, s.orgId);
    let res: Promise<Res> | undefined;
    try {
      res = setPlan(a.headers, s.orgId, { planCode: next.code });
      await lock.waiting(1);
      expect((await subscriptionRow(s.orgId)).planId).toBe(s.current.id);
    } finally {
      await lock.release();
    }
    expect((await res!).statusCode).toBe(200);
    expect((await subscriptionRow(s.orgId)).planId).toBe(next.id);
  });

  for (const downgradeFirst of [true, false]) {
    it(`branch create racing a downgrade sees exactly one plan (${downgradeFirst ? "downgrade" : "create"} first)`, async () => {
      const a = await admin();
      const s = await scene({ maxBranches: 3 });
      const one = await insertPlan(infra, { maxBranches: 1 });
      const downgrade = () => setPlan(a.headers, s.orgId, { planCode: one.code });
      const create = () => call(app, "POST", "/branches", s.headers, { name: "Racer" });
      const [x, y] = await ordered(s.orgId, downgradeFirst ? downgrade : create, downgradeFirst ? create : downgrade);
      const [down, created] = downgradeFirst ? [x!, y!] : [y!, x!];
      expect(down.statusCode).toBe(200);
      if (downgradeFirst) {
        // The create locked under the new plan (1 branch max) — it never exceeds it.
        await expectError(created, 402, "PLAN_LIMIT_REACHED");
        expect(await branchesOf(infra, s.orgId)).toHaveLength(1);
      } else {
        expect(created.statusCode, created.body).toBe(201);
        expect(await branchesOf(infra, s.orgId)).toHaveLength(2);
      }
      expect((await subscriptionRow(s.orgId)).planId).toBe(one.id);
    });

    it(`staff invite racing a downgrade sees exactly one plan (${downgradeFirst ? "downgrade" : "invite"} first)`, async () => {
      const a = await admin();
      const s = await scene({ maxStaff: 5 });
      const one = await insertPlan(infra, { maxStaff: 1 });
      const downgrade = () => setPlan(a.headers, s.orgId, { planCode: one.code });
      const invite = () =>
        call(app, "POST", "/staff/invitations", s.headers, {
          email: `${randomUUID()}@example.com`,
          role: "groomer",
          branchIds: s.branchIds,
        });
      const [x, y] = await ordered(s.orgId, downgradeFirst ? downgrade : invite, downgradeFirst ? invite : downgrade);
      const [down, invited] = downgradeFirst ? [x!, y!] : [y!, x!];
      expect(down.statusCode).toBe(200);
      if (downgradeFirst) await expectError(invited, 402, "PLAN_LIMIT_REACHED");
      else expect(invited.statusCode, invited.body).toBe(201);
    });
  }

  it("two queued plan changes both commit, in arrival order, each audited against the plan before it", async () => {
    const a = await admin();
    const s = await scene();
    const [p1, p2] = [await insertPlan(infra), await insertPlan(infra)];
    const [r1, r2] = await ordered(
      s.orgId,
      () => setPlan(a.headers, s.orgId, { planCode: p1.code }),
      () => setPlan(a.headers, s.orgId, { planCode: p2.code }),
    );
    expect([r1!.statusCode, r2!.statusCode]).toEqual([200, 200]);
    expect((await subscriptionRow(s.orgId)).planId).toBe(p2.id);
    expect((await planChanges(s.orgId)).map((r) => [r.before, r.after])).toEqual([
      [{ planCode: s.current.code }, { planCode: p1.code }],
      [{ planCode: p1.code }, { planCode: p2.code }],
    ]);
  });
});

describe("platform.plan.list", () => {
  it("lists every plan by code, inactive ones marked", async () => {
    const a = await admin();
    const t = randomUUID().slice(0, 8);
    await insertPlan(infra, { code: `z_${t}`, name: "Zed", isActive: false, maxBranches: null, maxStaff: null, price: 0 });
    await insertPlan(infra, { code: `a_${t}`, name: "Aye", maxBranches: 2, maxStaff: 4, price: 12300 });
    const res = await call(app, "GET", "/platform/plans", a.headers);
    expect(res.statusCode, res.body).toBe(200);
    const { items } = PlatformPlanListResponse.parse(res.json());
    const codes = items.map((p) => p.code);
    expect(codes).toEqual([...codes].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    expect(items.find((p) => p.code === `a_${t}`)).toEqual({
      code: `a_${t}`,
      name: "Aye",
      maxBranches: 2,
      maxStaff: 4,
      priceSatangPerMonth: 12300,
      isActive: true,
    });
    expect(items.find((p) => p.code === `z_${t}`)).toMatchObject({ isActive: false, maxBranches: null, maxStaff: null });
  });
});

describe("platform access (setPlan, plan list)", () => {
  it(
    "no session → UNAUTHENTICATED, shop owner → FORBIDDEN, admin without 2FA proof → TWO_FACTOR_REQUIRED; nothing changes",
    async () => {
      const s = await scene();
      const next = await insertPlan(infra);
      const [noTwoFactor, pending] = [await admin("no-2fa"), await admin("2fa-pending")];
      const calls = [
        (h: Record<string, string>) => setPlan(h, s.orgId, { planCode: next.code }),
        (h: Record<string, string>) => call(app, "GET", "/platform/plans", h),
      ];
      for (const send of calls) {
        await expectError(await send({}), 401, "UNAUTHENTICATED");
        await expectError(await send(s.headers), 403, "FORBIDDEN");
        await expectError(await send(noTwoFactor.headers), 403, "TWO_FACTOR_REQUIRED");
        await expectError(await send(pending.headers), 403, "TWO_FACTOR_REQUIRED");
      }
      expect((await subscriptionRow(s.orgId)).planId).toBe(s.current.id);
      expect(await auditOf(infra, s.orgId)).toEqual([]);
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});
