import { randomUUID } from "node:crypto";
import { AuditListResponse } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, call, expectError, expectGuardErrors, loginCookie, signedInAccount, suspend } from "../org/support";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

// docs/spec/features/foundation.md#contract-audit-list (T-0018-01 B, T-0018-02 A, T-0018-04 A) · #tbl-audit_log · F04 · F07
let infra: TestInfra;
let app: NestFastifyApplication;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

type Row = {
  orgId: string | null;
  actorUserId?: string | null;
  action?: string;
  occurredAt: Date;
  before?: object | null;
  after?: object | null;
  id?: string;
};
/** Audit rows written directly (platform connection) with full control of id and time. */
async function seedAudit(row: Row): Promise<string> {
  const { rows } = await infra.platformDb.$client.query<{ id: string }>(
    `insert into audit_log (id, org_id, actor_user_id, action, entity_type, entity_id, before, after, ip, user_agent, occurred_at)
     values ($1, $2, $3, $4, 'membership', $5, $6, $7, '10.0.0.1', 'secret-agent', $8) returning id`,
    [
      row.id ?? randomUUID(),
      row.orgId,
      row.actorUserId ?? null,
      row.action ?? "staff.invited",
      randomUUID(),
      row.before ?? null,
      row.after ?? null,
      row.occurredAt,
    ],
  );
  return rows[0]!.id;
}
const list = (headers: Record<string, string>, query = "") => call(app, "GET", `/audit-logs${query}`, headers);
async function page(headers: Record<string, string>, query = "") {
  const res = await list(headers, query);
  expect(res.statusCode, res.body).toBe(200);
  return AuditListResponse.parse(res.json());
}
const T = (iso: string) => new Date(iso);
const q = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

describe("order, paging and shape", () => {
  it("pages 120 rows (with equal timestamps) newest first, id desc, 50 per page, nothing repeated or skipped", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const ids: Array<{ id: string; at: Date }> = [];
    for (let i = 0; i < 120; i++) {
      const at = T(`2031-05-${String(1 + (i % 6)).padStart(2, "0")}T00:00:00Z`);
      ids.push({ id: await seedAudit({ orgId: s.orgId, occurredAt: at }), at });
    }
    const expected = ids.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).map((r) => r.id);

    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const p = await page(s.headers, cursor ? q({ cursor }) : "");
      sizes.push(p.items.length);
      seen.push(...p.items.map((it) => it.id));
      cursor = p.nextCursor;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen).toEqual(expected);
  });

  it("returns the item shape without ip and userAgent, and nextCursor null on the last page", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await seedAudit({
      orgId: s.orgId,
      actorUserId: s.userId,
      action: "staff.removed",
      occurredAt: T("2031-05-06T07:08:09.123Z"),
      before: { status: "active" },
      after: { status: "removed" },
    });
    const p = await page(s.headers);
    expect(p.nextCursor).toBeNull();
    expect(p.items).toEqual([
      {
        id: expect.any(String),
        occurredAt: "2031-05-06T07:08:09.123Z",
        action: "staff.removed",
        entityType: "membership",
        entityId: expect.any(String),
        actor: { userId: s.userId, displayName: "Staff" },
        before: { status: "active" },
        after: { status: "removed" },
      },
    ]);
    const raw = JSON.stringify((await list(s.headers)).json());
    expect(raw).not.toContain("10.0.0.1");
    expect(raw).not.toContain("secret-agent");
  });

  it("shows only this shop's rows: never another shop's, never platform rows (org_id null)", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const other = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const mine = await seedAudit({ orgId: s.orgId, occurredAt: T("2031-05-06T00:00:00Z") });
    await seedAudit({ orgId: other.orgId, occurredAt: T("2031-05-06T00:00:00Z") });
    await seedAudit({ orgId: null, occurredAt: T("2031-05-06T00:00:00Z"), action: "auth.password_reset" });
    expect((await page(s.headers)).items.map((i) => i.id)).toEqual([mine]);
  });
});

describe("actor display names", () => {
  it("active member → membership name; removed member → membership name; no membership → account name; system → null", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const active = await addMember(app, infra, s.orgId, { role: "groomer", branchIds: s.branchIds, displayName: "Mai (shop)" });
    const removed = await addMember(app, infra, s.orgId, {
      role: "groomer",
      branchIds: s.branchIds,
      displayName: "Gone (shop)",
      status: "removed",
    });
    await infra.platformDb.$client.query(`update "user" set name = 'Account name' where id = any($1)`, [[active.userId, removed.userId]]);
    const admin = await signedInAccount(app, infra, "Platform Admin");
    const rows = [
      [active.userId, "2031-05-04T00:00:00Z"],
      [removed.userId, "2031-05-03T00:00:00Z"],
      [admin.userId, "2031-05-02T00:00:00Z"],
      [null, "2031-05-01T00:00:00Z"],
    ] as const;
    for (const [actorUserId, at] of rows)
      await seedAudit({ orgId: s.orgId, actorUserId, occurredAt: T(at), action: "platform.org_status_changed" });
    expect((await page(s.headers)).items.map((i) => i.actor)).toEqual([
      { userId: active.userId, displayName: "Mai (shop)" },
      { userId: removed.userId, displayName: "Gone (shop)" },
      { userId: admin.userId, displayName: "Platform Admin" },
      null,
    ]);
  });
});

describe("filters", () => {
  it("filters by action, actor, from (inclusive) and to (exclusive), alone and combined", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const other = await addMember(app, infra, s.orgId, { role: "manager" });
    const at = (iso: string, action: string, actor: string) =>
      seedAudit({ orgId: s.orgId, occurredAt: T(iso), action, actorUserId: actor });
    const a = await at("2031-05-01T00:00:00Z", "staff.invited", s.userId);
    const b = await at("2031-05-02T00:00:00Z", "staff.removed", other.userId);
    const c = await at("2031-05-03T00:00:00Z", "staff.invited", other.userId);
    const d = await at("2031-05-04T00:00:00Z", "staff.removed", s.userId);
    const ids = async (params: Record<string, string>) => (await page(s.headers, q(params))).items.map((i) => i.id);

    expect(await ids({ action: "staff.invited" })).toEqual([c, a]);
    expect(await ids({ actorUserId: other.userId.toUpperCase() })).toEqual([c, b]);
    expect(await ids({ actorUserId: randomUUID() })).toEqual([]);
    expect(await ids({ from: "2031-05-02T00:00:00Z" })).toEqual([d, c, b]);
    expect(await ids({ to: "2031-05-03T00:00:00Z" })).toEqual([b, a]);
    expect(await ids({ from: "2031-05-02T00:00:00Z", to: "2031-05-04T00:00:00Z" })).toEqual([c, b]);
    expect(await ids({ from: "2031-05-02T07:00:00+07:00", to: "2031-05-03T00:00:00.001Z" })).toEqual([c, b]);
    expect(await ids({ action: "staff.removed", actorUserId: s.userId, from: "2031-05-01T00:00:00Z" })).toEqual([d]);
  });

  it("keeps the filters across pages with the cursor", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    for (let i = 0; i < 60; i++) {
      await seedAudit({ orgId: s.orgId, occurredAt: T("2031-05-02T00:00:00Z"), action: i % 2 ? "staff.removed" : "staff.invited" });
    }
    const first = await page(s.headers, q({ action: "staff.removed" }));
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toBeNull();
    const all = await page(s.headers);
    const second = await page(s.headers, q({ cursor: all.nextCursor!, action: "staff.invited" }));
    expect(second.items.every((i) => i.action === "staff.invited")).toBe(true);
  });
});

describe("errors", () => {
  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "GET", "/audit-logs");
  });

  it("allows only the owner: manager and branch roles → FORBIDDEN", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    for (const role of ["manager", "front_desk", "groomer", "caretaker"] as const) {
      const m = await addMember(app, infra, s.orgId, { role, branchIds: role === "manager" ? [] : s.branchIds });
      await expectError(await list({ cookie: await loginCookie(app, m.email), "x-org-id": s.orgId }), 403, "FORBIDDEN");
    }
  });

  it("works for a suspended shop (F04)", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const id = await seedAudit({ orgId: s.orgId, occurredAt: T("2031-05-06T00:00:00Z") });
    await suspend(infra, s.orgId);
    expect((await page(s.headers)).items.map((i) => i.id)).toEqual([id]);
  });

  it("rejects each bad query value with VALIDATION_FAILED at details.fields.<key>", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    for (const [query, field] of [
      ["?from=2031-05-06", "from"],
      ["?to=nope", "to"],
      ["?from=2031-05-06T00:00:00Z&to=2031-05-06T00:00:00Z", "to"],
      ["?from=2031-01-01T00:00:00Z&to=2032-01-02T00:00:00.001Z", "to"],
      ["?action=staff.updated", "action"],
      ["?action=staff.removed&action=org.updated", "action"],
      ["?actorUserId=x", "actorUserId"],
      ["?cursor=", "cursor"],
      ["?page=2", "page"],
    ] as const) {
      const error = await expectError(await list(s.headers, query), 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), query).toContain(field);
    }
  });

  it("rejects a malformed or tampered cursor, and another shop's cursor, at cursor", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const other = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    for (const orgId of [s.orgId, other.orgId])
      for (let i = 0; i < 51; i++) await seedAudit({ orgId, occurredAt: T("2031-05-06T00:00:00Z") });
    const cursor = (await page(s.headers)).nextCursor!;
    const foreign = (await page(other.headers)).nextCursor!;
    const flip = (c: string, at: number) => c.slice(0, at) + (c[at] === "A" ? "B" : "A") + c.slice(at + 1);
    for (const bad of ["not-a-cursor", flip(cursor, 3), flip(cursor, cursor.length - 2), `${cursor}x`, foreign]) {
      const error = await expectError(await list(s.headers, q({ cursor: bad })), 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields)).toEqual(["cursor"]);
    }
    expect((await list(s.headers, q({ cursor }))).statusCode).toBe(200);
  });
});

describe("index (T-0018-02)", () => {
  it("has audit_log (org_id, occurred_at desc, id desc)", async () => {
    const { rows } = await infra.platformDb.$client.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where tablename = 'audit_log' and indexname = 'audit_log_org_id_occurred_at_id_idx'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/\(org_id, occurred_at DESC NULLS LAST, id DESC NULLS LAST\)/);
  });
});
