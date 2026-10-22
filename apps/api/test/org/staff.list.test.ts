import { StaffListResponse } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import { addManagedMember, addMember, call, expectError, expectGuardErrors, FIXED_NOW, insertInvitationRow } from "./support";

// docs/spec/features/foundation.md#contract-staff-list · #rule-F02 (front_desk is branch-scoped) · #tbl-identity
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

const list = (headers: Record<string, string>) => call(app, "GET", "/staff", headers);
const DAY = 24 * 60 * 60 * 1000;
const later = new Date(FIXED_NOW.getTime() + DAY);

async function loginAs(email: string, orgId: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifier: email, password: "correct-horse-1" } });
  const cookie = ([] as string[])
    .concat(res.headers["set-cookie"] ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, "x-org-id": orgId };
}

/**
 * Org with branches A, B, C. The seeded caller is front_desk on A and B. Members and invitations cover every visibility
 * rule of #contract-staff-list for a front_desk caller.
 */
async function fixture() {
  const caller = await seedOrg(app, infra, { role: "front_desk", branches: ["A", "B", "C"], assignedBranchIndexes: [0, 1] });
  const [A, B, C] = caller.branchIds as [string, string, string];
  const { orgId } = caller;
  const owner = await addMember(app, infra, orgId, { role: "owner", displayName: "Owner" });
  const manager = await addMember(app, infra, orgId, { role: "manager", displayName: "Manager" });
  const groomerAC = await addMember(app, infra, orgId, { role: "groomer", branchIds: [A, C], displayName: "Groomer AC" });
  const groomerC = await addMember(app, infra, orgId, { role: "groomer", branchIds: [C], displayName: "Groomer C" });
  const removed = await addMember(app, infra, orgId, { role: "groomer", branchIds: [A], status: "removed", displayName: "Removed" });
  const managed = await addManagedMember(infra, orgId, "caretaker", [B], `k.${orgId.slice(0, 8)}`);
  const by = owner.userId;
  const inv = (role: "groomer" | "caretaker" | "manager", branchIds: string[], state = {}, expiresAt = later, createdAt?: Date) =>
    insertInvitationRow(
      infra,
      {
        orgId,
        email: `${role}.${branchIds.length}.${Math.random()}@example.com`,
        role,
        branchIds,
        invitedByUserId: by,
        expiresAt,
        ...(createdAt ? { createdAt } : {}),
      },
      state,
    );
  const invBC = await inv("groomer", [B, C], {}, later, new Date("2031-05-02T00:00:00Z"));
  const invC = await inv("caretaker", [C], {}, later, new Date("2031-05-03T00:00:00Z"));
  const invManager = await inv("manager", [], {}, later, new Date("2031-05-04T00:00:00Z"));
  const expired = await inv("groomer", [A], {}, FIXED_NOW);
  const accepted = await inv("groomer", [A], { acceptedAt: FIXED_NOW });
  const revoked = await inv("groomer", [A], { revokedAt: FIXED_NOW });
  return { caller, A, B, C, owner, manager, groomerAC, groomerC, removed, managed, invBC, invC, invManager, expired, accepted, revoked };
}

describe("staff.list", () => {
  it("front_desk sees only its branches' staff, every owner/manager, intersected branchIds and overlapping branch-role invitations", async () => {
    const f = await fixture();
    const res = await list(f.caller.headers);
    expect(res.statusCode, res.body).toBe(200);
    const body = StaffListResponse.parse(res.json());
    expect(body.members.map((m) => [m.displayName, m.role, m.branchIds])).toEqual([
      ["Owner", "owner", []],
      ["Manager", "manager", []],
      ["Staff", "front_desk", [f.A, f.B].sort()],
      ["Groomer AC", "groomer", [f.A]],
      ["Managed", "caretaker", [f.B]],
    ]);
    expect(body.invitations.map((i) => [i.id, i.branchIds])).toEqual([[f.invBC, [f.B]]]);
    const all = JSON.stringify(body);
    for (const hidden of [f.C, f.groomerC.userId, f.removed.userId, f.invC, f.invManager, f.expired, f.accepted, f.revoked]) {
      expect(all).not.toContain(hidden);
    }
  });

  it("owner and manager see every active member and pending invitation with all branchIds, in the §14 order", async () => {
    const f = await fixture();
    for (const who of [f.owner, f.manager]) {
      const body = StaffListResponse.parse((await list(await loginAs(who.email, f.caller.orgId))).json());
      expect(body.members.map((m) => m.displayName)).toEqual(["Owner", "Manager", "Staff", "Groomer AC", "Groomer C", "Managed"]);
      expect(body.members.find((m) => m.displayName === "Groomer AC")!.branchIds).toEqual([f.A, f.C].sort());
      expect(body.invitations.map((i) => i.id)).toEqual([f.invManager, f.invC, f.invBC]);
      expect(body.invitations.find((i) => i.id === f.invBC)!.branchIds).toEqual([f.B, f.C]);
      expect(JSON.stringify(body)).not.toContain(f.removed.userId);
    }
  });

  it("returns the member fields; managed accounts show the username and email null, never the placeholder", async () => {
    const f = await fixture();
    const body = StaffListResponse.parse((await list(await loginAs(f.owner.email, f.caller.orgId))).json());
    expect(body.members.find((m) => m.displayName === "Owner")).toEqual({
      membershipId: f.owner.membershipId,
      userId: f.owner.userId,
      displayName: "Owner",
      email: f.owner.email,
      username: null,
      role: "owner",
      branchIds: [],
      status: "active",
      isManaged: false,
      twoFactorEnabled: false,
      createdAt: expect.any(String),
    });
    expect(body.members.find((m) => m.displayName === "Managed")).toMatchObject({
      email: null,
      username: `k.${f.caller.orgId.slice(0, 8)}`,
      isManaged: true,
    });
    expect(JSON.stringify(body)).not.toContain("managed.invalid");
  });

  it("denies groomer and caretaker and never shows another organization's rows", async () => {
    for (const role of ["groomer", "caretaker"] as const) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      await expectError(await list(s.headers), 403, "FORBIDDEN");
    }
    const f = await fixture();
    const other = await seedOrg(app, infra, { role: "owner", branches: ["X"] });
    const body = StaffListResponse.parse((await list(other.headers)).json());
    expect(body.members.map((m) => m.userId)).toEqual([other.userId]);
    expect(body.invitations).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(f.caller.orgId);
  });

  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "GET", "/staff");
  });
});
