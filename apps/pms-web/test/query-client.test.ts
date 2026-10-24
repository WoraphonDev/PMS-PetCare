import { ApiError } from "@app/api-client";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "../src/query-client";

describe("createQueryClient", () => {
  const client = createQueryClient();
  const retry = client.getDefaultOptions().queries?.retry as (count: number, error: unknown) => boolean;

  it("retries a query once on network/server errors", () => {
    expect(retry(0, new ApiError(0, "INTERNAL", "Network error"))).toBe(true);
    expect(retry(0, new ApiError(500, "INTERNAL", "x"))).toBe(true);
    expect(retry(1, new ApiError(500, "INTERNAL", "x"))).toBe(false);
  });

  it("never retries a 4xx ApiError", () => {
    for (const status of [400, 401, 403, 404, 409, 423, 429]) expect(retry(0, new ApiError(status, "FORBIDDEN", "x"))).toBe(false);
  });

  it("never retries mutations", () => {
    expect(client.getDefaultOptions().mutations?.retry).toBe(0);
  });
});
