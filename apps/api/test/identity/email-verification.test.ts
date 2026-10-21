import { createHash, randomUUID } from "node:crypto";
import { organization, type Tx, user, verification, withTenant } from "@app/db";
import { createEmailVerificationToken } from "better-auth/api";
import { verifyJWT } from "better-auth/crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createAuth } from "../../src/modules/identity/auth";
import { createEmailVerificationRepository } from "../../src/modules/identity/identity.repository";
import { captureVerificationAfterCommit } from "../../src/modules/identity/verification-collector";
import { FakeEmailSender } from "../../src/modules/notification/email";
import { testConfig } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
const secret = testConfig.BETTER_AUTH_SECRET;
const repo = createEmailVerificationRepository(secret);
const now = () => new Date(); // injected test CLOCK, never production global replacement
const key = (id: string) => `pms:email-verify:v1:${id}`;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
beforeAll(async () => {
  infra = await createTestInfra();
}, 180_000);
afterAll(async () => {
  await infra?.stop();
});
async function seed(options: { emailVerified?: boolean; isManaged?: boolean } = {}) {
  const id = randomUUID();
  let orgId: string | undefined;
  if (options.isManaged) {
    orgId = randomUUID();
    await withTenant(infra.runtimeDb, orgId, (tx) =>
      tx
        .insert(organization)
        .values({ id: orgId!, slug: orgId!, displayName: "Managed fixture" })
        .then(() => undefined),
    );
  }
  await infra.runtimeDb.insert(user).values({ id, email: `${id}@example.com`, name: "Verify", ...options, managedByOrgId: orgId });
  return id;
}
const issue = (id: string, time = now()) => infra.runtimeDb.transaction((tx) => repo.issueEmailVerification(tx, id, time));
const consume = (token: string, time = now()) => infra.runtimeDb.transaction((tx) => repo.consumeEmailVerification(tx, token, time));
const states = (id: string) => infra.runtimeDb.query.verification.findMany({ where: (v, { eq }) => eq(v.identifier, key(id)) });
const identity = (id: string) => infra.runtimeDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, id) });
const invalid = async (token: string, time = now()) =>
  expect(consume(token, time)).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: { token: expect.any(Array) } } });

it("issues one namespaced digest with injected timestamps, rotates distinctly in the same second and consumes once without a session", async () => {
  const id = await seed();
  const time = now();
  const first = (await issue(id, time))!;
  const second = (await issue(id, time))!;
  expect(second).not.toBe(first);
  const rows = await states(id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ identifier: key(id), createdAt: time, updatedAt: time, expiresAt: new Date(time.getTime() + 86400000) });
  expect(JSON.parse(rows[0]!.value)).toEqual({ purpose: "email-verify", version: 1, digest: digest(second) });
  expect(JSON.stringify(rows)).not.toContain(second);
  expect(JSON.stringify(rows)).not.toContain((await identity(id))!.email);
  await invalid(first);
  expect(await consume(second)).toBe(id);
  expect(await states(id)).toEqual([]);
  expect((await identity(id))!.emailVerified).toBe(true);
  await invalid(second);
  expect(await infra.runtimeDb.query.session.findMany()).toEqual([]);
  expect(await issue(id)).toBeNull();
});

it("rejects malformed, unsigned, tampered, wrong-purpose, change-email and native tokens even with matching stored digest", async () => {
  const id = await seed();
  const email = (await identity(id))!.email;
  const valid = (await issue(id))!;
  const payload = await verifyJWT<Record<string, unknown>>(valid, secret);
  for (const extra of [
    {},
    { ...payload, purpose: "password-reset" },
    { ...payload, nonce: undefined },
    { ...payload, updateTo: "changed@example.com" },
    { ...payload, requestType: "change-email-verification" },
    { ...payload, version: 2 },
  ]) {
    const token = await createEmailVerificationToken(secret, email, undefined, 86400, extra);
    await infra.runtimeDb.$client.query("update verification set value = $1 where identifier = $2", [
      JSON.stringify({ purpose: "email-verify", version: 1, digest: digest(token) }),
      key(id),
    ]);
    await invalid(token);
  }
  await invalid("malformed");
  const parts = valid.split(".");
  parts[1] = Buffer.from(JSON.stringify({ ...payload, nonce: randomUUID() })).toString("base64url");
  await invalid(parts.join("."));
  await invalid(`${parts[0]}.${parts[1]}.`);
  expect((await identity(id))!.emailVerified).toBe(false);
});

it("rejects missing state, email rebinding, managed/verified users and fails closed on duplicate or corrupt state", async () => {
  const id = await seed();
  const token = (await issue(id))!;
  const [row] = await states(id);
  await infra.runtimeDb.insert(verification).values({ ...row!, id: randomUUID() });
  await expect(consume(token)).rejects.toMatchObject({ code: "INTERNAL", message: "Email verification state invariant" });
  expect((await identity(id))!.emailVerified).toBe(false);
  const replacement = (await issue(id))!; // rotation repairs duplicate state under user lock
  expect(await states(id)).toHaveLength(1);
  await infra.runtimeDb.$client.query("update verification set value = 'invalid-json' where identifier = $1", [key(id)]);
  await expect(consume(replacement)).rejects.toMatchObject({ code: "INTERNAL" });
  const current = (await issue(id))!;
  await infra.runtimeDb.$client.query('update "user" set email = $1 where id = $2', [`${randomUUID()}@example.com`, id]);
  await invalid(current);
  const missing = (await issue(id))!;
  await infra.runtimeDb.$client.query("delete from verification where identifier = $1", [key(id)]);
  await invalid(missing);
  await infra.runtimeDb.$client.query('update "user" set email_verified = true where id = $1', [id]);
  await invalid(missing);
  expect(await issue(await seed({ isManaged: true }))).toBeNull();
  expect(await issue(await seed({ emailVerified: true }))).toBeNull();
  expect(await issue(randomUUID())).toBeNull();
});

it("rechecks locked eligibility and email binding after issuance without mutating current state", async () => {
  const id = await seed();
  const token = (await issue(id))!;
  await infra.runtimeDb.$client.query('UPDATE "user" SET email_verified = true WHERE id = $1', [id]);
  await invalid(token);
  expect(await issue(id)).toBeNull();
  expect(JSON.parse((await states(id))[0]!.value).digest).toBe(digest(token));
  const managed = await seed({ isManaged: true });
  const orgId = (await identity(managed))!.managedByOrgId;
  await infra.runtimeDb.$client.query('UPDATE "user" SET email_verified = false, is_managed = true, managed_by_org_id = $2 WHERE id = $1', [
    id,
    orgId,
  ]);
  await invalid(token);
  expect(await issue(id)).toBeNull();
  expect(await states(id)).toHaveLength(1);
});

it("applies injected persisted expiry at exactly 24h and independently rejects signed expiry", async () => {
  const id = await seed();
  const time = now();
  const token = (await issue(id, time))!;
  await invalid(token, new Date(time.getTime() + 86400000));
  expect(await states(id)).toHaveLength(1);
  expect(await consume(token, new Date(time.getTime() + 86400000 - 1))).toBe(id);
  const other = await seed();
  const signed = (await issue(other))!;
  const payload = (await verifyJWT<{ exp: number }>(signed, secret))!;
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(payload.exp * 1000));
    await invalid(signed, time); // persisted time still valid, signature expired
  } finally {
    vi.useRealTimers();
  }
});

it("issue/consume roll back together with surrounding writes, including a newly inserted user", async () => {
  const id = await seed();
  const initial = (await issue(id))!;
  await expect(
    infra.runtimeDb.transaction(async (tx) => {
      await repo.issueEmailVerification(tx, id, now());
      throw new Error("rollback issue");
    }),
  ).rejects.toThrow("rollback issue");
  expect(JSON.parse((await states(id))[0]!.value).digest).toBe(digest(initial));
  await expect(
    infra.runtimeDb.transaction(async (tx) => {
      await repo.consumeEmailVerification(tx, initial, now());
      throw new Error("rollback consume");
    }),
  ).rejects.toThrow("rollback consume");
  expect((await identity(id))!.emailVerified).toBe(false);
  expect(await consume(initial)).toBe(id);
  const fresh = randomUUID();
  await expect(
    infra.runtimeDb.transaction(async (tx) => {
      await tx.insert(user).values({ id: fresh, email: `${fresh}@example.com`, name: "Fresh" });
      expect(await repo.issueEmailVerification(tx, fresh, now())).toEqual(expect.any(String));
      throw new Error("rollback signup");
    }),
  ).rejects.toThrow("rollback signup");
  expect(await identity(fresh)).toBeUndefined();
  expect(await states(fresh)).toEqual([]);
});

it("SQL failure after conditional deletion rolls consumption back and remains an infrastructure error", async () => {
  const id = await seed();
  const token = (await issue(id))!;
  await infra.runtimeDb.$client.query('UPDATE "user" SET name = $1 WHERE id = $2', ["Fail verification update", id]);
  await infra.db.migratorDb.$client.query(`
    CREATE FUNCTION t0033_fail_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'verification update failure'; END $$;
    CREATE TRIGGER t0033_update_failure BEFORE UPDATE ON "user" FOR EACH ROW
    WHEN (NEW.name = 'Fail verification update' AND NEW.email_verified)
    EXECUTE FUNCTION t0033_fail_update();
  `);
  try {
    const result = await consume(token).then(
      () => null,
      (error) => error,
    );
    expect(result).toBeInstanceOf(Error);
    expect(result.code).not.toBe("VALIDATION_FAILED");
    expect((await identity(id))!.emailVerified).toBe(false);
    expect(JSON.parse((await states(id))[0]!.value).digest).toBe(digest(token));
  } finally {
    await infra.db.migratorDb.$client.query('DROP TRIGGER t0033_update_failure ON "user"; DROP FUNCTION t0033_fail_update()');
  }
  expect(await consume(token)).toBe(id);
});

it("parallel verification has exactly one winner", async () => {
  const id = await seed();
  const token = (await issue(id))!;
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => consume(token)));
  expect(results.filter((r) => r.status === "fulfilled")).toEqual([{ status: "fulfilled", value: id }]);
  for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "VALIDATION_FAILED" });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function withLock(id: string, work: (tx: Tx) => Promise<void>, competing: () => Promise<unknown>) {
  const locked = deferred();
  const release = deferred();
  const first = infra.runtimeDb.transaction(async (tx) => {
    // The first operation holds the actual user lock until the competing backend is observed waiting.
    await work(tx);
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const second = competing().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  try {
    await vi.waitFor(async () => {
      const result = await infra.runtimeDb.$client.query(
        "select count(*)::int as n from pg_stat_activity where usename = 'app_runtime' and wait_event_type = 'Lock'",
      );
      expect(result.rows[0].n).toBeGreaterThan(0);
    });
  } finally {
    release.resolve();
  }
  await first;
  const outcome = await second;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

it("resend then verify invalidates the old token; verify then resend never rotates", async () => {
  const id = await seed();
  const old = (await issue(id))!;
  let replacement = "";
  const rejected = withLock(
    id,
    async (tx) => {
      replacement = (await repo.issueEmailVerification(tx, id, now()))!;
    },
    () => consume(old),
  );
  await expect(rejected).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(await consume(replacement)).toBe(id);
  const other = await seed();
  const token = (await issue(other))!;
  expect(
    await withLock(
      other,
      async (tx) => {
        expect(await repo.consumeEmailVerification(tx, token, now())).toBe(other);
      },
      () => issue(other),
    ),
  ).toBeNull();
  expect(await states(other)).toEqual([]);
});

it("parallel resends leave only the final locked rotation valid", async () => {
  const id = await seed();
  const tokens = await Promise.all(Array.from({ length: 8 }, () => issue(id)));
  expect(new Set(tokens).size).toBe(8);
  const current = JSON.parse((await states(id))[0]!.value).digest;
  const winner = tokens.find((token) => digest(token!) === current)!;
  for (const token of tokens) if (token !== winner) await invalid(token!);
  expect(await consume(winner)).toBe(id);
});

it("native reset lookup/expired cleanup coexist with current state and other namespaces", async () => {
  const id = await seed();
  const token = (await issue(id))!;
  const rows = [`reset-password:${randomUUID()}`, `two-factor:${randomUUID()}`];
  for (const identifier of rows)
    await infra.runtimeDb
      .insert(verification)
      .values({ id: randomUUID(), identifier, value: id, expiresAt: new Date(now().getTime() + 3600000) });
  const expiredId = await seed();
  await issue(expiredId, new Date(now().getTime() - 86400001));
  const auth = createAuth(testConfig, infra.runtimeDb, new FakeEmailSender());
  const context = await auth.$context;
  await context.internalAdapter.findVerificationValue(rows[0]!);
  expect(await states(expiredId)).toEqual([]);
  expect(await states(id)).toHaveLength(1);
  expect(await consume(token)).toBe(id);
  for (const identifier of rows) expect(await context.internalAdapter.findVerificationValue(identifier)).toMatchObject({ value: id });
});

it("collector exposes dispatch only after commit, discards rollback and never shares messages", async () => {
  const sender = new FakeEmailSender();
  const id = randomUUID();
  const message = { to: "capture@example.com", subject: "Capture", text: "Private token" };
  let lateCapture!: (captured: typeof message) => void;
  const ready = await captureVerificationAfterCommit(infra.runtimeDb, sender, async (tx, capture) => {
    lateCapture = capture;
    await tx.insert(user).values({ id, email: `${id}@example.com`, name: "Collector" });
    capture(message);
    expect(sender.sent).toEqual([]);
    expect(await identity(id)).toBeUndefined();
    return id;
  });
  expect(ready.value).toBe(id);
  expect(await identity(id)).toBeDefined();
  expect(() => lateCapture(message)).toThrow("Verification capture closed");
  await ready.dispatch();
  await ready.dispatch();
  expect(sender.sent).toEqual([message]);
  await expect(
    captureVerificationAfterCommit(infra.runtimeDb, sender, async (_tx, capture) => {
      capture(message);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  const empty = await captureVerificationAfterCommit(infra.runtimeDb, sender, async () => 1);
  await empty.dispatch();
  expect(sender.sent).toEqual([message]);
});

it("request-local collectors compose actual issuance with outer commit and independent concurrent delivery", async () => {
  const sender = new FakeEmailSender();
  const ids = await Promise.all([seed(), seed()]);
  const ready = await Promise.all(
    ids.map((id) =>
      captureVerificationAfterCommit(infra.runtimeDb, sender, async (tx, capture) => {
        const token = (await repo.issueEmailVerification(tx, id, now()))!;
        capture({ to: `${id}@example.com`, subject: "Captured", text: token });
        expect(sender.sent).toEqual([]);
        return { id, token };
      }),
    ),
  );
  expect(sender.sent).toEqual([]);
  await ready[1]!.dispatch();
  expect(sender.sent).toEqual([{ to: `${ids[1]}@example.com`, subject: "Captured", text: ready[1]!.value.token }]);
  await Promise.all([ready[0]!.dispatch(), ready[0]!.dispatch()]);
  expect(sender.sent).toHaveLength(2);
  for (const operation of ready) expect(await consume(operation.value.token)).toBe(operation.value.id);
  const rollbackId = await seed();
  await expect(
    captureVerificationAfterCommit(infra.runtimeDb, sender, async (tx, capture) => {
      const token = (await repo.issueEmailVerification(tx, rollbackId, now()))!;
      capture({ to: `${rollbackId}@example.com`, subject: "Rollback", text: token });
      throw new Error("abort captured issuance");
    }),
  ).rejects.toThrow("abort captured issuance");
  expect(await states(rollbackId)).toEqual([]);
  expect(sender.sent).toHaveLength(2);
});

it("collector discards commit failure and suppresses provider errors with a fixed sanitized category", async () => {
  const sender = new FakeEmailSender();
  const diagnostic = vi.fn();
  const message = { to: "private@example.com", subject: "Private", text: "private-token" };
  const ready = await captureVerificationAfterCommit(
    infra.runtimeDb,
    sender,
    async (_tx, capture) => {
      capture(message);
      return 7;
    },
    diagnostic,
  );
  sender.failWith = new Error("private@example.com private-token provider details");
  await expect(ready.dispatch()).resolves.toBeUndefined();
  expect(diagnostic.mock.calls).toEqual([["verification-email-send-failed"]]);
  await infra.db.migratorDb.$client.query(`
    CREATE FUNCTION t0033_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'deferred commit failure'; END $$;
    CREATE CONSTRAINT TRIGGER t0033_commit_failure AFTER INSERT ON "user"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW.name = 'Fail commit') EXECUTE FUNCTION t0033_fail_commit();
  `);
  const id = randomUUID();
  let callbackReturned = false;
  try {
    await expect(
      captureVerificationAfterCommit(infra.runtimeDb, sender, async (tx, capture) => {
        await tx.insert(user).values({ id, email: `${id}@example.com`, name: "Fail commit" });
        await repo.issueEmailVerification(tx, id, now());
        capture(message);
        callbackReturned = true;
      }),
    ).rejects.toThrow();
    expect(callbackReturned).toBe(true);
    expect(await identity(id)).toBeUndefined();
    expect(await states(id)).toEqual([]);
  } finally {
    await infra.db.migratorDb.$client.query('DROP TRIGGER t0033_commit_failure ON "user"; DROP FUNCTION t0033_fail_commit()');
  }
  expect(sender.sent).toEqual([]);
});
