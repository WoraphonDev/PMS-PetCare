import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, json, me, membership, ORG_A, ORG_B, renderApp } from "../shell/render";

const c = th["scr-settings-org"];
const at = "2030-01-01T00:00:00.000Z";
const org = (over: Record<string, unknown> = {}) => ({
  id: ORG_A,
  slug: "happy-paws",
  displayName: "Happy Paws",
  legalName: "บริษัท แฮปปี้ จำกัด",
  taxId: null,
  phone: "021234567",
  logoFileId: null,
  receiptFooter: null,
  status: "active",
  createdAt: at,
  updatedAt: at,
  ...over,
});

async function open(routes: Record<string, Response | Response[]> = {}, role: "owner" | "manager" = "owner") {
  const r = renderApp("/settings/org", { "GET /me": json(200, me({}, [membership({ role })])), "GET /org": json(200, org()), ...routes });
  await screen.findByRole("heading", { name: c.title });
  return r;
}
const sentBody = (r: Awaited<ReturnType<typeof open>>) => JSON.parse(String(r.calls("PATCH /org")[0]?.[1]?.body));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
// TanStack notifies observers on a timer, so let the cache write reach the form before asserting.
const refetched = (r: { queryClient: QueryClient }, key: readonly unknown[], data: unknown) =>
  act(async () => {
    r.queryClient.setQueryData(key, data);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const save = () => fireEvent.click(screen.getByRole("button", { name: c.save }));

describe("scr-settings-org (/settings/org)", () => {
  it("loads the shop values with X-Org-Id; slug and status are read-only text", async () => {
    const r = await open();
    expect(await screen.findByLabelText(c.displayName)).toHaveValue("Happy Paws");
    expect(screen.getByLabelText(c.legalName)).toHaveValue("บริษัท แฮปปี้ จำกัด");
    expect(screen.getByLabelText(c.taxId)).toHaveValue("");
    expect(screen.getByLabelText(c.phone)).toHaveValue("021234567");
    expect(screen.getByLabelText(c.receiptFooter)).toHaveValue("");
    expect(screen.getByText("happy-paws")).toBeInTheDocument();
    expect(screen.getByText(c.statusActive)).toBeInTheDocument();
    expect(screen.getByText(c.slug)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("happy-paws")).toBeNull();
    const i = r.fetch.mock.calls.findIndex(([url]) => String(url).endsWith("/org"));
    expect(r.headers(i).get("x-org-id")).toBe(ORG_A);
  });

  it("an unchanged form cannot be saved", async () => {
    await open();
    await screen.findByDisplayValue("Happy Paws");
    expect(screen.getByRole("button", { name: c.save })).toBeDisabled();
  });

  it("sends only the changed fields; an emptied optional field is sent as null", async () => {
    const r = await open({ "PATCH /org": json(200, org({ legalName: null, taxId: "1234567890123" })) });
    await screen.findByDisplayValue("Happy Paws");
    type(c.legalName, "  ");
    type(c.taxId, "1234567890123");
    save();
    await waitFor(() => expect(r.calls("PATCH /org")).toHaveLength(1));
    expect(sentBody(r)).toEqual({ legalName: null, taxId: "1234567890123" });
    expect(await screen.findByText(c.saved)).toBeInTheDocument();
    expect(screen.getByLabelText(c.legalName)).toHaveValue("");
    expect(screen.getByRole("button", { name: c.save })).toBeDisabled();
  });

  it("an invalid tax id is blocked on the client without a request", async () => {
    const r = await open();
    await screen.findByDisplayValue("Happy Paws");
    type(c.taxId, "12345");
    save();
    await waitFor(() => expect(screen.getByLabelText(c.taxId)).toHaveAttribute("aria-invalid", "true"));
    expect(r.calls("PATCH /org")).toHaveLength(0);
  });

  it("server VALIDATION_FAILED on a field → message at that field", async () => {
    await open({
      "PATCH /org": json(400, { error: { code: "VALIDATION_FAILED", message: "x", details: { fields: { phone: "bad" } } } }),
    });
    await screen.findByDisplayValue("Happy Paws");
    type(c.phone, "02");
    save();
    await waitFor(() => expect(screen.getByLabelText(c.phone)).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(th.errors.VALIDATION_FAILED)).toBeInTheDocument();
  });

  it("ORG_SUSPENDED → the errors.ts message", async () => {
    await open({ "PATCH /org": apiError(403, "ORG_SUSPENDED") });
    await screen.findByDisplayValue("Happy Paws");
    type(c.displayName, "Happy Paws 2");
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(th.errors.ORG_SUSPENDED);
  });

  it("a non-owner sees the forbidden text and no org request is made", async () => {
    const r = await open({}, "manager");
    expect(screen.getByText(th.errors.FORBIDDEN)).toBeInTheDocument();
    expect(screen.queryByLabelText(c.displayName)).toBeNull();
    expect(r.calls("GET /org")).toHaveLength(0);
  });

  it("a GET /org failure shows its own message (FORBIDDEN after a role change), not INTERNAL", async () => {
    await open({ "GET /org": apiError(403, "FORBIDDEN") });
    expect(await screen.findByRole("alert")).toHaveTextContent(th.errors.FORBIDDEN);
  });

  it("a save answered after switching shop never shows shop A's data under shop B", async () => {
    const shops = [membership(), membership({ orgId: ORG_B, name: "Cat Club" })];
    const r = renderApp("/settings/org", { "GET /me": json(200, me({}, shops)), "GET /org": json(200, org()) });
    await screen.findByDisplayValue("Happy Paws");
    const routed = r.fetch.getMockImplementation();
    let answer: (res: Response) => void = () => {};
    r.fetch.mockImplementation(async (url, init) => {
      if (init?.method === "PATCH") return new Promise<Response>((resolve) => (answer = resolve));
      const orgId = new Headers(init?.headers).get("x-org-id");
      if (String(url).endsWith("/org") && orgId === ORG_B) return json(200, org({ id: ORG_B, slug: "cat-club", displayName: "Cat Club" }));
      return routed ? routed(url, init) : json(404, {});
    });
    type(c.displayName, "Happy Paws 2");
    save();
    await waitFor(() => expect(r.calls("PATCH /org")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Cat Club/ }));
    await screen.findByDisplayValue("Cat Club");
    answer(json(200, org({ displayName: "Happy Paws 2" })));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByLabelText(c.displayName)).toHaveValue("Cat Club");
    expect(screen.queryByDisplayValue("Happy Paws 2")).toBeNull();
  });

  it("a background refetch keeps unsaved edits; an untouched form takes the new server values", async () => {
    const r = await open();
    await screen.findByDisplayValue("Happy Paws");
    type(c.phone, "029999999");
    await refetched(r, ["org", ORG_A], org({ legalName: "เปลี่ยนจากที่อื่น" }));
    expect(screen.getByLabelText(c.phone)).toHaveValue("029999999");
    type(c.phone, "021234567");
    await refetched(r, ["org", ORG_A], org({ legalName: "เปลี่ยนอีกครั้ง" }));
    expect(screen.getByLabelText(c.legalName)).toHaveValue("เปลี่ยนอีกครั้ง");
  });
});
