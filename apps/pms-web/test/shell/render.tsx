import { createApiClient } from "@app/api-client";
import type { MeResponse } from "@app/contracts";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRouteWithContext, createRouter, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { OrgProvider } from "../../src/lib/org-context";
import { createQueryClient } from "../../src/query-client";
import { createAppRouter, type RouterContext } from "../../src/router";

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
export const apiError = (status: number, code: string) => json(status, { error: { code, message: "x" } });

export const ORG_A = "6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21";
export const ORG_B = "7a2d1f9f-3a5c-4c9f-8b62-1e4d0c2b8f32";
export const BRANCH_1 = "8a0b5c1d-3e2f-4a6b-8c7d-9e0f1a2b3c4d";
export const BRANCH_2 = "9b1c6d2e-4f3a-4b7c-9d8e-0f1a2b3c4d5e";
export const USER = "0b6f8f0e-6d8a-4f0f-9a3e-3c1f3b6f2a10";

type Membership = MeResponse["memberships"][number];
export const membership = (over: Partial<Membership> & { orgId?: string; name?: string } = {}): Membership => ({
  org: { id: over.orgId ?? ORG_A, slug: "shop", displayName: over.name ?? "Happy Paws", status: "active" },
  role: "owner",
  branches: [{ id: BRANCH_1, name: "สาขาหลัก" }],
  ...over,
});

export const me = (over: Partial<MeResponse["user"]> = {}, memberships: Membership[] = [membership()]): MeResponse => ({
  user: {
    id: USER,
    name: "สมชาย",
    email: "owner@example.com",
    username: null,
    isPlatformAdmin: false,
    mustChangePassword: false,
    twoFactorEnabled: false,
    ...over,
  },
  memberships,
});

/** Answers by `METHOD /path` (base URL stripped); the last response for a route repeats. Unrouted → 404. */
export function renderApp(path: string, routes: Record<string, Response | Array<Response>> = {}, queryClient?: QueryClient) {
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace("/api/v1", "").split("?")[0]}`;
    const queue = queues.get(key);
    const next = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    return next ? next.clone() : apiError(404, "NOT_FOUND");
  });
  const client = queryClient ?? createQueryClient();
  const api = createApiClient({ baseUrl: "/api/v1", fetch });
  const router = createAppRouter({ queryClient: client, api, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  const calls = (key: string) =>
    fetch.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${String(url).replace("/api/v1", "")}` === key);
  const headers = (i: number) => new Headers(fetch.mock.calls[i]?.[1]?.headers);
  return { fetch, router, queryClient: client, api, calls, headers, pathname: () => router.state.location.pathname };
}

/** Renders `children` inside a bare router (same context shape as the app) and the real <OrgProvider>. */
export function renderInOrg(meValue: MeResponse, children: ReactNode, fetch = vi.fn<typeof globalThis.fetch>()) {
  const queryClient = createQueryClient();
  const api = createApiClient({ baseUrl: "/api/v1", fetch });
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <OrgProvider me={meValue}>{children}</OrgProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    context: { queryClient, api },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as never} />);
  return { fetch, queryClient, api };
}
