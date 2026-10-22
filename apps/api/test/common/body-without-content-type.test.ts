import { Readable } from "node:stream";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closuresOf, expectError, insertClosureRow, seedHours } from "../org/support";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

// T-0040 / T-0013-01: a DELETE body without content-type reaches the route, so #contract-branch-schedule-common decides.
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

/** What main returns when Fastify rejects a body before routing (error.filter HttpException branch). */
const REJECTED = { error: { code: "VALIDATION_FAILED", message: "Request rejected" } };

async function seeded() {
  const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  await seedHours(infra, s.orgId, s.branchIds);
  const closureId = await insertClosureRow(infra, s.orgId, s.branchIds[0]!, "2026-01-01", "2026-01-01");
  return { ...s, url: `/api/v1/branches/${s.branchIds[0]}/closures/${closureId}` };
}

/** `app.inject` adds no content-type for string or stream payloads, so these requests arrive without one. */
function raw(method: "DELETE" | "POST" | "PUT", url: string, headers: Record<string, string>, payload: string | Readable) {
  return app.inject({ method, url, headers, payload });
}

function withoutContentType(headers: Record<string, string>, extra: Record<string, string>) {
  expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
  return { ...headers, ...extra };
}

describe("DELETE body without content-type reaches the route", () => {
  it("content-length: 1 → VALIDATION_FAILED at `_`, nothing deleted", async () => {
    const s = await seeded();
    const res = await raw("DELETE", s.url, withoutContentType(s.headers, { "content-length": "1" }), "x");
    const error = await expectError(res, 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: { _: expect.any(Array) } });
    expect(await closuresOf(infra, s.orgId)).toHaveLength(1);
  });

  it("empty chunked body → 204 and the closure is deleted", async () => {
    const s = await seeded();
    const res = await raw("DELETE", s.url, withoutContentType(s.headers, { "transfer-encoding": "chunked" }), Readable.from([]));
    expect(res.statusCode, res.body).toBe(204);
    expect(await closuresOf(infra, s.orgId)).toEqual([]);
  });

  it("nonempty chunked body → VALIDATION_FAILED at `_`, nothing deleted", async () => {
    const s = await seeded();
    const res = await raw("DELETE", s.url, withoutContentType(s.headers, { "transfer-encoding": "chunked" }), Readable.from(["x"]));
    const error = await expectError(res, 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: { _: expect.any(Array) } });
    expect(await closuresOf(infra, s.orgId)).toHaveLength(1);
  });

  it("an unknown content-type with a body is unchanged from main: 415 → VALIDATION_FAILED without details", async () => {
    const s = await seeded();
    const res = await raw("DELETE", s.url, { ...s.headers, "content-type": "application/x-unknown" }, "x");
    expect(res.json()).toStrictEqual(REJECTED);
    expect(await closuresOf(infra, s.orgId)).toHaveLength(1);
  });

  it("a body over bodyLimit is rejected as on main (413 → VALIDATION_FAILED without details), nothing deleted", async () => {
    const s = await seeded();
    const big = "x".repeat(1024 * 1024 + 1);
    for (const chunked of [false, true]) {
      const extra: Record<string, string> = chunked ? { "transfer-encoding": "chunked" } : { "content-length": String(big.length) };
      const payload = chunked ? Readable.from([big.slice(0, 1024 * 1024), big.slice(1024 * 1024)]) : big;
      const res = await raw("DELETE", s.url, withoutContentType(s.headers, extra), payload);
      expect(res.statusCode, `chunked=${chunked}`).toBe(400);
      expect(res.json(), `chunked=${chunked}`).toStrictEqual(REJECTED);
    }
    expect(await closuresOf(infra, s.orgId)).toHaveLength(1);
  });
});

// Recorded on main before T-0040: Fastify rejects these before routing (no parser for a missing content-type).
describe("POST/PUT bodies without content-type keep main's response", () => {
  it("POST /branches/{id}/closures → 400 VALIDATION_FAILED without details, nothing created", async () => {
    const s = await seeded();
    const body = JSON.stringify({ startDate: "2026-02-01", endDate: "2026-02-01" });
    const res = await raw("POST", `/api/v1/branches/${s.branchIds[0]}/closures`, withoutContentType(s.headers, {}), body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toStrictEqual(REJECTED);
    expect(await closuresOf(infra, s.orgId)).toHaveLength(1);
  });

  it("PUT /branches/{id}/hours → 400 VALIDATION_FAILED without details", async () => {
    const s = await seeded();
    const res = await raw("PUT", `/api/v1/branches/${s.branchIds[0]}/hours`, withoutContentType(s.headers, {}), "{}");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toStrictEqual(REJECTED);
  });
});
