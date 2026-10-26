import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "../../src/i18n/th";
import { formatDate } from "../../src/lib/format";
import { createQueryClient } from "../../src/query-client";
import { apiError, json, me, membership, ORG_B, renderApp } from "../shell/render";

const c = th["scr-invite-accept"];
const TOKEN = `${ORG_B}.s3cr3t-T0ken_value`;
const preview = (over: Record<string, unknown> = {}) => ({
  orgDisplayName: "Other Shop",
  role: "groomer",
  branchNames: ["สาขาหลัก", "สาขาสอง"],
  email: "staff@example.com",
  expiresAt: "2030-01-08T00:00:00.000Z",
  ...over,
});
const loggedIn = (email = "staff@example.com") => json(200, me({ email }, [membership()]));
const noSession = () => apiError(401, "UNAUTHENTICATED");
const accepted = { orgId: ORG_B, membershipId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60", role: "groomer", branchIds: [] };
const joined = me({ email: "staff@example.com" }, [membership(), membership({ orgId: ORG_B, name: "Other Shop", role: "groomer" })]);

type Routes = Record<string, Response | Response[]>;
function openInvite(hash: string | null, routes: Routes, queryClient?: QueryClient) {
  window.history.replaceState(null, "", `/invite${hash ?? ""}`);
  const replaceState = vi.spyOn(window.history, "replaceState");
  const r = renderApp("/invite", routes, queryClient);
  const body = (key: string, i = 0) => JSON.parse(String(r.calls(key)[i]?.[1]?.body));
  return { ...r, replaceState, body };
}
const withToken = (routes: Routes, queryClient?: QueryClient) => openInvite(`#token=${encodeURIComponent(TOKEN)}`, routes, queryClient);

const logs: unknown[][] = [];
beforeEach(() => {
  logs.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  expect(JSON.stringify(logs)).not.toContain(TOKEN);
});

describe("scr-invite-accept: token and preview (#rule-invitation-token, #contract-invitation-preview)", () => {
  it("clears the fragment BEFORE any request, then posts { token } as JSON to preview and shows it", async () => {
    const r = withToken({ "POST /invitations/preview": json(200, preview()), "GET /me": noSession() });
    expect(await screen.findByRole("heading", { name: c.title })).toBeInTheDocument();
    expect(await screen.findByText("ร้าน Other Shop เชิญคุณในตำแหน่ง ช่างตัดขน")).toBeInTheDocument();
    expect(screen.getByText("สาขาหลัก, สาขาสอง")).toBeInTheDocument();
    expect(screen.getByText(`คำเชิญนี้สำหรับ staff@example.com · หมดอายุ ${formatDate("2030-01-08T00:00:00.000Z")}`)).toBeInTheDocument();
    expect(r.replaceState).toHaveBeenCalledWith(null, "", "/invite");
    expect(r.replaceState.mock.invocationCallOrder[0]).toBeLessThan(r.fetch.mock.invocationCallOrder[0] as number);
    expect(window.location.hash).toBe("");
    expect(r.body("POST /invitations/preview")).toEqual({ token: TOKEN });
    for (const [url, init] of r.fetch.mock.calls) {
      expect(String(url)).not.toContain(TOKEN);
      expect(new Headers(init?.headers).get("x-org-id")).toBeNull();
    }
  });

  it("an org-wide role shows all branches", async () => {
    withToken({ "POST /invitations/preview": json(200, preview({ role: "manager", branchNames: [] })), "GET /me": noSession() });
    expect(await screen.findByText(th["scr-staff"].allBranches)).toBeInTheDocument();
  });

  it("no token → invalid, no request", async () => {
    const r = openInvite(null, {});
    expect(await screen.findByText(c.invalid)).toBeInTheDocument();
    expect(r.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["INVITATION_INVALID", apiError(410, "INVITATION_INVALID"), c.invalid],
    ["ORG_SUSPENDED", apiError(423, "ORG_SUSPENDED"), c.suspended],
  ])("preview %s → its state, no choices", async (_, response, text) => {
    withToken({ "POST /invitations/preview": response, "GET /me": noSession() });
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: c.haveAccount })).toBeNull();
    expect(screen.queryByRole("button", { name: c.accept })).toBeNull();
  });
});

describe("scr-invite-accept: not logged in", () => {
  it("shows the preview and both choices; no redirect to /login and the cache is not cleared", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["sentinel"], 1);
    const r = withToken({ "POST /invitations/preview": json(200, preview()), "GET /me": noSession() }, queryClient);
    expect(await screen.findByRole("button", { name: c.haveAccount })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: c.noAccount })).toBeInTheDocument();
    expect(r.calls("GET /me")).toHaveLength(1);
    expect(r.pathname()).toBe("/invite");
    expect(queryClient.getQueryData(["sentinel"])).toBe(1);
  });

  it("login detour: token saved in sessionStorage → /login; `/` after login restores it to /invite, not in the URL", async () => {
    const r = withToken({
      "POST /invitations/preview": json(200, preview()),
      "GET /me": [noSession(), loggedIn()],
    });
    fireEvent.click(await screen.findByRole("button", { name: c.haveAccount }));
    await waitFor(() => expect(r.pathname()).toBe("/login"));
    expect(sessionStorage.getItem("pms.pendingInvite")).toBe(TOKEN);

    // Login lands on `/` (T-0023).
    await r.router.navigate({ to: "/" });
    await waitFor(() => expect(r.pathname()).toBe("/invite"));
    expect(await screen.findByRole("button", { name: c.accept })).toBeInTheDocument();
    expect(sessionStorage.getItem("pms.pendingInvite")).toBeNull();
    expect(r.body("POST /invitations/preview", 1)).toEqual({ token: TOKEN });
    expect(r.router.state.location.href).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("`/` with nothing pending is the normal home page", async () => {
    const r = renderApp("/", { "GET /me": loggedIn() });
    expect(await screen.findByRole("heading", { name: "Happy Paws" })).toBeInTheDocument();
    expect(r.pathname()).toBe("/");
  });
});

describe("scr-invite-accept: logged in (#contract-invitation-accept)", () => {
  it("shows the account; accept → { token } → current shop = the invitation's, `me` refetched, at `/`", async () => {
    const r = withToken({
      "POST /invitations/preview": json(200, preview()),
      "GET /me": [loggedIn(), json(200, joined)],
      "POST /invitations/accept": json(200, accepted),
    });
    expect(await screen.findByText(c.acceptAs.replace("{account}", "staff@example.com"))).toBeInTheDocument();
    expect(screen.queryByText(/คุณเข้าสู่ระบบด้วยบัญชีอื่น/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: c.accept }));
    await waitFor(() => expect(r.pathname()).toBe("/"));
    expect(await screen.findByRole("heading", { name: "Other Shop" })).toBeInTheDocument();
    expect(r.body("POST /invitations/accept")).toEqual({ token: TOKEN });
    // The page's own `me`, then the `_app` guard's fresh one (the shell may refresh it again).
    expect(r.calls("GET /me").length).toBeGreaterThanOrEqual(2);
  });

  it("email differs (case-insensitively) → wrongAccount warning; accept still allowed", async () => {
    withToken({ "POST /invitations/preview": json(200, preview()), "GET /me": loggedIn("owner@example.com") });
    expect(await screen.findByText(c.wrongAccount.replace("{email}", "staff@example.com"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: c.accept })).toBeEnabled();
  });

  it("same email in another case → no warning", async () => {
    withToken({ "POST /invitations/preview": json(200, preview({ email: "Staff@Example.com" })), "GET /me": loggedIn() });
    expect(await screen.findByRole("button", { name: c.accept })).toBeInTheDocument();
    expect(screen.queryByText(/คุณเข้าสู่ระบบด้วยบัญชีอื่น/)).toBeNull();
  });

  it.each([
    ["INVITATION_INVALID", apiError(410, "INVITATION_INVALID"), c.acceptInvalid],
    ["ORG_SUSPENDED", apiError(423, "ORG_SUSPENDED"), c.suspended],
  ])("accept %s → its message, stays on /invite", async (_, response, text) => {
    const r = withToken({ "POST /invitations/preview": json(200, preview()), "GET /me": loggedIn(), "POST /invitations/accept": response });
    fireEvent.click(await screen.findByRole("button", { name: c.accept }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(r.pathname()).toBe("/invite");
  });

  it("ALREADY_MEMBER → alreadyMember, and the shop button switches to that shop", async () => {
    const r = withToken({
      "POST /invitations/preview": json(200, preview()),
      "GET /me": [loggedIn(), json(200, joined)],
      "POST /invitations/accept": apiError(409, "ALREADY_MEMBER"),
    });
    fireEvent.click(await screen.findByRole("button", { name: c.accept }));
    expect(await screen.findByText(c.alreadyMember)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Other Shop" }));
    await waitFor(() => expect(r.pathname()).toBe("/"));
    expect(await screen.findByRole("heading", { name: "Other Shop" })).toBeInTheDocument();
  });

  it("accept answering UNAUTHENTICATED (session expired) → the login / sign-up choices, no redirect", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["sentinel"], 1);
    const r = withToken(
      { "POST /invitations/preview": json(200, preview()), "GET /me": loggedIn(), "POST /invitations/accept": noSession() },
      queryClient,
    );
    fireEvent.click(await screen.findByRole("button", { name: c.accept }));
    expect(await screen.findByRole("button", { name: c.haveAccount })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: c.accept })).toBeNull();
    expect(r.pathname()).toBe("/invite");
    expect(queryClient.getQueryData(["sentinel"])).toBe(1);
  });
});

describe("scr-invite-accept: sign up (#contract-signup-with-invitation)", () => {
  const su = th["scr-auth-signup"];
  const cp = th["scr-auth-change-password"];
  async function openSignup(response?: Response) {
    const r = withToken({
      "POST /invitations/preview": json(200, preview()),
      "GET /me": noSession(),
      ...(response ? { "POST /auth/signup/invitation": response } : {}),
    });
    fireEvent.click(await screen.findByRole("button", { name: c.noAccount }));
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const fill = (password = "new-password-1", confirm = password) => {
      type(su.displayName, "น้องบี");
      type(su.password, password);
      type(cp.confirm, confirm);
    };
    const submit = () => fireEvent.click(screen.getByRole("button", { name: c.signUp }));
    return { ...r, fill, submit, type };
  }

  it("email is read-only from the preview; posts { token, displayName, password } → 201 → signedUp + login link, no auto-login", async () => {
    const r = await openSignup(json(201, { orgId: ORG_B, role: "groomer" }));
    expect(screen.getByLabelText(su.email)).toHaveValue("staff@example.com");
    expect(screen.getByLabelText(su.email)).toHaveAttribute("readonly");
    r.fill();
    r.submit();
    expect(await screen.findByText(c.signedUp)).toBeInTheDocument();
    expect(r.body("POST /auth/signup/invitation")).toEqual({ token: TOKEN, displayName: "น้องบี", password: "new-password-1" });
    expect(screen.getByRole("link", { name: th["scr-auth-login"].title })).toHaveAttribute("href", "/login");
    expect(r.calls("GET /me")).toHaveLength(1);
    expect(r.pathname()).toBe("/invite");
  });

  it("passwords differ → mismatch, no request; too short → field error, no request", async () => {
    const r = await openSignup();
    r.fill("new-password-1", "new-password-2");
    r.submit();
    expect(await screen.findByText(cp.mismatch)).toBeInTheDocument();
    r.fill("short", "short");
    r.submit();
    await waitFor(() => expect(screen.getByLabelText(su.password)).toHaveAttribute("aria-invalid", "true"));
    expect(r.calls("POST /auth/signup/invitation")).toHaveLength(0);
  });

  it("CONFLICT → accountExists with the login choice", async () => {
    const r = await openSignup(apiError(409, "CONFLICT"));
    r.fill();
    r.submit();
    expect(await screen.findByText(c.accountExists)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: c.haveAccount }));
    await waitFor(() => expect(r.pathname()).toBe("/login"));
    expect(sessionStorage.getItem("pms.pendingInvite")).toBe(TOKEN);
  });

  it.each([
    ["INVITATION_INVALID", apiError(410, "INVITATION_INVALID"), c.invalid],
    ["ORG_SUSPENDED", apiError(423, "ORG_SUSPENDED"), c.suspended],
    ["RATE_LIMITED", apiError(429, "RATE_LIMITED"), th.errors.RATE_LIMITED],
  ])("%s → its message", async (_, response, text) => {
    const r = await openSignup(response);
    r.fill();
    r.submit();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("VALIDATION_FAILED on displayName → message at the field", async () => {
    const r = await openSignup(
      json(400, { error: { code: "VALIDATION_FAILED", message: "x", details: { fields: { displayName: ["x"] } } } }),
    );
    r.fill();
    r.submit();
    await waitFor(() => expect(screen.getByLabelText(su.displayName)).toHaveAttribute("aria-invalid", "true"));
  });
});

describe("pending-invite storage", () => {
  it("blocked sessionStorage → the detour still navigates to /login (nothing persisted, no throw)", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const r = withToken({ "POST /invitations/preview": json(200, preview()), "GET /me": noSession() });
    fireEvent.click(await screen.findByRole("button", { name: c.haveAccount }));
    await waitFor(() => expect(r.pathname()).toBe("/login"));
  });
});
