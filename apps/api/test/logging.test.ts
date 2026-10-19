import { Controller, Get, Module } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { bootTestApp } from "./support/app";

@Controller("__log")
class LogProbeController {
  @Get("boom")
  boom(): never {
    throw new Error("secret detail");
  }

  @Get("zod")
  zod(): never {
    z.object({ name: z.string() }).parse({});
    throw new Error("unreachable");
  }
}

@Module({ controllers: [LogProbeController] })
class LogProbeModule {}

const lines: string[] = [];
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await bootTestApp([LogProbeModule], { write: (line) => lines.push(line) });
});

afterAll(async () => {
  await app?.close();
});

const logs = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe("logging", () => {
  it("logs unexpected errors with the response's request id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/__log/boom" });
    const reqId = res.headers["x-request-id"];
    const entry = logs().find((l) => l.msg === "unexpected error" && l.reqId === reqId);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).toContain("secret detail"); // full detail stays server-side
    expect(res.body).not.toContain("secret detail");
  });

  it("never logs query strings (tokens)", async () => {
    await app.inject({ method: "GET", url: "/api/v1/health?token=tok-SECRET-123&x=1" });
    expect(lines.join("\n")).not.toContain("tok-SECRET-123");
    expect(logs().some((l) => JSON.stringify(l).includes("/api/v1/health?[REDACTED]"))).toBe(true);
  });

  it("redacts authorization and cookie headers", async () => {
    await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { authorization: "Bearer abc-SECRET", cookie: "sid=cookie-SECRET" },
    });
    expect(lines.join("\n")).not.toMatch(/abc-SECRET|cookie-SECRET/);
  });

  it("a ZodError thrown directly → 400 VALIDATION_FAILED with details.fields (not 500)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/__log/zod" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { fields: { name: expect.any(Array) } } } });
  });
});
