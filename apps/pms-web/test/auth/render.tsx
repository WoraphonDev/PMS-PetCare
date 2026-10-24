import { createApiClient } from "@app/api-client";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { createAppRouter } from "../../src/router";

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
export const noContent = () => new Response(null, { status: 204 });
export const apiError = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: "x", ...(details ? { details } : {}) } });

/** Renders the real router at `path` with a stubbed fetch; `responses` answer the requests in order. */
export function renderRoute(path: string, ...responses: Array<Response | Error>) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const r of responses) {
    if (r instanceof Error) fetch.mockRejectedValueOnce(r);
    else fetch.mockResolvedValueOnce(r);
  }
  const router = createAppRouter({
    queryClient: new QueryClient(),
    api: createApiClient({ baseUrl: "/api/v1", fetch }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  const request = (i: number) => {
    const [url, init] = fetch.mock.calls[i] ?? [];
    return { url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
  };
  return { fetch, router, request };
}
