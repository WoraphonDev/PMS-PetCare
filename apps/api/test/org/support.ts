import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect } from "vitest";
import type { TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

type Method = "GET" | "POST" | "PATCH";
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
