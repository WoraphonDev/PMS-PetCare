import { randomUUID } from "node:crypto";
import { Branch, BranchListResponse } from "@app/contracts";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import {
  auditOf,
  branchRow,
  call,
  expectError,
  expectGuardErrors,
  expectUnknownKeysRejected,
  FIXED_NOW,
  outboxOf,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#ep-branch.payment_settings.update · #contract-branch-payment-settings ·
// #rule-branch-promptpay-format · #rule-branch-payment-settings-write · #rule-branch-payment-settings-audit ·
// #rule-branch-version · #rule-branch-outbox · §6 · §8 (manager has branch.update but not this permission)
const fail = vi.hoisted(() => ({ audit: false, update: false }));
vi.mock("@app/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@app/db")>();
  return {
    ...original,
    writeAudit: async (...args: Parameters<typeof original.writeAudit>) => {
      if (fail.audit) throw new Error("forced audit failure");
      return original.writeAudit(...args);
    },
    // A real failing UPDATE (unknown column) so drizzle builds its DrizzleQueryError with the query params.
    transactionQuery: (tx: Parameters<typeof original.transactionQuery>[0]) => {
      const query = original.transactionQuery(tx);
      return (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (!fail.update || !strings.join("").includes("promptpay_id =")) return query(strings, ...values);
        const broken = Object.assign(
          strings.map((s) => s.replace("promptpay_id =", "promptpay_id_missing =")),
          { raw: strings.raw },
        ) as unknown as TemplateStringsArray;
        return query(broken, ...values);
      };
    },
  };
});

const logs: string[] = [];
let spies: MockInstance[] = [];
let infra: TestInfra;
let app: NestFastifyApplication;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], { write: (line) => logs.push(line) }, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(FIXED_NOW));
  spies = [
    ...(["log", "error", "warn", "debug", "verbose"] as const).map((m) => vi.spyOn(Logger.prototype, m)),
    ...(["log", "error", "warn"] as const).map((m) => vi.spyOn(console, m)),
  ];
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});
beforeEach(() => {
  logs.length = 0;
  for (const spy of spies) spy.mockClear();
});

const MOBILE = "0812345678";
const MOBILE_2 = "0898765432";
const TAX_ID = "0994000617721"; // valid per T-0014-02 vectors
const BAD_CHECKSUM = "1234545678789"; // InvalidChecksum per T-0014-02 vectors

const put = (headers: Record<string, string>, id: string, body: unknown) =>
  call(app, "PUT", `/branches/${id}/payment-settings`, headers, body);
const set = (headers: Record<string, string>, id: string, promptpayId: string | null) => put(headers, id, { promptpayId });
async function seeded(promptpayId: string | null = null) {
  const s = await seedOrg(app, infra, { role: "owner", branches: ["A", "B"] });
  if (promptpayId !== null) {
    await infra.platformDb.$client.query("update branch set promptpay_id = $1 where org_id = $2", [promptpayId, s.orgId]);
  }
  return s;
}

/** Every application log channel captured since the test started (pino stream, Nest Logger, console). */
const captured = () => [...logs, ...spies.flatMap((spy) => spy.mock.calls.map((args) => JSON.stringify(args)))].join("\n");
function expectNoLeak(...values: string[]) {
  const all = captured();
  for (const value of values) expect(all, value).not.toContain(value);
}
function expectInternalLogged(res: { headers: Record<string, unknown> }) {
  const reqId = res.headers["x-request-id"];
  const entry = logs.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.msg === "unexpected error" && l.reqId === reqId);
  expect(entry).toBeDefined();
}
async function expectUnchanged(orgId: string, id: string, before: Awaited<ReturnType<typeof branchRow>>, auditCount = 0) {
  expect(await branchRow(infra, id)).toEqual(before);
  expect(await auditOf(infra, orgId)).toHaveLength(auditCount);
  expect(await outboxOf(infra, orgId)).toEqual([]);
}

describe("owner sets, replaces and clears the PromptPay ID", () => {
  it("returns 200 Branch with the real value, bumps version, sets updated_at = now, writes a masked audit and no outbox", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const initial = await branchRow(infra, id);

    const steps: Array<[input: string | null, stored: string | null, before: string | null, after: string | null]> = [
      [` ${MOBILE} `, MOBILE, null, "******5678"],
      [TAX_ID, TAX_ID, "******5678", "*********7721"],
      [null, null, "*********7721", null],
    ];
    for (const [i, [input, stored, before, after]] of steps.entries()) {
      const res = await set(s.headers, id, input);
      expect(res.statusCode, res.body).toBe(200);
      const dto = Branch.parse(res.json());
      expect(dto).toEqual({
        id,
        name: "A",
        address: null,
        phone: null,
        latitude: null,
        longitude: null,
        timezone: "Asia/Bangkok",
        promptpayId: stored,
        isActive: true,
        version: i + 2,
        createdAt: initial.createdAt.toISOString(),
        updatedAt: FIXED_NOW.toISOString(),
      });
      const row = await branchRow(infra, id);
      expect(row).toMatchObject({ promptpayId: stored, version: i + 2, updatedAt: FIXED_NOW });
      const list = BranchListResponse.parse((await call(app, "GET", "/branches", s.headers)).json());
      expect(list.items.find((b) => b.id === id)).toEqual(dto);

      const audit = await auditOf(infra, s.orgId);
      expect(audit).toHaveLength(i + 1);
      // Every row has occurredAt = FIXED_NOW, so find this step's row by content rather than by order.
      const entry = audit.find(
        (a) => JSON.stringify([a.before, a.after]) === JSON.stringify([{ promptpayId: before }, { promptpayId: after }]),
      );
      expect(entry).toMatchObject({
        orgId: s.orgId,
        action: "branch.payment_settings_updated",
        actorUserId: s.userId,
        entityType: "branch",
        entityId: id,
        occurredAt: FIXED_NOW,
        before: { promptpayId: before },
        after: { promptpayId: after },
      });
      expect(Object.keys(entry!.before!)).toEqual(["promptpayId"]);
      expect(Object.keys(entry!.after!)).toEqual(["promptpayId"]);
    }
    const payloads = JSON.stringify((await auditOf(infra, s.orgId)).map((a) => [a.before, a.after]));
    expect(payloads).not.toContain(MOBILE);
    expect(payloads).not.toContain(TAX_ID);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
    // The other branch is untouched.
    expect(await branchRow(infra, s.branchIds[1]!)).toMatchObject({ promptpayId: null, version: 1 });
    expectNoLeak(MOBILE, TAX_ID);
  });

  it("masks 13 → 10 replacements on both sides", async () => {
    const s = await seeded(TAX_ID);
    const id = s.branchIds[0]!;
    expect((await set(s.headers, id, MOBILE_2)).statusCode).toBe(200);
    const audit = await auditOf(infra, s.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ before: { promptpayId: "*********7721" }, after: { promptpayId: "******5432" } });
    expect(JSON.stringify([audit[0]!.before, audit[0]!.after])).not.toMatch(new RegExp(`${TAX_ID}|${MOBILE_2}`));
    expectNoLeak(TAX_ID, MOBILE_2);
  });

  it("treats the stored value (also with surrounding whitespace) and null → null as a no-op", async () => {
    for (const [stored, input] of [
      [MOBILE, MOBILE],
      [MOBILE, `\t${MOBILE}  `],
      [TAX_ID, TAX_ID],
      [null, null],
    ] as const) {
      const s = await seeded(stored);
      const id = s.branchIds[0]!;
      const before = await branchRow(infra, id);
      const res = await set(s.headers, id, input);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ promptpayId: stored, version: 1, updatedAt: before.updatedAt.toISOString() });
      await expectUnchanged(s.orgId, id, before);
    }
    expectNoLeak(MOBILE, TAX_ID);
  });
});

describe("rejections leave the branch unchanged", () => {
  it("rejects every F08 failure at details.fields.promptpayId without echoing or logging the value", async () => {
    const s = await seeded(MOBILE);
    const id = s.branchIds[0]!;
    const before = await branchRow(infra, id);
    const invalid = [
      BAD_CHECKSUM,
      "0994000617723",
      "081234567",
      "08123456789",
      "1812345678",
      "123454567878",
      "12345456787811",
      "08123456ab",
      "081-234-5678",
      "081 234 5678",
      "0-99-4-000-61772-1",
      "+66812345678",
      "",
      "   ",
    ];
    for (const value of invalid) {
      const res = await set(s.headers, id, value);
      const error = await expectError(res, 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), value).toEqual(["promptpayId"]);
      if (value.trim() !== "") expect(res.body, value).not.toContain(value);
    }
    await expectUnchanged(s.orgId, id, before);
    expectNoLeak(MOBILE, BAD_CHECKSUM, "0994000617723", "081-234-5678", "+66812345678");
  });

  it("rejects a missing key, other keys and wrong types with details.fields.<key>", async () => {
    const s = await seeded(MOBILE);
    const id = s.branchIds[0]!;
    const before = await branchRow(infra, id);
    const cases: Array<[unknown, string]> = [
      [{}, "promptpayId"],
      [{ promptpayId: 812345678 }, "promptpayId"],
      [{ promptpayId: true }, "promptpayId"],
      [{ promptpayId: MOBILE_2, version: 9 }, "version"],
      [{ promptpayId: MOBILE_2, name: "x" }, "name"],
      [{ promptpayId: MOBILE_2, orgId: randomUUID() }, "orgId"],
      [{ promptpayId: MOBILE_2, id: randomUUID() }, "id"],
      [[{ promptpayId: MOBILE_2 }], "_"],
      [42, "_"],
    ];
    for (const [body, field] of cases) {
      const error = await expectError(await put(s.headers, id, body), 400, "VALIDATION_FAILED");
      expect(error.details, JSON.stringify(body)).toMatchObject({ fields: { [field]: expect.any(Array) } });
    }
    await expectUnknownKeysRejected((body) => put(s.headers, id, body), { promptpayId: MOBILE_2 });
    await expectUnchanged(s.orgId, id, before);
  });

  it("denies manager and branch roles", async () => {
    for (const role of ["manager", "front_desk", "groomer", "caretaker"] as const) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      const id = s.branchIds[0]!;
      const before = await branchRow(infra, id);
      await expectError(await set(s.headers, id, MOBILE), 403, "FORBIDDEN");
      await expectUnchanged(s.orgId, id, before);
    }
  });

  it("returns NOT_FOUND for another organization's branch or an absent id, and VALIDATION_FAILED for a non-UUID", async () => {
    const s = await seeded();
    const other = await seeded(MOBILE);
    const before = await branchRow(infra, other.branchIds[0]!);
    await expectError(await set(s.headers, other.branchIds[0]!, MOBILE_2), 404, "NOT_FOUND");
    await expectError(await set(s.headers, randomUUID(), MOBILE_2), 404, "NOT_FOUND");
    const error = await expectError(await set(s.headers, "not-a-uuid", MOBILE_2), 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: expect.any(Object) });
    await expectUnchanged(other.orgId, other.branchIds[0]!, before);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await seeded();
    await suspend(infra, s.orgId);
    const before = await branchRow(infra, s.branchIds[0]!);
    await expectError(await set(s.headers, s.branchIds[0]!, MOBILE), 423, "ORG_SUSPENDED");
    await expectUnchanged(s.orgId, s.branchIds[0]!, before);
  });

  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "PUT", `/branches/${randomUUID()}/payment-settings`, { promptpayId: MOBILE });
  });

  it("still rejects promptpayId on branch.update", async () => {
    const s = await seeded();
    const before = await branchRow(infra, s.branchIds[0]!);
    const error = await expectError(
      await call(app, "PATCH", `/branches/${s.branchIds[0]}`, s.headers, { promptpayId: MOBILE }),
      400,
      "VALIDATION_FAILED",
    );
    expect(error.details).toMatchObject({ fields: { promptpayId: expect.any(Array) } });
    await expectUnchanged(s.orgId, s.branchIds[0]!, before);
  });
});

describe("failures roll back and log nothing sensitive", () => {
  for (const which of ["audit", "update"] as const) {
    it(`a failing ${which === "audit" ? "audit insert" : "UPDATE"} → INTERNAL, no change, value absent from logs`, async () => {
      const s = await seeded(MOBILE);
      const id = s.branchIds[0]!;
      const before = await branchRow(infra, id);
      fail[which] = true;
      let res: Awaited<ReturnType<typeof set>>;
      try {
        res = await set(s.headers, id, TAX_ID);
      } finally {
        fail[which] = false;
      }
      await expectError(res, 500, "INTERNAL");
      expect(res.body).not.toContain(TAX_ID);
      expect(res.body).not.toContain(MOBILE);
      await expectUnchanged(s.orgId, id, before);
      expectInternalLogged(res);
      expectNoLeak(MOBILE, TAX_ID);
    });
  }
});

describe("concurrency with branch.update", () => {
  it("gives both writes distinct consecutive versions; branch.updated never carries promptpayId", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const [payment, patch] = await Promise.all([
      set(s.headers, id, MOBILE),
      call(app, "PATCH", `/branches/${id}`, s.headers, { phone: "02" }),
    ]);
    expect([payment.statusCode, patch.statusCode]).toEqual([200, 200]);
    expect([payment.json().version, patch.json().version].sort()).toEqual([2, 3]);
    expect(await branchRow(infra, id)).toMatchObject({ promptpayId: MOBILE, phone: "02", version: 3 });
    const outbox = await outboxOf(infra, s.orgId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: "branch.updated", aggregateVersion: patch.json().version });
    expect(outbox[0]!.payload).not.toHaveProperty("promptpayId");
    expect((outbox[0]!.payload as { changedFields: string[] }).changedFields).toEqual(["phone"]);
    expect(JSON.stringify(outbox[0]!.payload)).not.toContain(MOBILE);
    const audit = await auditOf(infra, s.orgId);
    expect(audit.map((a) => a.action).sort()).toEqual(["branch.payment_settings_updated", "branch.updated"]);
  });
});
