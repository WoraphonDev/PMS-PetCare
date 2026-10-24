import { ErrorCode, errorHttpStatus } from "@app/contracts";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, createApiClient, defineEndpoint } from "../src/index";

const Thing = z.object({ id: z.string(), count: z.number().int() });
const getThing = defineEndpoint({ method: "GET", path: "/things/{thingId}", response: Thing });
const listThings = defineEndpoint({ method: "GET", path: "/things", response: z.object({ items: z.array(Thing) }) });
const createThing = defineEndpoint({ method: "POST", path: "/things", response: Thing, body: z.object({ name: z.string() }) });
const putThing = defineEndpoint({ method: "PUT", path: "/things/{thingId}", response: Thing, body: z.object({ name: z.string() }) });
const patchThing = defineEndpoint({ method: "PATCH", path: "/things/{thingId}", response: Thing, body: z.object({ name: z.string() }) });
const deleteThing = defineEndpoint({ method: "DELETE", path: "/things/{thingId}", response: null });
const logout = defineEndpoint({ method: "POST", path: "/auth/logout", response: null });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(...responses: Array<Response | Error>) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const r of responses) {
    if (r instanceof Error) fetch.mockRejectedValueOnce(r);
    else fetch.mockResolvedValueOnce(r);
  }
  const api = createApiClient({ baseUrl: "https://pms.test/api/v1/", fetch });
  const call = (i = 0) => {
    const [url, init] = fetch.mock.calls[i] ?? [];
    return { url: String(url), init: init as RequestInit, headers: new Headers((init as RequestInit).headers) };
  };
  return { api, fetch, call };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("request", () => {
  it("joins the base URL, fills path params (encoded) and adds non-empty query keys", async () => {
    const { api, call } = setup(json(200, { id: "a", count: 1 }), json(200, { items: [] }));
    await api.request(getThing, { params: { thingId: "a b/c" } });
    expect(call(0).url).toBe("https://pms.test/api/v1/things/a%20b%2Fc");
    await api.request(listThings, { query: { q: "แมว", cursor: undefined, status: "active" } });
    expect(call(1).url).toBe("https://pms.test/api/v1/things?q=%E0%B9%81%E0%B8%A1%E0%B8%A7&status=active");
  });

  it("always sends credentials and Accept JSON; no body and no Content-Type without a body (T-0043-01 A)", async () => {
    const { api, call } = setup(json(200, { id: "a", count: 1 }), new Response(null, { status: 204 }));
    await api.request(getThing, { params: { thingId: "a" } });
    expect(call(0).init.method).toBe("GET");
    expect(call(0).init.credentials).toBe("include");
    expect(call(0).headers.get("accept")).toBe("application/json");
    expect(call(0).headers.has("content-type")).toBe(false);
    expect(call(0).init.body).toBeUndefined();
    await api.request(logout);
    expect(call(1).init.method).toBe("POST");
    expect(call(1).headers.has("content-type")).toBe(false);
    expect(call(1).init.body).toBeUndefined();
  });

  it.each([
    ["POST", createThing, {}],
    ["PUT", putThing, { params: { thingId: "a" } }],
    ["PATCH", patchThing, { params: { thingId: "a" } }],
  ] as const)("%s JSON-encodes the body with Content-Type JSON", async (method, endpoint, extra) => {
    const { api, call } = setup(json(200, { id: "a", count: 1 }));
    // One table drives three differently typed endpoints, so call through an untyped view of `request`.
    const request = api.request as (endpoint: unknown, input: unknown) => Promise<unknown>;
    await request(endpoint, { ...extra, body: { name: 'ร้าน "A"' } });
    expect(call().init.method).toBe(method);
    expect(call().headers.get("content-type")).toBe("application/json");
    expect(call().init.body).toBe('{"name":"ร้าน \\"A\\""}');
  });

  it("adds X-Org-Id only when orgId is given", async () => {
    const { api, call } = setup(json(200, { id: "a", count: 1 }), json(200, { id: "a", count: 1 }));
    await api.request(getThing, { params: { thingId: "a" }, orgId: "6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21" });
    expect(call(0).headers.get("x-org-id")).toBe("6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21");
    await api.request(getThing, { params: { thingId: "a" } });
    expect(call(1).headers.has("x-org-id")).toBe(false);
  });

  it("returns data parsed by the response schema (unknown keys stripped by the contract)", async () => {
    const { api } = setup(json(200, { id: "a", count: 2, extra: "x" }));
    await expect(api.request(getThing, { params: { thingId: "a" } })).resolves.toEqual({ id: "a", count: 2 });
  });

  it("204 → undefined for an endpoint without a response body", async () => {
    const { api } = setup(new Response(null, { status: 204 }));
    await expect(api.request(deleteThing, { params: { thingId: "a" } })).resolves.toBeUndefined();
  });

  it("2xx body that fails the response schema → ApiError INTERNAL, data never returned", async () => {
    const { api } = setup(json(200, { id: "a", count: "2" }));
    const e = await rejection(api.request(getThing, { params: { thingId: "a" } }));
    expect(e.code).toBe("INTERNAL");
    expect(e.status).toBe(200);
  });

  it("2xx without a body where one is expected (204 or non-JSON) → INTERNAL", async () => {
    const { api } = setup(new Response(null, { status: 204 }), new Response("<html>ok</html>", { status: 200 }));
    expect((await rejection(api.request(getThing, { params: { thingId: "a" } }))).code).toBe("INTERNAL");
    expect((await rejection(api.request(getThing, { params: { thingId: "a" } }))).code).toBe("INTERNAL");
  });

  it.each(ErrorCode.options)("error envelope %s → ApiError with that code, status, message and details", async (code) => {
    const status = errorHttpStatus[code];
    const details = { fields: { name: ["Required"] } };
    const { api } = setup(json(status, { error: { code, message: "Something", details } }));
    const e = await rejection(api.request(createThing, { body: { name: "x" } }));
    expect(e).toMatchObject({ code, status, message: "Something", details });
  });

  it("error envelope without details → details undefined", async () => {
    const { api } = setup(json(404, { error: { code: "NOT_FOUND", message: "Not found" } }));
    const e = await rejection(api.request(getThing, { params: { thingId: "a" } }));
    expect(e).toMatchObject({ code: "NOT_FOUND", status: 404, details: undefined });
  });

  it("non-JSON error body (an HTML page) or an unknown envelope → INTERNAL with the HTTP status", async () => {
    const { api } = setup(
      new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
      json(418, { error: { code: "TEAPOT", message: "x" } }),
    );
    expect(await rejection(api.request(getThing, { params: { thingId: "a" } }))).toMatchObject({ code: "INTERNAL", status: 502 });
    expect(await rejection(api.request(getThing, { params: { thingId: "a" } }))).toMatchObject({ code: "INTERNAL", status: 418 });
  });

  it("fetch rejects (offline, CORS, DNS) → INTERNAL with status 0", async () => {
    const { api } = setup(new TypeError("Failed to fetch"));
    expect(await rejection(api.request(getThing, { params: { thingId: "a" } }))).toMatchObject({ code: "INTERNAL", status: 0 });
  });

  it("uses the global fetch when none is given", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { id: "a", count: 1 }));
    try {
      const api = createApiClient({ baseUrl: "/api/v1" });
      await expect(api.request(getThing, { params: { thingId: "a" } })).resolves.toEqual({ id: "a", count: 1 });
      expect(String(spy.mock.calls[0]?.[0])).toBe("/api/v1/things/a");
    } finally {
      spy.mockRestore();
    }
  });

  it("types params and body from the descriptor (compile-time)", () => {
    const { api } = setup();
    const typeChecks = () => {
      expectTypeOf(api.request(getThing, { params: { thingId: "a" } })).resolves.toEqualTypeOf<{ id: string; count: number }>();
      expectTypeOf(api.request(deleteThing, { params: { thingId: "a" } })).resolves.toEqualTypeOf<undefined>();
      // @ts-expect-error path param missing
      void api.request(getThing);
      // @ts-expect-error wrong path param name
      void api.request(getThing, { params: { id: "a" } });
      // @ts-expect-error body required
      void api.request(createThing, {});
      // @ts-expect-error body of the wrong shape
      void api.request(createThing, { body: { title: "x" } });
      // @ts-expect-error GET endpoint takes no body
      void api.request(listThings, { body: { name: "x" } });
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});
