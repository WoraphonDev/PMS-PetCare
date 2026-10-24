import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, BRANCH_1, BRANCH_2, json, me, membership, renderApp } from "../shell/render";
import { branch, second, subscription } from "./fixtures";

const c = th["scr-settings-branches"];
const f = th["scr-settings-branch"];
type Role = "owner" | "manager";

async function open(routes: Record<string, Response | Response[]> = {}, role: Role = "owner") {
  const r = renderApp("/settings/branches", {
    "GET /me": json(200, me({}, [membership({ role })])),
    "GET /branches": json(200, { items: [branch(), second()] }),
    "GET /subscription": json(200, subscription(3, 2)),
    ...routes,
  });
  await screen.findByRole("heading", { name: c.title });
  await screen.findByText("สาขาสอง");
  return r;
}
const limitText = (max: number, used: number) =>
  th["scr-settings-branches"].limitReached.replace("{plan}", "Basic").replace("{max}", String(max)).replace("{used}", String(used));

describe("scr-settings-branches (/settings/branches)", () => {
  it("lists name, address and an inactive badge; each row links to the branch", async () => {
    await open();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("1 ถนนสุขุมวิท")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByText(c.inactive)).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText(c.inactive)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /สาขาหลัก/ })).toHaveAttribute("href", `/settings/branches/${BRANCH_1}`);
  });

  it("owner under the limit sees the add button", async () => {
    await open();
    expect(await screen.findByRole("button", { name: c.add })).toBeInTheDocument();
    expect(screen.queryByText(limitText(3, 2))).toBeNull();
  });

  it.each([
    [2, 2],
    [2, 3],
  ])("at or over the limit (max %i, used %i) the button is hidden and the plan text shows the numbers", async (max, used) => {
    await open({ "GET /subscription": json(200, subscription(max, used)) });
    expect(await screen.findByText(limitText(max, used))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: c.add })).toBeNull();
  });

  it("maxBranches null (unlimited) → the button is shown", async () => {
    await open({ "GET /subscription": json(200, subscription(null, 40)) });
    expect(await screen.findByRole("button", { name: c.add })).toBeInTheDocument();
  });

  it("a manager sees the list but no add button, and the subscription is not read", async () => {
    const r = await open({}, "manager");
    expect(screen.queryByRole("button", { name: c.add })).toBeNull();
    expect(r.calls("GET /subscription")).toHaveLength(0);
  });
});

describe("branch screens are owner / manager only (foundation §7)", () => {
  it.each(["front_desk", "groomer", "caretaker"] as const)(
    "%s opening the list or a detail URL sees the forbidden text, no request",
    async (role) => {
      for (const path of ["/settings/branches", `/settings/branches/${BRANCH_1}`]) {
        const r = renderApp(path, {
          "GET /me": json(200, me({}, [membership({ role })])),
          "GET /branches": json(200, { items: [branch()] }),
        });
        expect(await screen.findByText(th.errors.FORBIDDEN)).toBeInTheDocument();
        expect(r.calls("GET /branches")).toHaveLength(0);
        expect(r.calls("GET /subscription")).toHaveLength(0);
        cleanup();
      }
    },
  );
});

describe("add branch dialog", () => {
  async function openDialog(routes: Record<string, Response | Response[]> = {}) {
    const r = await open(routes);
    fireEvent.click(await screen.findByRole("button", { name: c.add }));
    const dialog = await screen.findByRole("dialog");
    const type = (label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: c.add }));
    return { ...r, dialog, type, submit };
  }

  it("only one coordinate → coordsTogether message, no request", async () => {
    const d = await openDialog();
    d.type(f.name, "สาขาใหม่");
    d.type(f.latitude, "13.75");
    d.submit();
    expect(await within(d.dialog).findByText(f.coordsTogether)).toBeInTheDocument();
    expect(d.calls("POST /branches")).toHaveLength(0);
  });

  it("an empty name is blocked on the client", async () => {
    const d = await openDialog();
    d.submit();
    await waitFor(() => expect(within(d.dialog).getByLabelText(f.name)).toHaveAttribute("aria-invalid", "true"));
    expect(d.calls("POST /branches")).toHaveLength(0);
  });

  it("posts the body (coords as numbers) → 201 → opens the new branch", async () => {
    const created = branch({ id: BRANCH_2, name: "สาขาใหม่", latitude: 13.75, longitude: 100.5 });
    const d = await openDialog({
      "POST /branches": json(201, created),
      "GET /branches": [json(200, { items: [branch(), second()] }), json(200, { items: [branch(), created] })],
    });
    d.type(f.name, "สาขาใหม่");
    d.type(f.phone, "021112222");
    d.type(f.latitude, "13.75");
    d.type(f.longitude, "100.5");
    d.submit();
    await waitFor(() => expect(d.pathname()).toBe(`/settings/branches/${BRANCH_2}`));
    expect(JSON.parse(String(d.calls("POST /branches")[0]?.[1]?.body))).toEqual({
      name: "สาขาใหม่",
      address: null,
      phone: "021112222",
      latitude: 13.75,
      longitude: 100.5,
    });
  });

  it("both coordinates empty → sent as null", async () => {
    const d = await openDialog({ "POST /branches": json(201, branch({ id: BRANCH_2, name: "สาขาใหม่" })) });
    d.type(f.name, "สาขาใหม่");
    d.submit();
    await waitFor(() => expect(d.calls("POST /branches")).toHaveLength(1));
    expect(JSON.parse(String(d.calls("POST /branches")[0]?.[1]?.body))).toMatchObject({ latitude: null, longitude: null });
  });

  it("PLAN_LIMIT_REACHED (race) → the plan limit text", async () => {
    const d = await openDialog({
      "POST /branches": apiError(402, "PLAN_LIMIT_REACHED"),
      "GET /subscription": [json(200, subscription(3, 2)), json(200, subscription(3, 3))],
    });
    d.type(f.name, "สาขาใหม่");
    d.submit();
    expect(await screen.findByText(limitText(3, 3))).toBeInTheDocument();
  });

  it("CONFLICT → nameTaken at the name field", async () => {
    const d = await openDialog({ "POST /branches": apiError(409, "CONFLICT") });
    d.type(f.name, "สาขาหลัก");
    d.submit();
    expect(await within(d.dialog).findByText(c.nameTaken)).toBeInTheDocument();
    expect(within(d.dialog).getByLabelText(f.name)).toHaveAttribute("aria-invalid", "true");
  });
});
