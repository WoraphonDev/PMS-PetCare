import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  AuditListResponse,
  Organization,
  PLATFORM_ORG_PAGE_SIZE,
  PlatformOrgDetail,
  PlatformOrgListResponse,
  type PlatformOrgSummary,
} from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { addManagedMember, addMember, auditOf, call, expectError, insertInvitationRow, orgOf, suspend } from "../org/support";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import { insertPlan, PLATFORM_NOW, platformAdmin, subscribe as subscribeTo } from "./support";

// docs/spec/features/foundation.md §18 #rule-platform-module · #contract-platform-org-read (T-0019-01 B)
// · #contract-platform-org-status (T-0019-02 A) · platform.org_viewed (T-0019-03 B, T-0019-04 A) · F04 · F10
let infra: TestInfra;
let app: NestFastifyApplication;
// The 2FA proof of a session expires with the real session, so the injected clock stays near real time.
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

const sql = <R extends Record<string, unknown> = Record<string, unknown>>(q: string, values: unknown[] = []) =>
  infra.platformDb.$client.query<R>(q, values);
const admin = (stage?: "no-2fa" | "2fa-pending" | "verified") => platformAdmin(app, infra, stage);
const plan = (fields?: Parameters<typeof insertPlan>[1]) => insertPlan(infra, fields);
const subscribe = (orgId: string, planId?: string, extra?: Parameters<typeof subscribeTo>[3]) => subscribeTo(infra, orgId, planId, extra);
/** A shop with a signed-in owner and a subscription. */
async function shop(branches: readonly string[] = ["A"]) {
  const s = await seedOrg(app, infra, { role: "owner", branches });
  await subscribe(s.orgId);
  return s;
}
/** A shop row with no members (list fixtures), created at `createdAt`. */
async function bareShop(fields: { slug: string; displayName?: string; createdAt: Date | string; id?: string }) {
  const id = fields.id ?? randomUUID();
  await sql("insert into organization (id, slug, display_name, created_at, updated_at) values ($1, $2, $3, $4, $4)", [
    id,
    fields.slug,
    fields.displayName ?? "Bare shop",
    fields.createdAt,
  ]);
  await subscribe(id);
  return id;
}
const token = () => randomUUID().replaceAll("-", "").slice(0, 10);
const list = (headers: Record<string, string>, query = "") => call(app, "GET", `/platform/orgs${query}`, headers);
const detail = (headers: Record<string, string>, orgId: string) => call(app, "GET", `/platform/orgs/${orgId}`, headers);
const setStatus = (headers: Record<string, string>, orgId: string, body: unknown) =>
  call(app, "PUT", `/platform/orgs/${orgId}/status`, headers, body);
const ids = (res: { json(): unknown }) => PlatformOrgListResponse.parse(res.json()).items.map((i) => i.id);
const viewedRows = async (actorUserId: string) =>
  (await sql("select * from audit_log where action = 'platform.org_viewed' and actor_user_id = $1", [actorUserId])).rows;

describe("platform.org.list", () => {
  it(
    "matches q case-insensitively in slug, displayName or an active owner's email; status filters; newest first",
    async () => {
      const a = await admin();
      const t = token();
      const bySlug = await bareShop({ slug: `slug-${t}`, createdAt: new Date("2031-01-01T00:00:00Z") });
      const byName = await bareShop({
        slug: `n-${token()}`,
        displayName: `ร้าน ${t.toUpperCase()} สาขา`,
        createdAt: new Date("2031-01-03T00:00:00Z"),
      });
      const byOwner = await shop();
      await addMember(app, infra, byOwner.orgId, { role: "owner", email: `Owner.${t}@Example.com` });
      const removedOwner = await shop();
      await addMember(app, infra, removedOwner.orgId, { role: "owner", status: "removed", email: `gone.${t}@example.com` });
      const manager = await shop();
      await addMember(app, infra, manager.orgId, { role: "manager", email: `mgr.${t}@example.com` });
      const managedOwner = await shop();
      // A managed owner's placeholder `<id>@managed.invalid` is never matched, even by a query that names it.
      const managed = await addManagedMember(infra, managedOwner.orgId, "owner", [], `m.${token()}`);

      const res = await list(a.headers, `?q=${encodeURIComponent(`  ${t.toUpperCase()} `)}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(ids(res)).toEqual([byName, bySlug, byOwner.orgId]);
      expect(ids(await list(a.headers, `?q=${managed.userId}`))).toEqual([]);
      expect(ids(await list(a.headers, "?q=managed.invalid"))).toEqual([]);

      await suspend(infra, byName);
      expect(ids(await list(a.headers, `?q=${t}&status=suspended`))).toEqual([byName]);
      expect(ids(await list(a.headers, `?q=${t}&status=active`))).toEqual([bySlug, byOwner.orgId]);
      const all = PlatformOrgListResponse.parse((await list(a.headers, "?status=suspended")).json());
      expect(all.items.every((i) => i.status === "suspended")).toBe(true);
      expect(all.items.map((i) => i.id)).toContain(byName);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "pages 50 at a time, createdAt desc then id desc, stable across equal createdAt",
    async () => {
      const a = await admin();
      const t = token();
      // Microseconds matter: a JS Date would round the tie to .123 and the cursor would skip or repeat rows.
      const tie = "2030-06-01T00:00:00.123456Z";
      const created: Array<{ id: string; at: string }> = [];
      for (let i = 0; i < 53; i++) {
        const at = i < 45 ? tie : `2030-06-0${2 + (i % 3)}T00:00:00.000000Z`;
        created.push({ id: await bareShop({ slug: `page-${t}-${i}`, createdAt: at }), at });
      }
      const expected = [...created].sort((x, y) => (x.at === y.at ? (x.id < y.id ? 1 : -1) : x.at < y.at ? 1 : -1)).map((c) => c.id);
      const first = PlatformOrgListResponse.parse((await list(a.headers, `?q=page-${t}`)).json());
      expect(first.items).toHaveLength(PLATFORM_ORG_PAGE_SIZE);
      expect(first.nextCursor).not.toBeNull();
      const next = await list(a.headers, `?q=page-${t}&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(next.statusCode, `${next.body} ${Buffer.from(first.nextCursor!, "base64url").toString()}`).toBe(200);
      const second = PlatformOrgListResponse.parse(next.json());
      expect(second.nextCursor).toBeNull();
      expect([...first.items, ...second.items].map((i) => i.id)).toEqual(expected);
      expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(53);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "summary has the plan and usage counted like the limit rules",
    async () => {
      const a = await admin();
      const s = await seedOrg(app, infra, { role: "owner", branches: ["A", "B"] });
      const p = await plan({ name: "Usage plan" });
      await subscribe(s.orgId, p.id);
      const t = token();
      await sql("update organization set slug = $2 where id = $1", [s.orgId, `usage-${t}`]);
      await sql("update branch set is_active = false where id = $1", [s.branchIds[1]]);
      await addMember(app, infra, s.orgId, { role: "manager" });
      await addMember(app, infra, s.orgId, { role: "groomer", branchIds: s.branchIds, status: "removed" });
      await addManagedMember(infra, s.orgId, "caretaker", [s.branchIds[0]!], `c.${token()}`);
      const invite = (expiresAt: Date, state = {}) =>
        insertInvitationRow(
          infra,
          { orgId: s.orgId, email: `${randomUUID()}@example.com`, role: "groomer", invitedByUserId: s.userId, expiresAt },
          state,
        );
      const later = new Date(NOW.getTime() + 86_400_000);
      await invite(later);
      await invite(NOW); // expires_at = now → not pending
      await invite(later, { revokedAt: NOW });
      await invite(later, { acceptedAt: NOW });

      const [item] = PlatformOrgListResponse.parse((await list(a.headers, `?q=usage-${t}`)).json()).items;
      expect(item).toEqual<PlatformOrgSummary>({
        id: s.orgId,
        slug: `usage-${t}`,
        displayName: "Test shop",
        status: "active",
        plan: { code: p.code, name: "Usage plan" },
        // owner + manager + managed caretaker + 1 pending invitation; both branches incl. the inactive one.
        usage: { branches: 2, staff: 4 },
        createdAt: (await orgOf(infra, s.orgId))!.createdAt.toISOString(),
      });
      const d = PlatformOrgDetail.parse((await detail(a.headers, s.orgId)).json());
      expect(d.usage).toEqual({ branches: 2, staff: { active: 3, pendingInvitations: 1, total: 4 } });
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "is not changed by another admin's detail read and status no-op, and writes no audit",
    async () => {
      const [a, b] = [await admin(), await admin()];
      const s = await shop();
      const t = token();
      await sql("update organization set slug = $2 where id = $1", [s.orgId, `quiet-${t}`]);
      const before = (await list(a.headers, `?q=quiet-${t}`)).json();
      expect((await detail(b.headers, s.orgId)).statusCode).toBe(200);
      expect((await setStatus(b.headers, s.orgId, { status: "active", reason: "check" })).statusCode).toBe(200);
      expect((await list(a.headers, `?q=quiet-${t}`)).json()).toEqual(before);
      expect(await viewedRows(a.userId)).toEqual([]);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "rejects bad query values and unknown keys with VALIDATION_FAILED at the field",
    async () => {
      const a = await admin();
      for (const [query, field] of [
        ["?q=", "q"],
        ["?q=%20%20", "q"],
        [`?q=${"a".repeat(101)}`, "q"],
        ["?q=a&q=b", "q"],
        ["?status=closed", "status"],
        ["?cursor=", "cursor"],
        ["?cursor=not-a-cursor", "cursor"],
        [`?cursor=${Buffer.from(JSON.stringify(["2031-01-01", "x"])).toString("base64url")}`, "cursor"],
        // Shaped like Postgres' text but not a real instant: Postgres would refuse the cast (never INTERNAL).
        ...[
          "2031-02-31 00:00:00+00",
          "2030-02-29 00:00:00+00",
          "2031-13-01 00:00:00+00",
          "2031-05-06 24:00:00+00",
          "2031-05-06 00:60:00+00",
          "0000-01-01 00:00:00+00",
          "2031-05-06 00:00:00+16",
        ].map((at) => [`?cursor=${Buffer.from(JSON.stringify([at, randomUUID()])).toString("base64url")}`, "cursor"] as const),
        ["?limit=10", "limit"],
        ["?orgId=x", "orgId"],
      ] as const) {
        const error = await expectError(await list(a.headers, query), 400, "VALIDATION_FAILED");
        expect(Object.keys((error.details as { fields: object }).fields), query).toEqual([field]);
      }
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("platform.org.get", () => {
  it(
    "returns organization, subscription with note, usage and active owners; audits one platform.org_viewed per read",
    async () => {
      const a = await admin();
      const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
      const p = await plan({ name: "Detail plan", maxBranches: null, maxStaff: 7, isActive: false });
      await subscribe(s.orgId, p.id, { currentPeriodEnd: new Date("2031-06-01T00:00:00Z"), note: "ลดราคา 50%" });
      const second = await addMember(app, infra, s.orgId, { role: "owner", displayName: "Second owner" });
      await addMember(app, infra, s.orgId, { role: "owner", status: "removed" });
      await addMember(app, infra, s.orgId, { role: "manager" });
      const username = `owner.${token()}`;
      const managed = await addManagedMember(infra, s.orgId, "owner", [], username);
      const ownerEmail = (await sql<{ email: string }>('select email from "user" where id = $1', [s.userId])).rows[0]!.email;

      const res = await detail(a.headers, s.orgId.toUpperCase());
      expect(res.statusCode, res.body).toBe(200);
      const body = PlatformOrgDetail.parse(res.json());
      expect(body.organization).toEqual(Organization.parse((await call(app, "GET", "/org", s.headers)).json()));
      expect(body.subscription).toEqual({
        plan: { code: p.code, name: "Detail plan", maxBranches: null, maxStaff: 7, priceSatangPerMonth: 49900, isActive: false },
        startedAt: "2031-01-02T03:04:05.678Z",
        currentPeriodEnd: "2031-06-01T00:00:00.000Z",
        note: "ลดราคา 50%",
      });
      expect(body.usage).toEqual({ branches: 1, staff: { active: 4, pendingInvitations: 0, total: 4 } });
      expect([...body.owners].sort((x, y) => (x.userId < y.userId ? -1 : 1))).toEqual(
        [
          { userId: s.userId, displayName: "Staff", email: ownerEmail, username: null },
          { userId: second.userId, displayName: "Second owner", email: second.email, username: null },
          { userId: managed.userId, displayName: "Managed", email: null, username },
        ].sort((x, y) => (x.userId < y.userId ? -1 : 1)),
      );
      expect(res.body).not.toContain("managed.invalid");

      await detail(a.headers, s.orgId);
      const viewed = await viewedRows(a.userId);
      expect(viewed).toHaveLength(2);
      for (const row of viewed) {
        expect(row).toMatchObject({
          org_id: s.orgId,
          actor_user_id: a.userId,
          entity_type: "organization",
          entity_id: s.orgId,
          before: null,
          after: null,
        });
        expect(new Date(row.occurred_at as string)).toEqual(NOW);
      }

      // The shop's owner sees the reads in its audit log; another shop's owner does not.
      const own = AuditListResponse.parse((await call(app, "GET", "/audit-logs?action=platform.org_viewed", s.headers)).json());
      expect(own.items.map((i) => [i.action, i.actor?.userId, i.actor?.displayName, i.entityId])).toEqual([
        ["platform.org_viewed", a.userId, "Platform admin", s.orgId],
        ["platform.org_viewed", a.userId, "Platform admin", s.orgId],
      ]);
      const other = await shop();
      const theirs = AuditListResponse.parse((await call(app, "GET", "/audit-logs?action=platform.org_viewed", other.headers)).json());
      expect(theirs.items).toEqual([]);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "unknown id → NOT_FOUND and malformed id → VALIDATION_FAILED, writing no audit row",
    async () => {
      const a = await admin();
      await expectError(await detail(a.headers, randomUUID()), 404, "NOT_FOUND");
      await expectError(await detail(a.headers, "not-a-uuid"), 400, "VALIDATION_FAILED");
      expect(await viewedRows(a.userId)).toEqual([]);
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("platform.org.setStatus", () => {
  it(
    "suspend blocks the shop's writes but not reads; reactivate restores them; one audit row per change, visible to the owner",
    async () => {
      const a = await admin();
      const s = await shop();
      const updatedBefore = (await orgOf(infra, s.orgId))!.updatedAt;
      const suspended = await setStatus(a.headers, s.orgId, { status: "suspended", reason: "  ค้างชำระ 2 เดือน  " });
      expect(suspended.statusCode, suspended.body).toBe(200);
      const body = PlatformOrgDetail.parse(suspended.json());
      expect(body.organization).toMatchObject({ id: s.orgId, status: "suspended", updatedAt: NOW.toISOString() });
      expect(updatedBefore).not.toEqual(NOW);
      // setStatus answers with the detail but is not a detail read.
      expect(await viewedRows(a.userId)).toEqual([]);

      await expectError(await call(app, "PATCH", "/org", s.headers, { displayName: "New name" }), 423, "ORG_SUSPENDED");
      expect((await call(app, "GET", "/org", s.headers)).statusCode).toBe(200);

      // A suspended shop does not block platform.* writes (F04).
      const reactivated = await setStatus(a.headers, s.orgId, { status: "active", reason: "ชำระแล้ว" });
      expect(reactivated.statusCode, reactivated.body).toBe(200);
      expect(PlatformOrgDetail.parse(reactivated.json()).organization.status).toBe("active");
      expect((await call(app, "PATCH", "/org", s.headers, { displayName: "New name" })).statusCode).toBe(200);

      const changes = (await auditOf(infra, s.orgId)).filter((r) => r.action === "platform.org_status_changed");
      const row = {
        orgId: s.orgId,
        actorUserId: a.userId,
        entityType: "organization",
        entityId: s.orgId,
        ip: null,
        userAgent: null,
        occurredAt: NOW,
      };
      expect(changes).toMatchObject([
        { ...row, before: { status: "active" }, after: { status: "suspended", reason: "ค้างชำระ 2 เดือน" } },
        { ...row, before: { status: "suspended" }, after: { status: "active", reason: "ชำระแล้ว" } },
      ]);
      const seen = AuditListResponse.parse((await call(app, "GET", "/audit-logs?action=platform.org_status_changed", s.headers)).json());
      // Both rows share the mocked occurredAt, so audit.list orders them by id: compare as a set.
      expect(seen.items.map((i) => i.after)).toHaveLength(2);
      expect(seen.items.map((i) => i.after)).toEqual(
        expect.arrayContaining([
          { status: "active", reason: "ชำระแล้ว" },
          { status: "suspended", reason: "ค้างชำระ 2 เดือน" },
        ]),
      );
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "an unchanged status answers 200 with the detail and writes nothing",
    async () => {
      const a = await admin();
      const s = await shop();
      const before = await orgOf(infra, s.orgId);
      const res = await setStatus(a.headers, s.orgId, { status: "active", reason: "no change" });
      expect(res.statusCode, res.body).toBe(200);
      expect(PlatformOrgDetail.parse(res.json()).organization.status).toBe("active");
      expect(await orgOf(infra, s.orgId)).toEqual(before);
      expect(await auditOf(infra, s.orgId)).toEqual([]);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "validates the body and the id; unknown shop → NOT_FOUND; nothing changes",
    async () => {
      const a = await admin();
      const s = await shop();
      for (const [body, field] of [
        [{ status: "suspended" }, "reason"],
        [{ status: "suspended", reason: "   " }, "reason"],
        [{ status: "suspended", reason: "a".repeat(501) }, "reason"],
        [{ reason: "x" }, "status"],
        [{ status: "closed", reason: "x" }, "status"],
        [{ status: "suspended", reason: "x", note: "y" }, "note"],
      ] as const) {
        const error = await expectError(await setStatus(a.headers, s.orgId, body), 400, "VALIDATION_FAILED");
        expect(Object.keys((error.details as { fields: object }).fields), JSON.stringify(body)).toEqual([field]);
      }
      await expectError(await setStatus(a.headers, "not-a-uuid", { status: "suspended", reason: "x" }), 400, "VALIDATION_FAILED");
      await expectError(await setStatus(a.headers, randomUUID(), { status: "suspended", reason: "x" }), 404, "NOT_FOUND");
      expect((await orgOf(infra, s.orgId))!.status).toBe("active");
      expect(await auditOf(infra, s.orgId)).toEqual([]);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "a failing audit write → INTERNAL and the status is unchanged",
    async () => {
      const a = await admin();
      const s = await shop();
      const migrator = (q: string) => infra.db.migratorDb.$client.query(q);
      await migrator(
        "create function test_fail_platform_audit() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$",
      );
      await migrator(
        "create trigger test_fail_platform_audit before insert on audit_log for each row execute function test_fail_platform_audit()",
      );
      try {
        await expectError(await setStatus(a.headers, s.orgId, { status: "suspended", reason: "x" }), 500, "INTERNAL");
        await expectError(await detail(a.headers, s.orgId), 500, "INTERNAL");
      } finally {
        await migrator("drop trigger test_fail_platform_audit on audit_log");
        await migrator("drop function test_fail_platform_audit()");
      }
      expect((await orgOf(infra, s.orgId))!.status).toBe("active");
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("platform access", () => {
  it(
    "every endpoint: no session → UNAUTHENTICATED, shop owner → FORBIDDEN, admin without 2FA proof → TWO_FACTOR_REQUIRED",
    async () => {
      const s = await shop();
      const [noTwoFactor, pending] = [await admin("no-2fa"), await admin("2fa-pending")];
      const calls = [
        (h: Record<string, string>) => list(h),
        (h: Record<string, string>) => detail(h, s.orgId),
        (h: Record<string, string>) => setStatus(h, s.orgId, { status: "suspended", reason: "x" }),
      ];
      for (const send of calls) {
        await expectError(await send({}), 401, "UNAUTHENTICATED");
        await expectError(await send({ cookie: "session=expired" }), 401, "UNAUTHENTICATED");
        await expectError(await send(s.headers), 403, "FORBIDDEN");
        await expectError(await send(noTwoFactor.headers), 403, "TWO_FACTOR_REQUIRED");
        await expectError(await send(pending.headers), 403, "TWO_FACTOR_REQUIRED");
      }
      expect((await orgOf(infra, s.orgId))!.status).toBe("active");
      expect(await auditOf(infra, s.orgId)).toEqual([]);
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("platform module boundary (ADR-0002)", () => {
  it("imports other modules only through their index.ts", () => {
    const modules = resolve(__dirname, "../../src/modules");
    const root = join(modules, "platform");
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts")).map((f) => join(root, f));
    expect(files.length).toBeGreaterThan(0);
    const offending: string[] = [];
    for (const file of files) {
      for (const [, spec] of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        if (!spec?.startsWith(".")) continue;
        const target = relative(modules, resolve(dirname(file), spec));
        const [owner, ...rest] = target.split("/");
        if (target.startsWith("..") || owner === "platform") continue;
        if (rest.length > 0 && !(rest.length === 1 && rest[0] === "index")) offending.push(`${relative(root, file)} → ${spec}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
