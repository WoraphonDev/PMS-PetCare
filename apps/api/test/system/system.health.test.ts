import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodBody } from "../../src/common/zod.pipe";
import { bootTestApp } from "../support/app";

const Probe = z.object({ name: z.string().min(1), count: z.number().int() });

@Controller("__test")
class ProbeController {
  @Post("echo")
  echo(@Body(new ZodBody(Probe)) body: z.infer<typeof Probe>) {
    return body;
  }

  @Get("boom")
  boom(): never {
    throw new Error("secret detail");
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await bootTestApp([ProbeModule]);
});

afterAll(async () => {
  await app?.close();
});

describe("system.health", () => {
  it("GET /api/v1/health → 200 { status, version }", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "test-sha" });
  });
});

describe("error envelope", () => {
  it("unknown route → 404 NOT_FOUND", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND", message: expect.any(String) } });
  });

  it("body failing the zod schema → 400 VALIDATION_FAILED with details.fields", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/__test/echo", payload: { name: "", count: 1.5 } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(body.error.details.fields).sort()).toEqual(["count", "name"]);
  });

  it("malformed JSON → 400 VALIDATION_FAILED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/__test/echo",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("valid body passes through", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/__test/echo", payload: { name: "a", count: 2 } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ name: "a", count: 2 });
  });

  it("unexpected exception → 500 INTERNAL without leaking the message", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/__test/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: "INTERNAL" } });
    expect(res.body).not.toContain("secret detail");
  });
});

describe("request id", () => {
  it("generates x-request-id when absent", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("echoes a well-formed incoming X-Request-Id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health", headers: { "x-request-id": "abc-123_XYZ.9" } });
    expect(res.headers["x-request-id"]).toBe("abc-123_XYZ.9");
  });

  it("replaces a malformed incoming X-Request-Id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health", headers: { "x-request-id": "bad id\twith spaces" } });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is present on error responses too", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});

describe("security headers", () => {
  it("sets helmet headers and hides x-powered-by", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows CORS only for APP_ORIGIN", async () => {
    const ok = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/health",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "GET" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(ok.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    const bad = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/health",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
