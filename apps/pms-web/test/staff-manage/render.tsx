import { createApiClient } from "@app/api-client";
import type { MeResponse } from "@app/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRouteWithContext, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { useApi } from "../../src/features/auth/use-api";
import { useBranches } from "../../src/features/settings-branches/queries";
import { useStaff } from "../../src/features/staff/queries";
import { StaffRowActions } from "../../src/features/staff/staff-row-actions";
import { MemberRow } from "../../src/features/staff/staff-screen";
import { OrgProvider, useOrg } from "../../src/lib/org-context";
import { useMe } from "../../src/lib/session";
import { createQueryClient } from "../../src/query-client";
import type { RouterContext } from "../../src/router";
import { branch, second } from "../settings-branches/fixtures";
import { apiError, json, me, membership } from "../shell/render";
import { staff } from "../staff/fixtures";

export type Role = "owner" | "manager" | "front_desk" | "groomer" | "caretaker";
type Routes = Record<string, Response | Response[]>;

// The member rows of scr-staff with the T-0047 actions in MemberRow's slot, under the same `me` query and
// OrgProvider as the app shell (no membership → the shell's noOrg text).
function Rows() {
  const list = useStaff(true);
  const branches = useBranches(true).data?.items ?? [];
  return (
    <ul>
      {list.data?.members.map((m) => (
        <MemberRow key={m.membershipId} member={m} branches={branches} actions={<StaffRowActions member={m} branches={branches} />} />
      ))}
    </ul>
  );
}

function Shell() {
  const { membership } = useOrg();
  return membership ? <Rows /> : <p>noOrg</p>;
}

function Harness({ initial }: { initial: MeResponse }) {
  const me = useMe(useApi(), initial);
  return (
    <OrgProvider me={me}>
      <Shell />
    </OrgProvider>
  );
}

/** Rows as `role`; answers by `METHOD /path` like renderApp (the last response repeats, unrouted → 404). */
export async function openRows(routes: Routes = {}, role: Role = "owner") {
  const meValue = me({}, [membership({ role })]);
  const queues = new Map(
    Object.entries({
      "GET /me": json(200, meValue),
      "GET /staff": json(200, staff()),
      "GET /branches": json(200, { items: [branch(), second()] }),
      ...routes,
    }).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const queue = queues.get(`${init?.method ?? "GET"} ${String(url).replace("/api/v1", "")}`);
    const next = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    return next ? next.clone() : apiError(404, "NOT_FOUND");
  });
  const queryClient = createQueryClient();
  const api = createApiClient({ baseUrl: "/api/v1", fetch });
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Harness initial={meValue} />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    context: { queryClient, api },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as never} />);
  await screen.findByText("น้องเอ");
  // Branch names come from the branch list: wait for them so pickers can be used.
  await screen.findAllByText("สาขาหลัก, สาขาสอง");
  const calls = (key: string) =>
    fetch.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${String(url).replace("/api/v1", "")}` === key);
  const sent = (key: string, i = 0) => JSON.parse(String(calls(key)[i]?.[1]?.body));
  return { fetch, queryClient, calls, sent };
}

/** The <li> of the member shown as `name`. */
export const row = (name: string) => {
  const li = screen.getByText(name).closest("li");
  if (!li) throw new Error(`no row for ${name}`);
  return within(li);
};
