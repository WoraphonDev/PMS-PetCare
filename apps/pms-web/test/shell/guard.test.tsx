import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { meQueryKey } from "../../src/lib/session";
import { apiError, json, me, membership, renderApp } from "./render";

// vitest runs from the package root.
const src = (p: string) => join(process.cwd(), "src", p);

describe("_app guard (T-0024)", () => {
  it("/ without a session → /login", async () => {
    const app = renderApp("/", { "GET /me": apiError(401, "UNAUTHENTICATED") });
    await waitFor(() => expect(app.pathname()).toBe("/login"));
    expect(await screen.findByRole("heading", { name: th["scr-auth-login"].title })).toBeInTheDocument();
  });

  it("mustChangePassword → /change-password (F09)", async () => {
    const app = renderApp("/", { "GET /me": json(200, me({ mustChangePassword: true })) });
    await waitFor(() => expect(app.pathname()).toBe("/change-password"));
  });

  it("/ with a session renders the shell: shop name, role label, nav", async () => {
    renderApp("/", { "GET /me": json(200, me()) });
    expect(await screen.findByRole("heading", { name: "Happy Paws" })).toBeInTheDocument();
    expect(screen.getByText(th.shell.welcome.replace("{name}", "สมชาย"))).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("a logged-in user (cached me) opening /login or /signup → /", async () => {
    for (const path of ["/login", "/signup"]) {
      const app = renderApp(path, { "GET /me": json(200, me()) });
      app.queryClient.setQueryData(meQueryKey, me());
      await app.router.navigate({ href: path });
      await waitFor(() => expect(app.pathname()).toBe("/"));
      app.router.history.destroy();
    }
  });

  it.each(["/login", "/signup", "/login/2fa", "/verify-email", "/forgot-password", "/reset-password", "/change-password", "/invite"])(
    "public route %s renders without calling me.get",
    async (path) => {
      const app = renderApp(path);
      await waitFor(() => expect(app.router.state.status).toBe("idle"));
      expect(app.pathname()).toBe(path);
      expect(app.calls("GET /me")).toHaveLength(0);
    },
  );

  it("the placeholder routes/index.tsx is gone and the route tree has exactly one `/`", () => {
    expect(existsSync(src("routes/index.tsx"))).toBe(false);
    expect(existsSync(src("routes/_app.index.tsx"))).toBe(true);
    const tree = readFileSync(src("routeTree.gen.ts"), "utf8");
    // Top-level route definitions (`.update({ path, getParentRoute })`) — only _app.index defines `/`. Nested index
    // routes (e.g. a branch's info tab) also have a relative `path: '/'`, so they are not counted (T-0025-01 A).
    expect(tree.match(/path: '\/',\n\s+getParentRoute: \(\) => (rootRouteImport|AppRoute),/g)).toHaveLength(1);
  });

  it("no membership: noOrg text; platform link only for a platform admin", async () => {
    renderApp("/", { "GET /me": json(200, me({}, [])) });
    expect(await screen.findByText(th.shell.noOrg)).toBeInTheDocument();
    expect(screen.queryByRole("main")?.textContent).not.toContain(th.shell["nav.platform"]);
  });

  it("no membership + platform admin: link to /platform/orgs", async () => {
    renderApp("/", { "GET /me": json(200, me({ isPlatformAdmin: true }, [])) });
    await screen.findByText(th.shell.noOrg);
    const links = screen.getAllByRole("link", { name: th.shell["nav.platform"] });
    expect(links.map((l) => l.getAttribute("href"))).toContain("/platform/orgs");
  });

  it("suspended banner only for a suspended current org (F04)", async () => {
    const suspended = membership({ org: { id: membership().org.id, slug: "s", displayName: "Happy Paws", status: "suspended" } });
    renderApp("/", { "GET /me": json(200, me({}, [suspended])) });
    expect(await screen.findByRole("alert")).toHaveTextContent(th.shell.suspended);
  });

  it("no banner for an active org", async () => {
    renderApp("/", { "GET /me": json(200, me()) });
    await screen.findByRole("heading", { name: "Happy Paws" });
    expect(screen.queryByText(th.shell.suspended)).not.toBeInTheDocument();
  });
});

describe("logout (foundation#ep-auth.logout)", () => {
  it.each([
    ["204", new Response(null, { status: 204 })],
    ["failure", apiError(500, "INTERNAL")],
  ])("request sent; on %s the cache is cleared and the user lands on /login", async (_, answer) => {
    const app = renderApp("/", { "GET /me": json(200, me()), "POST /auth/logout": answer });
    await screen.findByRole("heading", { name: "Happy Paws" });
    app.queryClient.setQueryData(["org-data"], 1);
    fireEvent.click(screen.getByRole("button", { name: th.shell.logout }));
    await waitFor(() => expect(app.pathname()).toBe("/login"));
    expect(app.calls("POST /auth/logout")).toHaveLength(1);
    expect(app.queryClient.getQueryData(["org-data"])).toBeUndefined();
    expect(app.queryClient.getQueryData(meQueryKey)).toBeUndefined();
  });
});
