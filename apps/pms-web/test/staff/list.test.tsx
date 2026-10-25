import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { th } from "../../src/i18n/th";
import { formatDate } from "../../src/lib/format";
import { apiError, json, me, membership, renderApp } from "../shell/render";
import { INVITATION_1, INVITATION_2, invitation, managed, member, openStaff, staff } from "./fixtures";

const c = th["scr-staff"];
const role = th.shell;
const section = (name: string) => screen.getByRole("region", { name });
const rows = (name: string) => within(section(name)).queryAllByRole("listitem");

afterEach(() => vi.restoreAllMocks());

describe("scr-staff (/settings/staff) — members", () => {
  it("shows name, email, role, all branches for an org-wide role, and 2FA on", async () => {
    await openStaff();
    await screen.findByText("น้องเอ");
    const [owner] = rows(c.members) as [HTMLElement];
    expect(within(owner).getByText("สมชาย")).toBeInTheDocument();
    expect(within(owner).getByText("owner@example.com")).toBeInTheDocument();
    expect(within(owner).getByText(role["role.owner"])).toBeInTheDocument();
    expect(within(owner).getByText(c.allBranches)).toBeInTheDocument();
    expect(within(owner).getByText(c.twoFactorOn)).toBeInTheDocument();
    expect(within(owner).queryByText(c.managedBadge)).toBeNull();
  });

  it("a managed row shows the username, the badge, resolved branch names, 2FA off — never an email", async () => {
    await openStaff();
    await screen.findByText("น้องเอ");
    const row = rows(c.members)[1] as HTMLElement;
    expect(within(row).getByText("nong.a")).toBeInTheDocument();
    expect(within(row).getByText(c.managedBadge)).toBeInTheDocument();
    expect(within(row).getByText(role["role.groomer"])).toBeInTheDocument();
    expect(within(row).getByText("สาขาหลัก, สาขาสอง")).toBeInTheDocument();
    expect(within(row).getByText(c.twoFactorOff)).toBeInTheDocument();
    expect(row.textContent).not.toContain("@");
    expect(document.body.textContent).not.toContain("managed.invalid");
  });

  it("keeps the API order of members and invitations", async () => {
    const later = invitation({ id: INVITATION_2, email: "later@example.com" });
    await openStaff({ "GET /staff": json(200, staff([member(), managed()], [later, invitation()])) });
    await screen.findByText("later@example.com");
    expect(rows(c.members).map((r) => r.textContent?.includes("สมชาย"))).toEqual([true, false]);
    expect(rows(c.invitations).map((r) => r.textContent?.includes("later@example.com"))).toEqual([true, false]);
  });
});

describe("scr-staff — pending invitations", () => {
  it("shows email, role, branches and the Thai expiry date", async () => {
    await openStaff();
    const row = (await screen.findByText("desk@example.com")).closest("li") as HTMLElement;
    expect(within(row).getByText(role["role.front_desk"])).toBeInTheDocument();
    expect(within(row).getByText("สาขาสอง")).toBeInTheDocument();
    const expires = c.expires.replace("{date}", formatDate("2030-01-08T00:00:00.000Z"));
    expect(within(row).getByText(expires)).toBeInTheDocument();
    expect(expires).toContain("2573");
  });
});

describe("scr-staff — who sees what (foundation §7, #permissions)", () => {
  it.each(["owner", "manager"] as const)("%s sees both buttons and a revoke button", async (r) => {
    await openStaff({}, r);
    expect(await screen.findByRole("button", { name: c.inviteByEmail })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: c.createAccount })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: c.revoke })).toBeInTheDocument();
  });

  it("front_desk sees the same lists with no buttons", async () => {
    await openStaff({}, "front_desk");
    await screen.findByText("desk@example.com");
    expect(screen.getByText("nong.a")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: new RegExp(`${c.inviteByEmail}|${c.revoke}`) })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: c.createAccount })).toBeNull();
  });

  it("a manager gets no revoke button on an owner/manager invitation (¹)", async () => {
    const owners = invitation({ id: INVITATION_2, email: "boss@example.com", role: "manager", branchIds: [] });
    await openStaff({ "GET /staff": json(200, staff([member()], [owners, invitation()])) }, "manager");
    const bossRow = (await screen.findByText("boss@example.com")).closest("li") as HTMLElement;
    expect(within(bossRow).getByText(c.allBranches)).toBeInTheDocument();
    expect(within(bossRow).queryByRole("button", { name: c.revoke })).toBeNull();
    const deskRow = screen.getByText("desk@example.com").closest("li") as HTMLElement;
    expect(within(deskRow).getByRole("button", { name: c.revoke })).toBeInTheDocument();
  });

  it.each(["groomer", "caretaker"] as const)("%s sees the forbidden text and no request", async (r) => {
    const app = renderApp("/settings/staff", { "GET /me": json(200, me({}, [membership({ role: r })])) });
    expect(await screen.findByText(th.errors.FORBIDDEN)).toBeInTheDocument();
    expect(app.calls("GET /staff")).toHaveLength(0);
    cleanup();
  });

  it("a failed list shows the error text", async () => {
    await openStaff({ "GET /staff": apiError(403, "FORBIDDEN") });
    expect(await screen.findByText(th.errors.FORBIDDEN)).toBeInTheDocument();
  });
});

describe("revoke invitation", () => {
  it("asks first; cancelling sends nothing", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const r = await openStaff();
    fireEvent.click(await screen.findByRole("button", { name: c.revoke }));
    expect(confirm).toHaveBeenCalledWith(c.confirmRevoke.replace("{email}", "desk@example.com"));
    expect(r.calls(`DELETE /staff/invitations/${INVITATION_1}`)).toHaveLength(0);
  });

  it("confirm → DELETE without body → 204 → refetch drops the row", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const r = await openStaff({
      "GET /staff": [json(200, staff()), json(200, staff(undefined, []))],
      [`DELETE /staff/invitations/${INVITATION_1}`]: new Response(null, { status: 204 }),
    });
    fireEvent.click(await screen.findByRole("button", { name: c.revoke }));
    await waitFor(() => expect(screen.queryByText("desk@example.com")).toBeNull());
    const [call] = r.calls(`DELETE /staff/invitations/${INVITATION_1}`);
    expect(call?.[1]?.body).toBeUndefined();
    expect(r.calls("GET /staff")).toHaveLength(2);
  });

  it("NOT_FOUND (used / revoked / expired) → refetch + invitationGone", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const r = await openStaff({
      "GET /staff": [json(200, staff()), json(200, staff(undefined, []))],
      [`DELETE /staff/invitations/${INVITATION_1}`]: apiError(404, "NOT_FOUND"),
    });
    fireEvent.click(await screen.findByRole("button", { name: c.revoke }));
    expect(await screen.findByText(c.invitationGone)).toBeInTheDocument();
    await waitFor(() => expect(r.calls("GET /staff")).toHaveLength(2));
  });

  it.each([
    ["FORBIDDEN", 403, th.errors.FORBIDDEN],
    ["ORG_SUSPENDED", 403, th.errors.ORG_SUSPENDED],
  ] as const)("%s → its message, the row stays", async (code, status, text) => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await openStaff({ [`DELETE /staff/invitations/${INVITATION_1}`]: apiError(status, code) });
    fireEvent.click(await screen.findByRole("button", { name: c.revoke }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText("desk@example.com")).toBeInTheDocument();
  });
});
