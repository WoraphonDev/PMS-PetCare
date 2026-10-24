import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, BRANCH_1, json, me, membership, renderApp } from "../shell/render";
import { branch, second } from "./fixtures";

const f = th["scr-settings-branch"];
const UNKNOWN = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

async function open(id = BRANCH_1, routes: Record<string, Response | Response[]> = {}, role: "owner" | "manager" = "owner") {
  const r = renderApp(`/settings/branches/${id}`, {
    "GET /me": json(200, me({}, [membership({ role })])),
    "GET /branches": json(200, { items: [branch(), second()] }),
    ...routes,
  });
  await screen.findByRole("link", { name: f.tabInfo });
  return r;
}
const patchBody = (r: Awaited<ReturnType<typeof open>>) => JSON.parse(String(r.calls(`PATCH /branches/${BRANCH_1}`)[0]?.[1]?.body));
const save = () => fireEvent.click(screen.getByRole("button", { name: f.save }));

describe("scr-settings-branch (/settings/branches/:branchId)", () => {
  it("shows the branch from the list: fields, timezone and PromptPay read-only", async () => {
    await open();
    expect(await screen.findByLabelText(f.name)).toHaveValue("สาขาหลัก");
    expect(screen.getByLabelText(f.address)).toHaveValue("1 ถนนสุขุมวิท");
    expect(screen.getByLabelText(f.isActive)).toBeChecked();
    expect(screen.getByText("Asia/Bangkok")).toBeInTheDocument();
    expect(screen.getByText("0812345678")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Asia/Bangkok")).toBeNull();
    expect(screen.getByRole("button", { name: f.save })).toBeDisabled();
  });

  it("an id not in the list → notFound", async () => {
    renderApp(`/settings/branches/${UNKNOWN}`, {
      "GET /me": json(200, me()),
      "GET /branches": json(200, { items: [branch()] }),
    });
    expect(await screen.findByText(f.notFound)).toBeInTheDocument();
    expect(screen.queryByLabelText(f.name)).toBeNull();
  });

  it("tabs: owner sees all four with their hrefs; the payment tab is owner-only", async () => {
    await open();
    const base = `/settings/branches/${BRANCH_1}`;
    expect(screen.getByRole("link", { name: f.tabInfo })).toHaveAttribute("href", base);
    expect(screen.getByRole("link", { name: f.tabHours })).toHaveAttribute("href", `${base}/hours`);
    expect(screen.getByRole("link", { name: f.tabClosures })).toHaveAttribute("href", `${base}/closures`);
    expect(screen.getByRole("link", { name: f.tabPayment })).toHaveAttribute("href", `${base}/payment`);
  });

  it("a manager has no payment tab but can edit the info", async () => {
    await open(BRANCH_1, {}, "manager");
    expect(screen.queryByRole("link", { name: f.tabPayment })).toBeNull();
    await screen.findByLabelText(f.name);
    expect(await screen.findByRole("button", { name: f.save })).toBeInTheDocument();
  });

  it("save sends only the changed fields incl. isActive, never promptpayId or timezone; 200 updates the form", async () => {
    const r = await open(BRANCH_1, {
      [`PATCH /branches/${BRANCH_1}`]: json(200, branch({ phone: "029998888", isActive: false, version: 2 })),
    });
    await screen.findByDisplayValue("สาขาหลัก");
    fireEvent.change(screen.getByLabelText(f.phone), { target: { value: "029998888" } });
    fireEvent.click(screen.getByLabelText(f.isActive));
    save();
    await waitFor(() => expect(r.calls(`PATCH /branches/${BRANCH_1}`)).toHaveLength(1));
    expect(patchBody(r)).toEqual({ phone: "029998888", isActive: false });
    await waitFor(() => expect(screen.getByRole("button", { name: f.save })).toBeDisabled());
    expect(screen.getByLabelText(f.isActive)).not.toBeChecked();
  });

  it("emptied address → null; coordinates are sent as a pair", async () => {
    const r = await open(BRANCH_1, { [`PATCH /branches/${BRANCH_1}`]: json(200, branch({ address: null, latitude: 1, longitude: 2 })) });
    await screen.findByDisplayValue("สาขาหลัก");
    fireEvent.change(screen.getByLabelText(f.address), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(f.latitude), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(f.longitude), { target: { value: "2" } });
    save();
    await waitFor(() => expect(r.calls(`PATCH /branches/${BRANCH_1}`)).toHaveLength(1));
    expect(patchBody(r)).toEqual({ address: null, latitude: 1, longitude: 2 });
  });

  it("one coordinate only → coordsTogether, no request", async () => {
    const r = await open();
    await screen.findByDisplayValue("สาขาหลัก");
    fireEvent.change(screen.getByLabelText(f.latitude), { target: { value: "1" } });
    save();
    expect(await screen.findByText(f.coordsTogether)).toBeInTheDocument();
    expect(r.calls(`PATCH /branches/${BRANCH_1}`)).toHaveLength(0);
  });

  it("CONFLICT → nameTaken; NOT_FOUND → notFound", async () => {
    await open(BRANCH_1, { [`PATCH /branches/${BRANCH_1}`]: [apiError(409, "CONFLICT"), apiError(404, "NOT_FOUND")] });
    await screen.findByDisplayValue("สาขาหลัก");
    fireEvent.change(screen.getByLabelText(f.name), { target: { value: "สาขาสอง" } });
    save();
    expect(await screen.findByText(th["scr-settings-branches"].nameTaken)).toBeInTheDocument();
    save();
    expect(await screen.findByText(f.notFound)).toBeInTheDocument();
  });
});
