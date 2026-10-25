import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, BRANCH_1, BRANCH_2, json } from "../shell/render";
import { invitation, managed, member, openStaff, staff } from "./fixtures";

const c = th["scr-staff"];
const role = th.shell;
type Role = "owner" | "manager";

async function openDialog(button: string, routes: Record<string, Response | Response[]> = {}, as: Role = "owner") {
  const r = await openStaff(routes, as);
  fireEvent.click(await screen.findByRole("button", { name: button }));
  const dialog = await screen.findByRole("dialog", { name: button });
  // Branch names come from the branch list; wait for the picker so a branch role can be submitted.
  await within(dialog).findByRole("checkbox", { name: "สาขาสอง" });
  const type = (label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
  const pickRole = (value: string) => fireEvent.change(within(dialog).getByLabelText(c.role), { target: { value } });
  const tick = (name: string) => fireEvent.click(within(dialog).getByRole("checkbox", { name }));
  const roleOptions = () =>
    within(within(dialog).getByLabelText(c.role))
      .getAllByRole("option")
      .map((o) => o.textContent);
  const sent = (key: string) => JSON.parse(String(r.calls(key)[0]?.[1]?.body));
  return { ...r, dialog, type, pickRole, tick, roleOptions, sent };
}

describe("role and branch pickers (#permissions ¹, F02)", () => {
  it.each([
    [c.inviteByEmail, "owner", ["role.owner", "role.manager", "role.front_desk", "role.groomer", "role.caretaker"]],
    [c.inviteByEmail, "manager", ["role.front_desk", "role.groomer", "role.caretaker"]],
    [c.createAccount, "owner", ["role.owner", "role.manager", "role.front_desk", "role.groomer", "role.caretaker"]],
    [c.createAccount, "manager", ["role.front_desk", "role.groomer", "role.caretaker"]],
  ] as const)("%s as %s offers %j", async (button, as, labels) => {
    const d = await openDialog(button, {}, as);
    expect(d.roleOptions()).toEqual(labels.map((k) => role[k]));
  });

  it("branches are shown for a branch role and hidden for owner/manager", async () => {
    const d = await openDialog(c.inviteByEmail);
    expect(within(d.dialog).getByRole("group", { name: c.branches })).toBeInTheDocument();
    d.pickRole("manager");
    expect(within(d.dialog).queryByRole("group", { name: c.branches })).toBeNull();
    d.pickRole("groomer");
    expect(within(d.dialog).getByRole("checkbox", { name: "สาขาหลัก" })).not.toBeChecked();
  });

  it("a branch role with no branch → BRANCH_REQUIRED at the picker, no request", async () => {
    const d = await openDialog(c.inviteByEmail);
    d.type(c.email, "new@example.com");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.invite }));
    expect(await within(d.dialog).findByText(th.errors.BRANCH_REQUIRED)).toBeInTheDocument();
    expect(d.calls("POST /staff/invitations")).toHaveLength(0);
  });
});

describe("invite by email (#contract-staff-invite)", () => {
  const created = invitation({
    id: "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e",
    email: "new@example.com",
    role: "groomer",
    branchIds: [BRANCH_1],
  });

  it("posts { email, role, branchIds } → 201 → refetch + invited text, no delivery claim, dialog closes", async () => {
    const d = await openDialog(c.inviteByEmail, {
      "POST /staff/invitations": json(201, created),
      "GET /staff": [json(200, staff()), json(200, staff(undefined, [created, invitation()]))],
    });
    d.type(c.email, " New@Example.com ");
    d.pickRole("groomer");
    d.tick("สาขาหลัก");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.invite }));
    const invited = c.invited.replace("{email}", "new@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent(invited);
    expect(d.sent("POST /staff/invitations")).toEqual({ email: "new@example.com", role: "groomer", branchIds: [BRANCH_1] });
    await waitFor(() => expect(d.calls("GET /staff")).toHaveLength(2));
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(invited).not.toMatch(/ส่งแล้ว|ส่งถึง/);
  });

  it("owner/manager role is sent with branchIds []", async () => {
    const d = await openDialog(c.inviteByEmail, { "POST /staff/invitations": json(201, invitation({ role: "manager", branchIds: [] })) });
    d.tick("สาขาสอง");
    d.pickRole("manager");
    d.type(c.email, "boss@example.com");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.invite }));
    await waitFor(() => expect(d.calls("POST /staff/invitations")).toHaveLength(1));
    expect(d.sent("POST /staff/invitations")).toEqual({ email: "boss@example.com", role: "manager", branchIds: [] });
  });

  it("an invalid email is blocked on the client", async () => {
    const d = await openDialog(c.inviteByEmail);
    d.type(c.email, "not-an-email");
    d.tick("สาขาหลัก");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.invite }));
    await waitFor(() => expect(within(d.dialog).getByLabelText(c.email)).toHaveAttribute("aria-invalid", "true"));
    expect(d.calls("POST /staff/invitations")).toHaveLength(0);
  });

  it.each([
    ["ALREADY_MEMBER", 409, c.alreadyMember],
    ["PLAN_LIMIT_REACHED", 402, c.limitReached],
    ["BRANCH_REQUIRED", 400, th.errors.BRANCH_REQUIRED],
    ["FORBIDDEN", 403, c.roleNotAllowed],
    ["NOT_FOUND", 404, th.errors.NOT_FOUND],
    ["ORG_SUSPENDED", 403, th.errors.ORG_SUSPENDED],
  ] as const)("%s → its message, dialog stays open", async (code, status, text) => {
    const d = await openDialog(c.inviteByEmail, { "POST /staff/invitations": apiError(status, code) });
    d.type(c.email, "new@example.com");
    d.tick("สาขาหลัก");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.invite }));
    expect(await within(d.dialog).findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("VALIDATION_FAILED on email → message at the email field", async () => {
    const d = await openDialog(c.inviteByEmail, {
      "POST /staff/invitations": json(400, { error: { code: "VALIDATION_FAILED", message: "x", details: { fields: { email: ["bad"] } } } }),
    });
    d.type(c.email, "new@example.com");
    d.tick("สาขาหลัก");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.invite }));
    await waitFor(() => expect(within(d.dialog).getByLabelText(c.email)).toHaveAttribute("aria-invalid", "true"));
  });
});

describe("create managed account (#contract-staff-account-create)", () => {
  const created = managed();

  it("previews the lowercased username and rejects characters outside the rule", async () => {
    const d = await openDialog(c.createAccount);
    d.type(c.username, "Nong.A");
    expect(within(d.dialog).getByText("nong.a")).toBeInTheDocument();
    d.type(c.displayName, "น้องเอ");
    d.type(c.tempPassword, "temp-pass-123");
    d.tick("สาขาหลัก");
    d.type(c.username, "nong a!");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.create }));
    await waitFor(() => expect(within(d.dialog).getByLabelText(c.username)).toHaveAttribute("aria-invalid", "true"));
    expect(d.calls("POST /staff/accounts")).toHaveLength(0);
  });

  it("a password shorter than 10 is blocked; the toggle shows the password", async () => {
    const d = await openDialog(c.createAccount);
    const password = within(d.dialog).getByLabelText(c.tempPassword);
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(within(d.dialog).getByRole("checkbox", { name: c.showPassword }));
    expect(password).toHaveAttribute("type", "text");
    d.type(c.displayName, "น้องเอ");
    d.type(c.username, "nong.a");
    d.type(c.tempPassword, "short");
    d.tick("สาขาหลัก");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.create }));
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    expect(d.calls("POST /staff/accounts")).toHaveLength(0);
  });

  it("posts the body (username lowercased, password as typed) → 201 → panel with the username; the password is gone", async () => {
    const d = await openDialog(c.createAccount, {
      "POST /staff/accounts": json(201, created),
      "GET /staff": [json(200, staff([member()], [])), json(200, staff([member(), created], []))],
    });
    d.type(c.displayName, "น้องเอ");
    d.type(c.username, "Nong.A");
    d.type(c.tempPassword, "  Temp-Pass-123 ");
    d.pickRole("groomer");
    d.tick("สาขาหลัก");
    d.tick("สาขาสอง");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.create }));
    expect(await screen.findByRole("status")).toHaveTextContent(c.created.replace("{username}", "nong.a"));
    expect(d.sent("POST /staff/accounts")).toEqual({
      displayName: "น้องเอ",
      username: "nong.a",
      password: "  Temp-Pass-123 ",
      role: "groomer",
      branchIds: [BRANCH_1, BRANCH_2],
    });
    await waitFor(() => expect(d.calls("GET /staff")).toHaveLength(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toContain("Temp-Pass-123");
    fireEvent.click(screen.getByRole("button", { name: c.createAccount }));
    const again = await screen.findByRole("dialog", { name: c.createAccount });
    expect(within(again).getByLabelText(c.tempPassword)).toHaveValue("");
  });

  it.each([
    ["CONFLICT", 409, c.usernameTaken],
    ["PLAN_LIMIT_REACHED", 402, c.limitReached],
    ["BRANCH_REQUIRED", 400, th.errors.BRANCH_REQUIRED],
    ["FORBIDDEN", 403, c.roleNotAllowed],
    ["NOT_FOUND", 404, th.errors.NOT_FOUND],
  ] as const)("%s → its message, dialog stays open", async (code, status, text) => {
    const d = await openDialog(c.createAccount, { "POST /staff/accounts": apiError(status, code) });
    d.type(c.displayName, "น้องเอ");
    d.type(c.username, "nong.a");
    d.type(c.tempPassword, "temp-pass-123");
    d.tick("สาขาหลัก");
    fireEvent.click(within(d.dialog).getByRole("button", { name: c.create }));
    expect(await within(d.dialog).findByText(text)).toBeInTheDocument();
    if (code === "CONFLICT") expect(within(d.dialog).getByLabelText(c.username)).toHaveAttribute("aria-invalid", "true");
  });
});
