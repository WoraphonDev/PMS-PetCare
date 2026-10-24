import * as domain from "@app/domain";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { navItems } from "../../src/features/shell/nav";
import { th } from "../../src/i18n/th";
import * as permissions from "../../src/lib/permissions";
import { json, me, membership, renderApp } from "./render";

const ORG = "/settings/org";
const BRANCHES = "/settings/branches";
const STAFF = "/settings/staff";
const AUDIT = "/settings/audit";
const SUBSCRIPTION = "/settings/subscription";
const SECURITY = "/account/security";
const PLATFORM = "/platform/orgs";

describe("nav per role (foundation §7 ผู้ใช้)", () => {
  it.each([
    ["owner", [ORG, BRANCHES, STAFF, AUDIT, SUBSCRIPTION, SECURITY]],
    ["manager", [BRANCHES, STAFF, SUBSCRIPTION, SECURITY]],
    ["front_desk", [STAFF, SECURITY]],
    ["groomer", [SECURITY]],
    ["caretaker", [SECURITY]],
  ] as const)("%s sees exactly %j", (role, paths) => {
    expect(navItems(role, false).map((i) => i.path)).toEqual(paths);
  });

  it("platform item only for isPlatformAdmin", () => {
    expect(navItems("groomer", true).map((i) => i.path)).toEqual([SECURITY, PLATFORM]);
    expect(navItems(null, true).map((i) => i.path)).toEqual([SECURITY, PLATFORM]);
    expect(navItems(null, false).map((i) => i.path)).toEqual([SECURITY]);
  });

  it("the rendered nav shows the Thai labels and hrefs for the current role", async () => {
    renderApp("/", { "GET /me": json(200, me({}, [membership({ role: "front_desk" })])) });
    const nav = await screen.findByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      [th.shell["nav.staff"], STAFF],
      [th.shell["nav.security"], SECURITY],
    ]);
  });
});

describe("permissions.ts", () => {
  it("re-exports the @app/domain checks (no web copy of the table)", () => {
    expect(permissions.can).toBe(domain.can);
    expect(permissions.canManageMember).toBe(domain.canManageMember);
  });

  it("canSee follows the domain permission of each screen", () => {
    expect(permissions.canSee("audit", "owner")).toBe(true);
    expect(permissions.canSee("audit", "manager")).toBe(false);
    expect(permissions.canSee("staff", "front_desk")).toBe(true);
  });
});
