import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { account, auditLog, organization, session, twoFactor, user, withPlatform, withTenant, writeAudit } from "../src";
import { createTestDb, type TestDb } from "./support/test-db";

let t: TestDb;
const ORG = randomUUID();
const NOW = new Date("2026-10-20T03:00:00.000Z");

beforeAll(async () => {
  t = await createTestDb();
  await withTenant(t.runtimeDb, ORG, (tx) => tx.insert(organization).values({ id: ORG, slug: "id-shop", displayName: "Id Shop" }));
}, 120_000);

afterAll(async () => {
  await t?.stop();
});

const pg = (e: unknown) => (e as { cause?: { code?: string; constraint?: string } })?.cause ?? {};
const newUser = (over: Partial<typeof user.$inferInsert> = {}) => ({
  name: "Ann",
  email: `${randomUUID()}@example.com`,
  emailVerified: false,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const insertUser = (over: Partial<typeof user.$inferInsert> = {}) =>
  t.runtimeDb
    .insert(user)
    .values(newUser(over))
    .returning()
    .then((r) => r[0])
    .catch((e) => e);

describe("user", () => {
  it("gets a uuid id and the spec defaults", async () => {
    const u = await insertUser();
    expect(u.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(u).toMatchObject({
      isPlatformAdmin: false,
      isManaged: false,
      managedByOrgId: null,
      mustChangePassword: false,
      twoFactorEnabled: false,
    });
  });

  it("email is unique", async () => {
    const email = `${randomUUID()}@example.com`;
    await insertUser({ email });
    expect(pg(await insertUser({ email }))).toMatchObject({ code: "23505" });
  });

  it("username is unique ignoring case", async () => {
    await insertUser({ username: "ann.k" });
    expect(pg(await insertUser({ username: "ANN.K" }))).toMatchObject({ code: "23505" });
  });

  it.each(["ab", "has space", "thai-ชื่อ", "a".repeat(41)])("rejects username %j", async (username) => {
    expect(pg(await insertUser({ username }))).toMatchObject({ code: "23514", constraint: "user_username_format" });
  });

  it("accepts a username at both length limits", async () => {
    expect(await insertUser({ username: `a${randomUUID().slice(0, 2)}` })).not.toBeInstanceOf(Error);
    expect(await insertUser({ username: `${randomUUID().replaceAll("-", "")}abcdefgh` })).not.toBeInstanceOf(Error);
  });

  it("a managed account must name its organization (F09)", async () => {
    expect(pg(await insertUser({ isManaged: true }))).toMatchObject({ code: "23514", constraint: "user_managed_has_org" });
    expect(await insertUser({ isManaged: true, managedByOrgId: ORG, username: `staff.${randomUUID().slice(0, 6)}` })).not.toBeInstanceOf(
      Error,
    );
  });

  it("managed_by_org_id must reference an organization", async () => {
    expect(pg(await insertUser({ isManaged: true, managedByOrgId: randomUUID() }))).toMatchObject({ code: "23503" });
  });
});

describe("dependent tables", () => {
  it("deleting a user cascades to session, account and two_factor", async () => {
    const u = await insertUser();
    await t.runtimeDb.insert(session).values({ token: randomUUID(), userId: u.id, expiresAt: NOW, createdAt: NOW, updatedAt: NOW });
    await t.runtimeDb
      .insert(account)
      .values({ accountId: u.id, providerId: "credential", userId: u.id, password: "hash", createdAt: NOW, updatedAt: NOW });
    await t.runtimeDb.insert(twoFactor).values({ secret: "s", backupCodes: "b", userId: u.id });
    await t.runtimeDb.delete(user).where(eq(user.id, u.id));
    const left = await Promise.all([
      t.runtimeDb.select().from(session).where(eq(session.userId, u.id)),
      t.runtimeDb.select().from(account).where(eq(account.userId, u.id)),
      t.runtimeDb.select().from(twoFactor).where(eq(twoFactor.userId, u.id)),
    ]);
    expect(left.map((rows) => rows.length)).toEqual([0, 0, 0]);
  });

  it("session token is unique", async () => {
    const u = await insertUser();
    const token = randomUUID();
    await t.runtimeDb.insert(session).values({ token, userId: u.id, expiresAt: NOW, createdAt: NOW, updatedAt: NOW });
    const dup = await t.runtimeDb
      .insert(session)
      .values({ token, userId: u.id, expiresAt: NOW, createdAt: NOW, updatedAt: NOW })
      .catch((e) => e);
    expect(pg(dup)).toMatchObject({ code: "23505" });
  });
});

describe("audit_log.actor_user_id", () => {
  it("must reference an existing user", async () => {
    const res = await withTenant(t.runtimeDb, ORG, (tx) =>
      writeAudit(tx, { orgId: ORG, actorUserId: randomUUID(), action: "x", entityType: "x", entityId: ORG, occurredAt: NOW }),
    ).catch((e) => e);
    expect(pg(res)).toMatchObject({ code: "23503" });
  });

  it("accepts a real user", async () => {
    const u = await insertUser();
    await withTenant(t.runtimeDb, ORG, (tx) =>
      writeAudit(tx, { orgId: ORG, actorUserId: u.id, action: "x", entityType: "x", entityId: ORG, occurredAt: NOW }),
    );
    const rows = await withPlatform(t.platformDb, (tx) => tx.select().from(auditLog).where(eq(auditLog.actorUserId, u.id)));
    expect(rows).toHaveLength(1);
  });
});
