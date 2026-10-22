import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { membership, membershipBranch, subscription, withTenant } from "@app/db";
import type { Role } from "@app/domain";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect } from "vitest";
import { AUTH, type Auth } from "../../src/modules/identity";
import type { TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type Seeded = Awaited<ReturnType<typeof seedOrg>>;

export async function call(app: NestFastifyApplication, method: Method, url: string, headers: Record<string, string>, payload?: unknown) {
  return app.inject({ method, url: `/api/v1${url}`, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
}

export async function expectError(
  res: { statusCode: number; json(): { error: { code: string; details?: unknown } } },
  status: number,
  code: string,
) {
  expect(res.statusCode, JSON.stringify(res.json())).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error;
}

/** Org-scoped guard errors shared by every endpoint of this card (T-0009 guard order). */
export async function expectGuardErrors(app: NestFastifyApplication, infra: TestInfra, method: Method, url: string, payload?: unknown) {
  const caller = await seedOrg(app, infra, { role: "owner", branches: ["Guard A"] });
  const stranger = await seedOrg(app, infra, { role: "owner", branches: ["Guard B"] });
  const forced = await seedOrg(app, infra, { role: "owner", branches: ["Guard C"], mustChangePassword: true });
  await expectError(await call(app, method, url, {}, payload), 401, "UNAUTHENTICATED");
  await expectError(await call(app, method, url, { ...caller.headers, cookie: "session=expired" }, payload), 401, "UNAUTHENTICATED");
  for (const header of [undefined, "not-a-uuid"]) {
    const headers: Record<string, string> =
      header === undefined ? { cookie: caller.cookie } : { cookie: caller.cookie, "x-org-id": header };
    const error = await expectError(await call(app, method, url, headers, payload), 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: { "X-Org-Id": expect.any(Array) } });
  }
  await expectError(await call(app, method, url, { ...caller.headers, "x-org-id": stranger.orgId }, payload), 403, "FORBIDDEN");
  await expectError(await call(app, method, url, { ...caller.headers, "x-org-id": randomUUID() }, payload), 403, "FORBIDDEN");
  await expectError(await call(app, method, url, forced.headers, payload), 403, "PASSWORD_CHANGE_REQUIRED");
}

/** Read back with the platform role: the runtime role cannot SELECT outbox_event (append-only enqueue). */
export async function outboxOf(infra: TestInfra, orgId: string) {
  return infra.platformDb.query.outboxEvent.findMany({
    where: (o, { eq }) => eq(o.orgId, orgId),
    orderBy: (o, { asc }) => [asc(o.aggregateVersion), asc(o.occurredAt)],
  });
}
export async function auditOf(infra: TestInfra, orgId: string) {
  return infra.platformDb.query.auditLog.findMany({
    where: (a, { eq }) => eq(a.orgId, orgId),
    orderBy: (a, { asc }) => [asc(a.occurredAt)],
  });
}
export async function branchesOf(infra: TestInfra, orgId: string) {
  return infra.platformDb.query.branch.findMany({ where: (b, { eq }) => eq(b.orgId, orgId) });
}
export async function hoursOf(infra: TestInfra, orgId: string) {
  return infra.platformDb.query.branchHours.findMany({
    where: (h, { eq }) => eq(h.orgId, orgId),
    orderBy: (h, { asc }) => [asc(h.branchId), asc(h.weekday)],
  });
}
export async function orgOf(infra: TestInfra, orgId: string) {
  return infra.platformDb.query.organization.findFirst({ where: (o, { eq }) => eq(o.id, orgId) });
}
export async function suspend(infra: TestInfra, orgId: string) {
  await infra.platformDb.$client.query("update organization set status = 'suspended' where id = $1", [orgId]);
}

/** Unknown keys named like Object.prototype members must still be reported as own `details.fields.<key>` entries. */
export const PROTOTYPE_KEYS = ["toString", "constructor", "hasOwnProperty", "valueOf"] as const;
export async function expectUnknownKeysRejected(
  send: (body: Record<string, unknown>) => ReturnType<typeof call>,
  base: Record<string, unknown>,
) {
  for (const key of PROTOTYPE_KEYS) {
    const error = await expectError(await send({ ...base, [key]: "x" }), 400, "VALIDATION_FAILED");
    const fields = (error.details as { fields: Record<string, unknown> }).fields;
    expect(Object.hasOwn(fields, key), key).toBe(true);
    expect(Array.isArray(fields[key]), key).toBe(true);
  }
}

export const ROLES = ["owner", "manager", "front_desk", "groomer", "caretaker"] as const;

// --- T-0013 branch schedule (#contract-branch-schedule-common) ---

/** Fixed injected CLOCK instant for every app-written schedule timestamp. */
export const FIXED_NOW = new Date("2031-05-06T07:08:09.123Z");
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** seedOrg inserts bare branches; schedule cards need the 7 default hours rows that branch.create / signup write. */
export async function seedHours(infra: TestInfra, orgId: string, branchIds: readonly string[]) {
  for (const branchId of branchIds) {
    await infra.platformDb.$client.query(
      "insert into branch_hours (org_id, branch_id, weekday, opens_at, closes_at) select $1, $2, w, '09:00', '18:00' from generate_series(1, 7) w",
      [orgId, branchId],
    );
  }
}
export async function branchRow(infra: TestInfra, id: string) {
  return (await infra.platformDb.query.branch.findFirst({ where: (b, { eq }) => eq(b.id, id) }))!;
}
export async function branchHoursOf(infra: TestInfra, branchId: string) {
  return infra.platformDb.query.branchHours.findMany({
    where: (h, { eq }) => eq(h.branchId, branchId),
    orderBy: (h, { asc }) => [asc(h.weekday)],
  });
}
export async function closuresOf(infra: TestInfra, orgId: string) {
  const { rows } = await infra.platformDb.$client.query(
    "select id, branch_id, start_date::text, end_date::text, reason, created_at, updated_at from branch_closure where org_id = $1 order by start_date, end_date, id",
    [orgId],
  );
  return rows as Array<{ id: string; branch_id: string; start_date: string; end_date: string; reason: string | null }>;
}
export async function insertClosureRow(
  infra: TestInfra,
  orgId: string,
  branchId: string,
  startDate: string,
  endDate: string,
  reason: string | null = null,
) {
  const { rows } = await infra.platformDb.$client.query<{ id: string }>(
    "insert into branch_closure (org_id, branch_id, start_date, end_date, reason) values ($1, $2, $3, $4, $5) returning id",
    [orgId, branchId, startDate, endDate, reason],
  );
  return rows[0]!.id;
}

/** Every schedule route: guard errors, platform flag without membership, and rejection of any query key (incl. repeated keys). */
export async function expectScheduleRouteErrors(
  app: NestFastifyApplication,
  infra: TestInfra,
  method: Method,
  path: (s: Seeded) => string,
  payload?: unknown,
) {
  await expectGuardErrors(app, infra, method, path({ branchIds: [randomUUID(), randomUUID()] } as Seeded), payload);
  const admin = await seedOrg(app, infra, { role: "owner", branches: ["Admin"] });
  const target = await seedOrg(app, infra, { role: "owner", branches: ["A", "B"] });
  await seedHours(infra, target.orgId, target.branchIds);
  await infra.platformDb.$client.query('update "user" set is_platform_admin = true where id = $1', [admin.userId]);
  await expectError(await call(app, method, path(target), { ...admin.headers, "x-org-id": target.orgId }, payload), 403, "FORBIDDEN");
  for (const [query, field] of [
    ["?cursor=1", "cursor"],
    ["?page=1&page=2", "page"],
    ["?branchId=x", "branchId"],
  ] as const) {
    const error = await expectError(await call(app, method, `${path(target)}${query}`, target.headers, payload), 400, "VALIDATION_FAILED");
    expect(Object.keys((error.details as { fields: object }).fields), query).toContain(field);
  }
  expect((await branchRow(infra, target.branchIds[0]!)).version).toBe(1);
  expect(await outboxOf(infra, target.orgId)).toEqual([]);
  expect(await auditOf(infra, target.orgId)).toEqual([]);
}

/** GET/DELETE take no body: nonempty → VALIDATION_FAILED at `_`; absent or zero-byte bodies are accepted (status `ok`). */
export async function expectNoBodyRule(
  app: NestFastifyApplication,
  method: "GET" | "DELETE",
  url: () => Promise<string>,
  headers: Record<string, string>,
  ok: number,
) {
  for (const payload of [{}, { x: 1 }, "x"]) {
    const res = await app.inject({
      method,
      url: `/api/v1${await url()}`,
      headers: { ...headers, "content-type": typeof payload === "string" ? "text/plain" : "application/json" },
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    const error = await expectError(res, 400, "VALIDATION_FAILED");
    expect(error.details, JSON.stringify(payload)).toMatchObject({ fields: { _: expect.any(Array) } });
  }
  // A chunked JSON string `""` is two bytes, even though Fastify parses it to an empty string.
  const jsonEmptyString = await app.inject({
    method,
    url: `/api/v1${await url()}`,
    headers: { ...headers, "content-type": "application/json", "transfer-encoding": "chunked" },
    payload: Readable.from(['""']),
  });
  const jsonError = await expectError(jsonEmptyString, 400, "VALIDATION_FAILED");
  expect(jsonError.details, 'chunked JSON ""').toMatchObject({ fields: { _: expect.any(Array) } });
  expect((await app.inject({ method, url: `/api/v1${await url()}`, headers, payload: "" })).statusCode).toBe(ok);
  expect((await app.inject({ method, url: `/api/v1${await url()}`, headers: { ...headers, "content-length": "0" } })).statusCode).toBe(ok);
  // Chunked transfer: a body is decided by the bytes received, not by the transfer-encoding header. Since T-0040 a
  // DELETE body without a content-type reaches the route too (T-0013-01).
  for (const contentType of [{}, { "content-type": "text/plain" }]) {
    const chunked = (chunks: string[]) =>
      url().then((path) =>
        app.inject({
          method,
          url: `/api/v1${path}`,
          headers: { ...headers, ...contentType, "transfer-encoding": "chunked" },
          payload: Readable.from(chunks),
        }),
      );
    const error = await expectError(await chunked(["x"]), 400, "VALIDATION_FAILED");
    expect(error.details, `chunked ${JSON.stringify(contentType)}`).toMatchObject({ fields: { _: expect.any(Array) } });
    const empty = await chunked([]);
    expect(empty.statusCode, `empty chunked ${JSON.stringify(contentType)}: ${empty.body}`).toBe(ok);
  }
}

// --- T-0015 staff and invitations (#contract-staff-list, #contract-staff-invite) ---

/** Subscription on a fresh plan with `maxStaff` seats (plan on the platform connection, like the Q-0005 seed). */
export async function seedStaffPlan(infra: TestInfra, orgId: string, maxStaff: number | null) {
  const created = await infra.platformDb.$client.query<{ id: string }>(
    "insert into plan (code, name, max_branches, max_staff, price_satang_per_month, is_active) values ($1, 'Staff plan', 5, $2, 0, true) returning id",
    [`test_${randomUUID()}`, maxStaff],
  );
  await withTenant(infra.runtimeDb, orgId, (tx) =>
    tx.insert(subscription).values({ orgId, planId: created.rows[0]!.id, startedAt: new Date("2026-01-01T00:00:00Z") }),
  );
}

/** Another member of `orgId` (real account, verified email). `status: "removed"` models a former member. */
export async function addMember(
  app: NestFastifyApplication,
  infra: TestInfra,
  orgId: string,
  member: { role: Role; branchIds?: readonly string[]; status?: "active" | "removed"; displayName?: string; email?: string },
) {
  const email = member.email ?? `${randomUUID()}@example.com`;
  const signed = await app
    .get<Auth>(AUTH)
    .api.signUpEmail({ body: { email, password: "correct-horse-1", name: member.displayName ?? "Member" } });
  await infra.platformDb.$client.query('update "user" set email_verified = true where id = $1', [signed.user.id]);
  const membershipId = await withTenant(infra.runtimeDb, orgId, async (tx) => {
    const [row] = await tx
      .insert(membership)
      .values({
        orgId,
        userId: signed.user.id,
        role: member.role,
        displayName: member.displayName ?? "Member",
        status: member.status ?? "active",
      })
      .returning();
    for (const branchId of member.branchIds ?? []) await tx.insert(membershipBranch).values({ orgId, membershipId: row!.id, branchId });
    return row!.id;
  });
  return { userId: signed.user.id, email, membershipId };
}

/** Managed account (F09) member: internal `<id>@managed.invalid` email that must never be shown. */
export async function addManagedMember(infra: TestInfra, orgId: string, role: Role, branchIds: readonly string[], username: string) {
  const userId = randomUUID();
  await infra.platformDb.$client.query(
    `insert into "user" (id, name, email, username, is_managed, managed_by_org_id, email_verified) values ($1, 'Managed', $2, $3, true, $4, false)`,
    [userId, `${userId}@managed.invalid`, username, orgId],
  );
  return withTenant(infra.runtimeDb, orgId, async (tx) => {
    const [row] = await tx.insert(membership).values({ orgId, userId, role, displayName: "Managed" }).returning();
    for (const branchId of branchIds) await tx.insert(membershipBranch).values({ orgId, membershipId: row!.id, branchId });
    return { userId, membershipId: row!.id };
  });
}

/** Invitation row written directly (platform connection) for list/revoke fixtures in any state. */
export async function insertInvitationRow(
  infra: TestInfra,
  row: {
    orgId: string;
    email: string;
    role: Role;
    branchIds?: readonly string[];
    invitedByUserId: string;
    expiresAt: Date;
    createdAt?: Date;
  },
  state: { acceptedAt?: Date; revokedAt?: Date } = {},
) {
  const { rows } = await infra.platformDb.$client.query<{ id: string }>(
    `insert into invitation (org_id, email, role, branch_ids, token_hash, expires_at, accepted_at, revoked_at, invited_by_user_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      row.orgId,
      row.email,
      row.role,
      row.branchIds ?? [],
      randomUUID(),
      row.expiresAt,
      state.acceptedAt ?? null,
      state.revokedAt ?? null,
      row.invitedByUserId,
      row.createdAt ?? new Date("2031-05-01T00:00:00Z"),
    ],
  );
  return rows[0]!.id;
}

export async function invitationsOf(infra: TestInfra, orgId: string) {
  return infra.platformDb.query.invitation.findMany({
    where: (i, { eq }) => eq(i.orgId, orgId),
    orderBy: (i, { asc }) => [asc(i.createdAt), asc(i.id)],
  });
}
export async function membershipsOf(infra: TestInfra, orgId: string) {
  return infra.platformDb.query.membership.findMany({ where: (m, { eq }) => eq(m.orgId, orgId) });
}

/**
 * Holds the org's subscription row lock (#rule-staff-check-and-lock step 1) in another transaction until `release`.
 * `waiting()` resolves once some other backend is blocked on a lock, so a test can change state mid-request.
 */
export async function holdSubscriptionLock(infra: TestInfra, orgId: string) {
  const client = await infra.platformDb.$client.connect();
  await client.query("begin");
  await client.query("select 1 from subscription where org_id = $1 for update", [orgId]);
  return {
    async waiting() {
      for (let i = 0; i < 200; i++) {
        const { rows } = await infra.platformDb.$client.query<{ n: number }>("select count(*)::int as n from pg_locks where not granted");
        if (rows[0]!.n > 0) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error("no request ever waited on the subscription lock");
    },
    async release() {
      await client.query("commit");
      client.release();
    },
  };
}
