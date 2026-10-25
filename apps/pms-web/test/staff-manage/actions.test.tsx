import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, BRANCH_1, BRANCH_2, json, me, membership, ORG_A, ORG_B } from "../shell/render";
import { managed, member, staff } from "../staff/fixtures";
import { openRows, type Role, row } from "./render";

const c = th["scr-staff-manage"];
const s = th["scr-staff"];
const noContent = () => new Response(null, { status: 204 });

const OWNER_2 = member({
  membershipId: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  userId: "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a",
  displayName: "เจ้าของสอง",
  email: "o2@example.com",
});
const MANAGER = member({
  membershipId: "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
  userId: "0f1a2b3c-4d5e-4f6a-9b7c-8d9e0f1a2b3c",
  displayName: "ผู้จัดการเอ",
  email: "m@example.com",
  role: "manager",
});
const DESK = member({
  membershipId: "1a2b3c4d-5e6f-4a7b-8c8d-9e0f1a2b3c4d",
  userId: "2b3c4d5e-6f7a-4b8c-9d9e-0f1a2b3c4d5e",
  displayName: "หน้าร้านบี",
  email: "desk@example.com",
  role: "front_desk",
  branchIds: [BRANCH_1],
});
const MANAGED = managed();
const everyone = () => json(200, staff([member(), OWNER_2, MANAGER, DESK, MANAGED], []));
const path = (m: { membershipId: string }) => `/staff/${m.membershipId}`;

afterEach(() => vi.restoreAllMocks());

const actionsOf = (name: string) =>
  [c.edit, c.remove, c.resetPassword].filter((label) => row(name).queryByRole("button", { name: label }) !== null);

describe("row actions visibility (#permissions ¹, F09)", () => {
  it("owner: edit + remove on every row (own included), reset only on managed rows", async () => {
    await openRows({ "GET /staff": everyone() });
    expect(actionsOf("สมชาย")).toEqual([c.edit, c.remove]);
    expect(actionsOf("เจ้าของสอง")).toEqual([c.edit, c.remove]);
    expect(actionsOf("ผู้จัดการเอ")).toEqual([c.edit, c.remove]);
    expect(actionsOf("หน้าร้านบี")).toEqual([c.edit, c.remove]);
    expect(actionsOf("น้องเอ")).toEqual([c.edit, c.remove, c.resetPassword]);
  });

  it("manager: nothing on owner/manager rows (own included), actions on branch-role rows", async () => {
    await openRows({ "GET /staff": everyone() }, "manager");
    expect(actionsOf("สมชาย")).toEqual([]);
    expect(actionsOf("เจ้าของสอง")).toEqual([]);
    expect(actionsOf("ผู้จัดการเอ")).toEqual([]);
    expect(actionsOf("หน้าร้านบี")).toEqual([c.edit, c.remove]);
    expect(actionsOf("น้องเอ")).toEqual([c.edit, c.remove, c.resetPassword]);
  });

  it.each(["front_desk"] as const)("%s (read only): no actions", async (role: Role) => {
    await openRows({ "GET /staff": everyone() }, role);
    for (const name of ["สมชาย", "หน้าร้านบี", "น้องเอ"]) expect(actionsOf(name)).toEqual([]);
  });
});

async function openEdit(name: string, routes: Record<string, Response | Response[]> = {}, role: Role = "owner") {
  const r = await openRows({ "GET /staff": everyone(), ...routes }, role);
  fireEvent.click(row(name).getByRole("button", { name: c.edit }));
  const dialog = within(await screen.findByRole("dialog", { name: c.edit }));
  const save = () => fireEvent.click(dialog.getByRole("button", { name: c.save }));
  const pickRole = (value: string) => fireEvent.change(dialog.getByLabelText(s.role), { target: { value } });
  const tick = (label: string) => fireEvent.click(dialog.getByRole("checkbox", { name: label }));
  return { ...r, dialog, save, pickRole, tick };
}

describe("edit (#contract-staff-update)", () => {
  it("starts from the member's values; manager is offered only branch roles", async () => {
    const d = await openEdit("น้องเอ", {}, "manager");
    expect(d.dialog.getByLabelText(s.displayName)).toHaveValue("น้องเอ");
    expect(d.dialog.getByLabelText(s.role)).toHaveValue("groomer");
    expect(d.dialog.getByRole("checkbox", { name: "สาขาหลัก" })).toBeChecked();
    expect(d.dialog.getByRole("checkbox", { name: "สาขาสอง" })).toBeChecked();
    const options = within(d.dialog.getByLabelText(s.role))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([th.shell["role.front_desk"], th.shell["role.groomer"], th.shell["role.caretaker"]]);
  });

  it("sends only the changed display name (trimmed) → 200 → refetch, dialog closes", async () => {
    const d = await openEdit("น้องเอ", {
      [`PATCH ${path(MANAGED)}`]: json(200, { ...MANAGED, displayName: "น้องเอเอ" }),
    });
    fireEvent.change(d.dialog.getByLabelText(s.displayName), { target: { value: "  น้องเอเอ " } });
    d.save();
    await waitFor(() => expect(d.calls("GET /staff")).toHaveLength(2));
    expect(d.sent(`PATCH ${path(MANAGED)}`)).toEqual({ displayName: "น้องเอเอ" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends only changed branches", async () => {
    const d = await openEdit("น้องเอ", { [`PATCH ${path(MANAGED)}`]: json(200, MANAGED) });
    d.tick("สาขาสอง");
    d.save();
    await waitFor(() => expect(d.calls(`PATCH ${path(MANAGED)}`)).toHaveLength(1));
    expect(d.sent(`PATCH ${path(MANAGED)}`)).toEqual({ branchIds: [BRANCH_1] });
  });

  it("role → owner without touching branches sends no branchIds (the API clears them)", async () => {
    const d = await openEdit("หน้าร้านบี", { [`PATCH ${path(DESK)}`]: json(200, { ...DESK, role: "owner", branchIds: [] }) });
    d.pickRole("owner");
    d.save();
    await waitFor(() => expect(d.calls(`PATCH ${path(DESK)}`)).toHaveLength(1));
    expect(d.sent(`PATCH ${path(DESK)}`)).toEqual({ role: "owner" });
  });

  it("owner → groomer requires branches: none ticked → BRANCH_REQUIRED, no request; then { role, branchIds }", async () => {
    const d = await openEdit("เจ้าของสอง", {
      [`PATCH ${path(OWNER_2)}`]: json(200, { ...OWNER_2, role: "groomer", branchIds: [BRANCH_2] }),
    });
    d.pickRole("groomer");
    d.save();
    expect(await d.dialog.findByText(th.errors.BRANCH_REQUIRED)).toBeInTheDocument();
    expect(d.calls(`PATCH ${path(OWNER_2)}`)).toHaveLength(0);
    d.tick("สาขาสอง");
    d.save();
    await waitFor(() => expect(d.calls(`PATCH ${path(OWNER_2)}`)).toHaveLength(1));
    expect(d.sent(`PATCH ${path(OWNER_2)}`)).toEqual({ role: "groomer", branchIds: [BRANCH_2] });
  });

  it("nothing changed → no request, the dialog closes", async () => {
    const d = await openEdit("น้องเอ");
    d.save();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(d.calls(`PATCH ${path(MANAGED)}`)).toHaveLength(0);
  });

  it("an empty display name is rejected before sending", async () => {
    const d = await openEdit("น้องเอ");
    fireEvent.change(d.dialog.getByLabelText(s.displayName), { target: { value: "   " } });
    d.save();
    expect(await d.dialog.findByText(th.errors.VALIDATION_FAILED)).toBeInTheDocument();
    expect(d.calls(`PATCH ${path(MANAGED)}`)).toHaveLength(0);
  });

  it.each([
    ["LAST_OWNER", apiError(409, "LAST_OWNER"), c.lastOwner],
    ["FORBIDDEN", apiError(403, "FORBIDDEN"), th.errors.FORBIDDEN],
    ["ORG_SUSPENDED", apiError(423, "ORG_SUSPENDED"), th.errors.ORG_SUSPENDED],
  ])("%s → its message, dialog stays open", async (_, response, text) => {
    const d = await openEdit("สมชาย", { [`PATCH ${path(member())}`]: response });
    d.pickRole("manager");
    d.save();
    expect(await d.dialog.findByText(text)).toBeInTheDocument();
  });

  it("BRANCH_REQUIRED from the API → message at the branch picker", async () => {
    const d = await openEdit("หน้าร้านบี", { [`PATCH ${path(DESK)}`]: apiError(400, "BRANCH_REQUIRED") });
    d.tick("สาขาสอง");
    d.save();
    expect(await d.dialog.findByText(th.errors.BRANCH_REQUIRED)).toBeInTheDocument();
    expect(d.sent(`PATCH ${path(DESK)}`)).toEqual({ branchIds: [BRANCH_1, BRANCH_2] });
  });

  it("VALIDATION_FAILED on displayName → message at the field", async () => {
    const d = await openEdit("น้องเอ", {
      [`PATCH ${path(MANAGED)}`]: json(400, {
        error: { code: "VALIDATION_FAILED", message: "x", details: { fields: { displayName: ["x"] } } },
      }),
    });
    fireEvent.change(d.dialog.getByLabelText(s.displayName), { target: { value: "x" } });
    d.save();
    await waitFor(() => expect(d.dialog.getByLabelText(s.displayName)).toHaveAttribute("aria-invalid", "true"));
  });

  it("NOT_FOUND (already removed) → refetch the list and say so", async () => {
    const d = await openEdit("น้องเอ", { [`PATCH ${path(MANAGED)}`]: apiError(404, "NOT_FOUND") });
    fireEvent.change(d.dialog.getByLabelText(s.displayName), { target: { value: "x" } });
    d.save();
    expect(await d.dialog.findByText(th.errors.NOT_FOUND)).toBeInTheDocument();
    await waitFor(() => expect(d.calls("GET /staff")).toHaveLength(2));
  });
});

describe("remove (#contract-staff-remove, F09)", () => {
  it("confirm names the person; managed accounts add the cannot-log-in note; cancel sends nothing", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const r = await openRows({ "GET /staff": everyone() });
    fireEvent.click(row("หน้าร้านบี").getByRole("button", { name: c.remove }));
    expect(confirm).toHaveBeenLastCalledWith(c.confirmRemove.replace("{name}", "หน้าร้านบี"));
    fireEvent.click(row("น้องเอ").getByRole("button", { name: c.remove }));
    expect(confirm).toHaveBeenLastCalledWith(`${c.confirmRemove.replace("{name}", "น้องเอ")}\n${c.managedRemoveNote}`);
    expect(r.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("204 → refetch the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const r = await openRows({
      [`DELETE ${path(MANAGED)}`]: noContent(),
      "GET /staff": [json(200, staff()), json(200, staff([member()], []))],
    });
    fireEvent.click(row("น้องเอ").getByRole("button", { name: c.remove }));
    await waitFor(() => expect(screen.queryByText("น้องเอ")).toBeNull());
    expect(r.calls(`DELETE ${path(MANAGED)}`)).toHaveLength(1);
    expect(r.calls(`DELETE ${path(MANAGED)}`)[0]?.[1]?.body).toBeUndefined();
  });

  it("removing yourself → org-scoped cache cleared and `me` refetched (the shell picks another shop or noOrg)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const r = await openRows({
      [`DELETE ${path(member())}`]: noContent(),
      "GET /me": [json(200, me({}, [membership({ role: "owner" })])), json(200, me({}, []))],
    });
    expect(r.queryClient.getQueryData(["staff", ORG_A])).toBeDefined();
    fireEvent.click(row("สมชาย").getByRole("button", { name: c.remove }));
    expect(await screen.findByText("noOrg")).toBeInTheDocument();
    expect(r.calls("GET /me").length).toBeGreaterThanOrEqual(1);
    expect(r.queryClient.getQueryData(["staff", ORG_A])).toBeUndefined();
  });

  it("removing yourself with another shop left → the shell moves to that shop", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const other = membership({ orgId: ORG_B, name: "Other", role: "owner" });
    const r = await openRows({
      [`DELETE ${path(member())}`]: noContent(),
      "GET /me": json(200, me({}, [other])),
      "GET /staff": json(200, staff()),
    });
    fireEvent.click(row("สมชาย").getByRole("button", { name: c.remove }));
    await waitFor(() => expect(r.calls("GET /staff").some(([, init]) => new Headers(init?.headers).get("x-org-id") === ORG_B)).toBe(true));
    expect(r.queryClient.getQueryData(["staff", ORG_A])).toBeUndefined();
  });

  it.each([
    ["LAST_OWNER", apiError(409, "LAST_OWNER"), c.lastOwner],
    ["FORBIDDEN", apiError(403, "FORBIDDEN"), th.errors.FORBIDDEN],
    ["NOT_FOUND", apiError(404, "NOT_FOUND"), th.errors.NOT_FOUND],
  ])("%s → its message in the row", async (code, response, text) => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const r = await openRows({ [`DELETE ${path(member())}`]: response });
    fireEvent.click(row("สมชาย").getByRole("button", { name: c.remove }));
    expect(await row("สมชาย").findByText(text)).toBeInTheDocument();
    if (code === "NOT_FOUND") await waitFor(() => expect(r.calls("GET /staff")).toHaveLength(2));
  });
});

async function openReset(routes: Record<string, Response | Response[]> = {}) {
  const r = await openRows(routes);
  fireEvent.click(row("น้องเอ").getByRole("button", { name: c.resetPassword }));
  const dialog = within(await screen.findByRole("dialog", { name: c.resetPassword }));
  const type = (value: string) => fireEvent.change(dialog.getByLabelText(c.newTempPassword), { target: { value } });
  const submit = () => fireEvent.click(dialog.getByRole("button", { name: c.resetPassword }));
  return { ...r, dialog, type, submit };
}

describe("reset password (#contract-staff-password-reset, F09)", () => {
  const url = `PUT ${path(MANAGED)}/password`;

  it("password shorter than 10 → field error, no request; show toggle reveals it", async () => {
    const d = await openReset();
    d.type("123456789");
    d.submit();
    await waitFor(() => expect(d.dialog.getByLabelText(c.newTempPassword)).toHaveAttribute("aria-invalid", "true"));
    expect(d.calls(url)).toHaveLength(0);
    expect(d.dialog.getByLabelText(c.newTempPassword)).toHaveAttribute("type", "password");
    fireEvent.click(d.dialog.getByRole("checkbox", { name: s.showPassword }));
    expect(d.dialog.getByLabelText(c.newTempPassword)).toHaveAttribute("type", "text");
  });

  it("PUT { newPassword } (not trimmed) → 204 → resetDone panel, the password is gone", async () => {
    const d = await openReset({ [url]: noContent() });
    d.type(" temp-pass-9 ");
    d.submit();
    expect(await screen.findByRole("status")).toHaveTextContent(c.resetDone);
    expect(d.sent(url)).toEqual({ newPassword: " temp-pass-9 " });
    expect(screen.queryByDisplayValue(" temp-pass-9 ")).toBeNull();
  });

  it.each([
    ["MANAGED_ACCOUNT_ONLY", apiError(409, "MANAGED_ACCOUNT_ONLY"), c.managedOnly],
    ["FORBIDDEN", apiError(403, "FORBIDDEN"), th.errors.FORBIDDEN],
    ["NOT_FOUND", apiError(404, "NOT_FOUND"), th.errors.NOT_FOUND],
  ])("%s → its message", async (_, response, text) => {
    const d = await openReset({ [url]: response });
    d.type("temp-pass-99");
    d.submit();
    expect(await d.dialog.findByText(text)).toBeInTheDocument();
  });
});
