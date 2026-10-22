import { randomUUID } from "node:crypto";
import { organization, withTenant } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../../packages/db/test/support/test-db";
import { staffProfiles, usersByEmail } from "../../src/modules/identity";

// docs/spec/features/foundation.md#contract-staff-invite step 8 · #contract-staff-list — identity reads that org calls on
// its own tenant transaction (ADR-0002: org never reads "user" itself).
let db: TestDb;
let orgId: string;
beforeAll(async () => {
  db = await createTestDb();
  orgId = randomUUID();
  await withTenant(db.runtimeDb, orgId, (tx) => tx.insert(organization).values({ id: orgId, slug: orgId, displayName: "Shop" }));
}, 180_000);
afterAll(async () => {
  await db?.stop();
});

async function user(fields: { email: string; managed?: boolean; username?: string; twoFactor?: boolean; name?: string }) {
  const { rows } = await db.platformDb.$client.query<{ id: string }>(
    `insert into "user" (name, email, username, is_managed, managed_by_org_id, two_factor_enabled)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      fields.name ?? "Staff",
      fields.email,
      fields.username ?? null,
      fields.managed ?? false,
      fields.managed ? orgId : null,
      fields.twoFactor ?? false,
    ],
  );
  return rows[0]!.id;
}
const onTenant = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db.runtimeDb, orgId, fn);

describe("usersByEmail", () => {
  it("returns nothing for an unknown email", async () => {
    expect(await onTenant((tx) => usersByEmail(tx, `${randomUUID()}@example.com`))).toEqual([]);
  });

  it("matches the canonical lower-case email, including legacy mixed-case rows, with the managed flag", async () => {
    const local = randomUUID();
    const id = await user({ email: `${local}@Example.COM` });
    expect(await onTenant((tx) => usersByEmail(tx, `${local}@example.com`))).toEqual([{ id, isManaged: false }]);
    const managedId = randomUUID();
    await user({ email: `${managedId}@managed.invalid`, managed: true });
    expect(await onTenant((tx) => usersByEmail(tx, `${managedId}@managed.invalid`))).toEqual([{ id: expect.any(String), isManaged: true }]);
  });
});

describe("staffProfiles", () => {
  it("returns name, username and 2FA; email is null for managed accounts and the placeholder never appears", async () => {
    const real = await user({ email: `${randomUUID()}@example.com`, name: "Mai", twoFactor: true });
    const managed = await user({ email: `${randomUUID()}@managed.invalid`, managed: true, username: `m.${randomUUID().slice(0, 8)}` });
    const profiles = await onTenant((tx) => staffProfiles(tx, [real, managed]));
    expect(profiles).toHaveLength(2);
    expect(profiles.find((p) => p.id === real)).toEqual({
      id: real,
      name: "Mai",
      email: expect.stringMatching(/@example\.com$/),
      username: null,
      isManaged: false,
      twoFactorEnabled: true,
    });
    expect(profiles.find((p) => p.id === managed)).toMatchObject({
      email: null,
      username: expect.stringMatching(/^m\./),
      isManaged: true,
      twoFactorEnabled: false,
    });
    expect(JSON.stringify(profiles)).not.toContain("managed.invalid");
    expect(await onTenant((tx) => staffProfiles(tx, []))).toEqual([]);
  });
});
