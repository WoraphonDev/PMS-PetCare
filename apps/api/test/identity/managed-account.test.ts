import { randomUUID } from "node:crypto";
import { organization, withTenant } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../../packages/db/test/support/test-db";
import {
  createManagedAccount,
  deleteAllSessions,
  hashPassword,
  managedOwnerOf,
  setManagedPassword,
  usernameTaken,
} from "../../src/modules/identity";
import { type Auth, createAuth } from "../../src/modules/identity/auth";
import { FakeEmailSender } from "../../src/modules/notification/email";
import { testConfig } from "../support/app";

// docs/spec/features/foundation.md#rule-managed-account-identity · #contract-staff-password-reset — identity writes that
// org calls on its own tenant transaction (ADR-0002: org never writes identity tables itself).
let db: TestDb;
let auth: Auth;
let orgId: string;
const NOW = new Date("2031-05-06T07:08:09.123Z");
beforeAll(async () => {
  db = await createTestDb();
  auth = createAuth(testConfig, db.platformDb, new FakeEmailSender());
  orgId = randomUUID();
  await withTenant(db.runtimeDb, orgId, (tx) => tx.insert(organization).values({ id: orgId, slug: orgId, displayName: "Shop" }));
}, 180_000);
afterAll(async () => {
  await db?.stop();
});

const onTenant = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db.runtimeDb, orgId, fn);
const freshUsername = () => `m.${randomUUID().slice(0, 8)}`;
const verify = async (hash: string, password: string) => (await auth.$context).password.verify({ hash, password });
async function identityOf(userId: string) {
  const user = await db.platformDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
  const accounts = await db.platformDb.query.account.findMany({ where: (a, { eq }) => eq(a.userId, userId) });
  const sessions = await db.platformDb.query.session.findMany({ where: (s, { eq }) => eq(s.userId, userId) });
  return { user, accounts, sessions };
}
async function create(username = freshUsername(), password = "correct-horse-1") {
  const passwordHash = await hashPassword(auth, password);
  return onTenant((tx) => createManagedAccount(tx, { orgId, username, displayName: "Mai", passwordHash, now: NOW }));
}
async function addSession(userId: string) {
  const { rows } = await db.platformDb.$client.query<{ id: string }>(
    "insert into session (token, user_id, expires_at) values ($1, $2, $3) returning id",
    [randomUUID(), userId, new Date("2040-01-01T00:00:00Z")],
  );
  const id = rows[0]!.id;
  await db.platformDb.$client.query("insert into verification (identifier, value, expires_at) values ($1, $2, $3)", [
    `2fa-session:${id}`,
    userId,
    new Date("2040-01-01T00:00:00Z"),
  ]);
  return id;
}
async function twoFactorMarkersOf(userId: string) {
  const { rows } = await db.platformDb.$client.query("select identifier from verification where value = $1", [userId]);
  return rows;
}

describe("createManagedAccount", () => {
  it("inserts the managed user with the placeholder email and a credential account whose hash verifies the password", async () => {
    const username = freshUsername();
    const userId = await create(username, "correct-horse-1");
    const { user, accounts, sessions } = await identityOf(userId);
    expect(user).toMatchObject({
      id: userId,
      name: "Mai",
      email: `${userId}@managed.invalid`,
      emailVerified: false,
      username,
      isManaged: true,
      managedByOrgId: orgId,
      mustChangePassword: true,
      twoFactorEnabled: false,
      isPlatformAdmin: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ providerId: "credential", accountId: userId });
    expect(await verify(accounts[0]!.password!, "correct-horse-1")).toBe(true);
    expect(await verify(accounts[0]!.password!, "correct-horse-2")).toBe(false);
    expect(sessions).toEqual([]);
  });

  it("writes nothing when the caller's transaction rolls back", async () => {
    const username = freshUsername();
    const passwordHash = await hashPassword(auth, "correct-horse-1");
    let userId = "";
    await expect(
      onTenant(async (tx) => {
        userId = await createManagedAccount(tx, { orgId, username, displayName: "Mai", passwordHash, now: NOW });
        throw new Error("caller failed");
      }),
    ).rejects.toThrow("caller failed");
    expect(userId).not.toBe("");
    expect(await identityOf(userId)).toEqual({ user: undefined, accounts: [], sessions: [] });
    expect(await onTenant((tx) => usernameTaken(tx, username))).toBe(false);
  });
});

describe("usernameTaken and managedOwnerOf", () => {
  it("matches usernames case-insensitively, managed or not", async () => {
    const username = freshUsername();
    await create(username);
    expect(await onTenant((tx) => usernameTaken(tx, username))).toBe(true);
    expect(await onTenant((tx) => usernameTaken(tx, username.toUpperCase()))).toBe(true);
    const real = freshUsername();
    await db.platformDb.$client.query(`insert into "user" (name, email, username) values ('Real', $1, $2)`, [
      `${randomUUID()}@example.com`,
      real,
    ]);
    expect(await onTenant((tx) => usernameTaken(tx, real))).toBe(true);
    expect(await onTenant((tx) => usernameTaken(tx, freshUsername()))).toBe(false);
  });

  it("returns the owning org of a managed account, and null for a real-email or unknown account", async () => {
    const managed = await create();
    expect(await onTenant((tx) => managedOwnerOf(tx, managed))).toBe(orgId);
    const { rows } = await db.platformDb.$client.query<{ id: string }>(
      `insert into "user" (name, email) values ('Real', $1) returning id`,
      [`${randomUUID()}@example.com`],
    );
    expect(await onTenant((tx) => managedOwnerOf(tx, rows[0]!.id))).toBeNull();
    expect(await onTenant((tx) => managedOwnerOf(tx, randomUUID()))).toBeNull();
  });
});

describe("setManagedPassword", () => {
  it("sets the new hash and must_change_password, and deletes every session and 2FA marker of that account only", async () => {
    const userId = await create(freshUsername(), "correct-horse-1");
    await db.platformDb.$client.query('update "user" set must_change_password = false where id = $1', [userId]);
    await addSession(userId);
    await addSession(userId);
    const other = await create();
    const otherSession = await addSession(other);

    const later = new Date(NOW.getTime() + 60_000);
    const passwordHash = await hashPassword(auth, "brand-new-pass-2");
    await onTenant((tx) => setManagedPassword(tx, { userId, passwordHash, now: later }));

    const { user, accounts, sessions } = await identityOf(userId);
    expect(user).toMatchObject({ mustChangePassword: true, updatedAt: later, twoFactorEnabled: false });
    expect(await verify(accounts[0]!.password!, "brand-new-pass-2")).toBe(true);
    expect(await verify(accounts[0]!.password!, "correct-horse-1")).toBe(false);
    expect(accounts[0]!.updatedAt).toEqual(later);
    expect(sessions).toEqual([]);
    expect(await twoFactorMarkersOf(userId)).toEqual([]);
    expect((await identityOf(other)).sessions.map((s) => s.id)).toEqual([otherSession]);
    expect(await twoFactorMarkersOf(other)).toHaveLength(1);
  });

  it("changes nothing when the caller's transaction rolls back", async () => {
    const userId = await create(freshUsername(), "correct-horse-1");
    await addSession(userId);
    const before = await identityOf(userId);
    const passwordHash = await hashPassword(auth, "brand-new-pass-2");
    await expect(
      onTenant(async (tx) => {
        await setManagedPassword(tx, { userId, passwordHash, now: NOW });
        throw new Error("caller failed");
      }),
    ).rejects.toThrow("caller failed");
    expect(await identityOf(userId)).toEqual(before);
    expect(await twoFactorMarkersOf(userId)).toHaveLength(1);
  });
});

describe("deleteAllSessions", () => {
  it("deletes every session and 2FA marker of that account only, and nothing else of it (T-0017 remove)", async () => {
    const userId = await create(freshUsername(), "correct-horse-1");
    await addSession(userId);
    await addSession(userId);
    const other = await create();
    const otherSession = await addSession(other);
    const before = await identityOf(userId);

    await onTenant((tx) => deleteAllSessions(tx, userId));

    const after = await identityOf(userId);
    expect(after.sessions).toEqual([]);
    expect(await twoFactorMarkersOf(userId)).toEqual([]);
    expect({ user: after.user, accounts: after.accounts }).toEqual({ user: before.user, accounts: before.accounts });
    expect((await identityOf(other)).sessions.map((s) => s.id)).toEqual([otherSession]);
    expect(await twoFactorMarkersOf(other)).toHaveLength(1);
  });

  it("changes nothing when the caller's transaction rolls back", async () => {
    const userId = await create();
    await addSession(userId);
    await expect(
      onTenant(async (tx) => {
        await deleteAllSessions(tx, userId);
        throw new Error("caller failed");
      }),
    ).rejects.toThrow("caller failed");
    expect((await identityOf(userId)).sessions).toHaveLength(1);
    expect(await twoFactorMarkersOf(userId)).toHaveLength(1);
  });
});
