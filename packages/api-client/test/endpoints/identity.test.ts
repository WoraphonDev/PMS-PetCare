import type { MeResponse } from "@app/contracts";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createApiClient, meGet } from "../../src/index";

const me: MeResponse = {
  user: {
    id: "0b6f8f0e-6d8a-4f0f-9a3e-3c1f3b6f2a10",
    name: "สมชาย",
    email: "owner@example.com",
    username: null,
    isPlatformAdmin: false,
    mustChangePassword: false,
    twoFactorEnabled: false,
  },
  memberships: [
    {
      org: { id: "6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21", slug: "happy-paws", displayName: "Happy Paws", status: "active" },
      role: "owner",
      branches: [{ id: "8a0b5c1d-3e2f-4a6b-8c7d-9e0f1a2b3c4d", name: "สาขาหลัก" }],
    },
  ],
};

describe("me.get (foundation#ep-me.get)", () => {
  it("GET {baseUrl}/me with credentials and Accept JSON → parsed MeResponse", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(me), { status: 200 }));
    const api = createApiClient({ baseUrl: "/api/v1", fetch });

    const result = await api.request(meGet);

    expect(result).toEqual(me);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/me");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(init?.body).toBeUndefined();
  });

  it("is typed from the contract: resolves to MeResponse and takes no params or body", () => {
    const api = createApiClient({ baseUrl: "/api/v1", fetch: vi.fn() });
    // Type-level only: the closure is never called, so no request is made.
    const typeChecks = () => {
      expectTypeOf(api.request(meGet)).resolves.toEqualTypeOf<MeResponse>();
      // @ts-expect-error me.get has no body
      void api.request(meGet, { body: { x: 1 } });
      // @ts-expect-error me.get has no path params
      void api.request(meGet, { params: { id: "x" } });
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});
