import { authPasswordChange, defineEndpoint } from "@app/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { meQueryKey, sessionRequired } from "../../src/lib/session";
import { apiError, json, me, renderApp } from "./render";

// Not in api-client yet (T-0048); the shape is enough to prove credential calls are never flagged.
const authTwoFactorEnable = defineEndpoint({ method: "POST", path: "/auth/2fa/enable", response: null });

async function inApp(routes: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp("/", { "GET /me": json(200, me()), ...routes });
  await screen.findByRole("heading", { name: "Happy Paws" });
  app.queryClient.setQueryData(["org-data"], "kept");
  return app;
}

const flaggedQuery = (app: Awaited<ReturnType<typeof inApp>>, key: string) =>
  app.queryClient
    .fetchQuery({
      queryKey: [key],
      queryFn: () => app.api.request(defineEndpoint({ method: "GET", path: `/${key}`, response: null })),
      meta: sessionRequired,
      retry: false,
    })
    .catch(() => undefined);

describe("session-expiry redirect (flagged requests only)", () => {
  it("flagged request → UNAUTHENTICATED: cache cleared, /login", async () => {
    const app = await inApp({ "GET /x": apiError(401, "UNAUTHENTICATED") });
    await flaggedQuery(app, "x");
    await waitFor(() => expect(app.pathname()).toBe("/login"));
    expect(app.queryClient.getQueryData(["org-data"])).toBeUndefined();
  });

  it("flagged mutation → UNAUTHENTICATED: cache cleared, /login", async () => {
    const app = await inApp({ "POST /m": apiError(401, "UNAUTHENTICATED") });
    const mutation = app.queryClient.getMutationCache().build(app.queryClient, {
      mutationFn: () => app.api.request(defineEndpoint({ method: "POST", path: "/m", response: null })),
      meta: sessionRequired,
    });
    await mutation.execute(undefined).catch(() => undefined);
    await waitFor(() => expect(app.pathname()).toBe("/login"));
    expect(app.queryClient.getQueryData(["org-data"])).toBeUndefined();
  });

  it("flagged request → PASSWORD_CHANGE_REQUIRED: /change-password", async () => {
    const app = await inApp({ "GET /x": apiError(403, "PASSWORD_CHANGE_REQUIRED") });
    await flaggedQuery(app, "x");
    await waitFor(() => expect(app.pathname()).toBe("/change-password"));
    expect(app.queryClient.getQueryData(["org-data"])).toBe("kept");
  });

  it("already on /change-password → no navigation", async () => {
    const app = await inApp({ "GET /x": apiError(403, "PASSWORD_CHANGE_REQUIRED") });
    await app.router.navigate({ to: "/change-password" });
    let navigations = 0;
    const off = app.router.subscribe("onBeforeNavigate", () => navigations++);
    await flaggedQuery(app, "x");
    off();
    expect(navigations).toBe(0);
    expect(app.pathname()).toBe("/change-password");
  });

  it("unflagged request → PASSWORD_CHANGE_REQUIRED: no navigation", async () => {
    const app = await inApp({ "GET /x": apiError(403, "PASSWORD_CHANGE_REQUIRED") });
    await app.queryClient
      .fetchQuery({
        queryKey: ["x"],
        queryFn: () => app.api.request(defineEndpoint({ method: "GET", path: "/x", response: null })),
        retry: false,
      })
      .catch(() => undefined);
    expect(app.pathname()).toBe("/");
  });

  it.each([
    ["auth.passwordChange", authPasswordChange, { currentPassword: "a", newPassword: "b-long-password" }],
    ["auth.twoFactor.enable", authTwoFactorEnable, undefined],
  ] as const)("credential mutation %s inside _app → UNAUTHENTICATED: no navigation, cache kept", async (_, endpoint, body) => {
    const app = await inApp({ [`POST ${endpoint.path}`]: apiError(401, "UNAUTHENTICATED") });
    const request = app.api.request as (e: unknown, i?: unknown) => Promise<unknown>;
    const mutation = app.queryClient.getMutationCache().build(app.queryClient, { mutationFn: () => request(endpoint, body && { body }) });
    await mutation.execute(undefined).catch(() => undefined);
    expect(app.pathname()).toBe("/");
    expect(app.queryClient.getQueryData(["org-data"])).toBe("kept");
    expect(app.queryClient.getQueryData(meQueryKey)).toBeDefined();
  });

  it("auth.login on /login → UNAUTHENTICATED: stays, shows the screen's error, cache kept", async () => {
    const app = renderApp("/login", { "POST /auth/login": apiError(401, "UNAUTHENTICATED") });
    app.queryClient.setQueryData(["org-data"], "kept");
    await screen.findByRole("heading", { name: th["scr-auth-login"].title });
    fireEvent.change(screen.getByLabelText(th["scr-auth-login"].identifier), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(th["scr-auth-login"].password), { target: { value: "a-long-password" } });
    fireEvent.click(screen.getByRole("button", { name: th["scr-auth-login"].submit }));
    expect(await screen.findByText(th["scr-auth-login"].failed)).toBeInTheDocument();
    expect(app.pathname()).toBe("/login");
    expect(app.queryClient.getQueryData(["org-data"])).toBe("kept");
  });

  it("/invite with no session renders and does not redirect", async () => {
    const app = renderApp("/invite");
    await waitFor(() => expect(app.router.state.status).toBe("idle"));
    expect(app.pathname()).toBe("/invite");
    expect(app.calls("GET /me")).toHaveLength(0);
  });
});
