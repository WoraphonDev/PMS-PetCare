import { randomUUID } from "node:crypto";
import { StaffListResponse } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import {
  auditOf,
  call,
  expectError,
  expectGuardErrors,
  expectNoBodyRule,
  FIXED_NOW,
  insertInvitationRow,
  invitationsOf,
  seedStaffPlan,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#contract-staff-invitation-revoke · #rule-staff-check-and-lock · ¹ · F07 ·
// #contract-branch-schedule-common (DELETE body/query rules)
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

const LATER = new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000);
const revoke = (headers: Record<string, string>, id: string) => call(app, "DELETE", `/staff/invitations/${id}`, headers);
async function shop(role: "owner" | "manager" = "owner") {
  const s = await seedOrg(app, infra, { role, branches: ["A"] });
  await seedStaffPlan(infra, s.orgId, 5);
  return s;
}
async function pending(
  s: { orgId: string; userId: string; branchIds: string[] },
  role: "owner" | "manager" | "groomer" = "groomer",
  state = {},
  expiresAt = LATER,
) {
  return insertInvitationRow(
    infra,
    {
      orgId: s.orgId,
      email: `${randomUUID()}@example.com`,
      role,
      branchIds: role === "groomer" ? s.branchIds : [],
      invitedByUserId: s.userId,
      expiresAt,
    },
    state,
  );
}
const rowOf = async (orgId: string, id: string) => (await invitationsOf(infra, orgId)).find((r) => r.id === id);

describe("staff.invitation.revoke", () => {
  it("revokes a pending invitation with 204: revoked_at = now, no audit, no longer listed", async () => {
    const s = await shop();
    const id = await pending(s);
    const res = await revoke(s.headers, id);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(await rowOf(s.orgId, id)).toMatchObject({ revokedAt: FIXED_NOW, updatedAt: FIXED_NOW, acceptedAt: null });
    expect(await auditOf(infra, s.orgId)).toEqual([]);
    const listed = StaffListResponse.parse((await call(app, "GET", "/staff", s.headers)).json());
    expect(listed.invitations).toEqual([]);
  });

  it("lets a manager revoke a branch-role invitation", async () => {
    const s = await shop("manager");
    expect((await revoke(s.headers, await pending(s))).statusCode).toBe(204);
  });

  it("answers NOT_FOUND for absent, other-org, accepted, revoked and expired invitations, changing nothing", async () => {
    const s = await shop();
    const other = await shop();
    const cases = [
      randomUUID(),
      await pending(other),
      await pending(s, "groomer", { acceptedAt: FIXED_NOW }),
      await pending(s, "groomer", { revokedAt: new Date("2031-05-01T00:00:00Z") }),
      await pending(s, "groomer", {}, FIXED_NOW),
    ];
    const before = [...(await invitationsOf(infra, s.orgId)), ...(await invitationsOf(infra, other.orgId))];
    for (const id of cases) await expectError(await revoke(s.headers, id), 404, "NOT_FOUND");
    expect([...(await invitationsOf(infra, s.orgId)), ...(await invitationsOf(infra, other.orgId))]).toEqual(before);
  });

  it("forbids a manager from revoking an owner/manager invitation; NOT_FOUND wins when it is no longer pending", async () => {
    const s = await shop("manager");
    for (const role of ["owner", "manager"] as const) {
      const id = await pending(s, role);
      const before = await rowOf(s.orgId, id);
      await expectError(await revoke(s.headers, id), 403, "FORBIDDEN");
      expect(await rowOf(s.orgId, id)).toEqual(before);
    }
    await expectError(await revoke(s.headers, await pending(s, "owner", { revokedAt: FIXED_NOW })), 404, "NOT_FOUND");
  });

  it("validates the id, denies roles without staff.invite and returns ORG_SUSPENDED", async () => {
    const s = await shop();
    const error = await expectError(await revoke(s.headers, "not-a-uuid"), 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: { invitationId: expect.any(Array) } });
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const member = await seedOrg(app, infra, { role, branches: ["A"] });
      await expectError(await revoke(member.headers, await pending(member)), 403, "FORBIDDEN");
    }
    const id = await pending(s);
    await suspend(infra, s.orgId);
    await expectError(await revoke(s.headers, id), 423, "ORG_SUSPENDED");
    expect(await rowOf(s.orgId, id)).toMatchObject({ revokedAt: null });
  });

  it("fails closed with INTERNAL when the organization has no subscription", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const id = await pending(s);
    await expectError(await revoke(s.headers, id), 500, "INTERNAL");
    expect(await rowOf(s.orgId, id)).toMatchObject({ revokedAt: null });
  });

  it("rejects query keys and request bodies like the other DELETE routes", async () => {
    const s = await shop();
    const error = await expectError(await revoke(s.headers, `${await pending(s)}?x=1`), 400, "VALIDATION_FAILED");
    expect(Object.keys((error.details as { fields: object }).fields)).toContain("x");
    await expectNoBodyRule(app, "DELETE", async () => `/staff/invitations/${await pending(s)}`, s.headers, 204);
  });

  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "DELETE", `/staff/invitations/${randomUUID()}`);
  });
});
