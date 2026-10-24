import { authLogin, defineEndpoint, meGet } from "@app/api-client";
import { useQuery } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { th } from "../../src/i18n/th";
import { resolveContext, useOrg, useOrgApi } from "../../src/lib/org-context";
import { BRANCH_1, BRANCH_2, json, me, membership, ORG_A, ORG_B, renderApp, renderInOrg, USER } from "./render";

const twoShops = () =>
  me({}, [
    membership({
      name: "Shop A",
      branches: [
        { id: BRANCH_1, name: "B1" },
        { id: BRANCH_2, name: "B2" },
      ],
    }),
    membership({ orgId: ORG_B, name: "Shop B", role: "groomer" }),
  ]);
const orgThing = defineEndpoint({ method: "GET", path: "/org-thing", response: null });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolveContext (foundation#scr-org-switcher)", () => {
  it("remembered org used while still a member; remembered branch used while in it", () => {
    const r = resolveContext(twoShops(), { orgId: ORG_A, branchId: BRANCH_2 });
    expect(r.membership?.org.id).toBe(ORG_A);
    expect(r.branch?.id).toBe(BRANCH_2);
  });

  it("removed org → first membership; unknown branch → first branch", () => {
    const r = resolveContext(twoShops(), { orgId: "gone", branchId: "gone" });
    expect(r.membership?.org.id).toBe(ORG_A);
    expect(r.branch?.id).toBe(BRANCH_1);
  });

  it("membership without branches → branch null; no membership → both null", () => {
    expect(resolveContext(me({}, [membership({ branches: [] })]), {}).branch).toBeNull();
    expect(resolveContext(me({}, []), {})).toEqual({ membership: null, branch: null });
  });
});

describe("remembered context", () => {
  it("is read per user from pms.ctx.<userId>", async () => {
    localStorage.setItem(`pms.ctx.${USER}`, JSON.stringify({ orgId: ORG_B }));
    localStorage.setItem("pms.ctx.someone-else", JSON.stringify({ orgId: ORG_A }));
    renderApp("/", { "GET /me": json(200, twoShops()) });
    expect(await screen.findByRole("heading", { name: "Shop B" })).toBeInTheDocument();
  });

  it("switching shop and branch is remembered for that user", async () => {
    renderApp("/", { "GET /me": json(200, twoShops()) });
    await screen.findByRole("heading", { name: "Shop A" });
    fireEvent.change(screen.getByLabelText(th["scr-org-switcher"].branch), { target: { value: BRANCH_2 } });
    expect(JSON.parse(localStorage.getItem(`pms.ctx.${USER}`) ?? "")).toEqual({ orgId: ORG_A, branchId: BRANCH_2 });
    fireEvent.click(screen.getByRole("button", { name: "Shop B" }));
    expect(await screen.findByRole("heading", { name: "Shop B" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(`pms.ctx.${USER}`) ?? "")).toEqual({ orgId: ORG_B });
  });

  it("localStorage throwing → still works with the first membership", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderApp("/", { "GET /me": json(200, twoShops()) });
    await screen.findByRole("heading", { name: "Shop A" });
    fireEvent.click(screen.getByRole("button", { name: "Shop B" }));
    expect(await screen.findByRole("heading", { name: "Shop B" })).toBeInTheDocument();
  });

  it("branch picker hidden when the membership has ≤ 1 branch", async () => {
    renderApp("/", { "GET /me": json(200, me()) });
    await screen.findByRole("heading", { name: "Happy Paws" });
    expect(screen.queryByLabelText(th["scr-org-switcher"].branch)).not.toBeInTheDocument();
  });
});

describe("X-Org-Id and org switching", () => {
  function Probe() {
    const org = useOrgApi();
    const { selectOrg } = useOrg();
    const q = useQuery(org.queryOptions(["org-thing", org.orgId], () => org.request(orgThing).then(() => org.orgId)));
    return (
      <>
        <p>data:{q.data}</p>
        <button type="button" onClick={() => selectOrg(ORG_B)}>
          to-b
        </button>
      </>
    );
  }

  it("an org-scoped request carries the current org; me.get / auth.* do not", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    const { api } = renderInOrg(twoShops(), <Probe />, fetch);
    await screen.findByText(`data:${ORG_A}`);
    await api.request(meGet).catch(() => undefined);
    await api.request(authLogin, { body: { identifier: "a", password: "b" } }).catch(() => undefined);
    const orgIds = fetch.mock.calls.map(([url, init]) => [String(url), new Headers(init?.headers).get("x-org-id")]);
    expect(orgIds).toEqual([
      ["/api/v1/org-thing", ORG_A],
      ["/api/v1/me", null],
      ["/api/v1/auth/login", null],
    ]);
  });

  it("switching org removes org-scoped cached data; ['me'] stays", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    const { queryClient } = renderInOrg(twoShops(), <Probe />, fetch);
    await screen.findByText(`data:${ORG_A}`);
    queryClient.setQueryData(["me"], twoShops());
    queryClient.setQueryData(["other", ORG_A], "secret");
    act(() => screen.getByRole("button", { name: "to-b" }).click());
    expect(queryClient.getQueryData(["other", ORG_A])).toBeUndefined();
    expect(queryClient.getQueryData(["org-thing", ORG_A])).toBeUndefined();
    expect(queryClient.getQueryData(["me"])).toEqual(twoShops());
    await screen.findByText(`data:${ORG_B}`);
    await waitFor(() => expect(new Headers(fetch.mock.calls.at(-1)?.[1]?.headers).get("x-org-id")).toBe(ORG_B));
  });
});

describe("membership fallback after a me refetch (review r1)", () => {
  it("current org removed from me → old org data removed before the fallback org renders; ['me'] stays", async () => {
    const app = renderApp("/", { "GET /me": json(200, twoShops()) });
    await screen.findByRole("heading", { name: "Shop A" });
    app.queryClient.setQueryData(["other", ORG_A], "secret");
    const onlyB = me({}, [membership({ orgId: ORG_B, name: "Shop B", role: "groomer" })]);
    act(() => app.queryClient.setQueryData(["me"], onlyB));
    expect(await screen.findByRole("heading", { name: "Shop B" })).toBeInTheDocument();
    expect(app.queryClient.getQueryData(["other", ORG_A])).toBeUndefined();
    expect(app.queryClient.getQueryData(["me"])).toEqual(onlyB);
  });
});
