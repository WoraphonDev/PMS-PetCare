import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, json, renderRoute } from "./render";

const s = th["scr-auth-signup"];
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

async function open(...responses: Response[]) {
  const r = renderRoute("/signup", ...responses);
  await screen.findByRole("heading", { name: s.title });
  return r;
}

function fill(overrides: Record<string, string> = {}) {
  const values = {
    [s.displayName]: "สมชาย",
    [s.email]: "Owner@Example.com ",
    [s.password]: "a-long-password",
    [s.orgName]: "Happy Paws",
    [s.branchName]: "สาขาหลัก",
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) type(label, value);
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: s.submit }));

describe("scr-auth-signup (/signup)", () => {
  it("shows the six §7 fields and the slug hint", async () => {
    await open();
    for (const label of [s.displayName, s.email, s.password, s.orgName, s.orgSlug, s.branchName]) expect(field(label)).toBeInTheDocument();
    expect(field(s.password).type).toBe("password");
    expect(screen.getByText(s.slugHint)).toBeInTheDocument();
  });

  it("auto-fills the slug from the shop name until the user edits it", async () => {
    await open();
    type(s.orgName, "Happy Paws");
    expect(field(s.orgSlug).value).toBe("happy-paws");
    type(s.orgName, "ร้านหมาแมว");
    expect(field(s.orgSlug).value).toBe("");
    type(s.orgSlug, "my-shop");
    type(s.orgName, "Another Name");
    expect(field(s.orgSlug).value).toBe("my-shop");
  });

  it("blocks a bad slug or a short password on the client, without a request", async () => {
    const { fetch } = await open();
    fill({ [s.password]: "short" });
    type(s.orgSlug, "AB");
    submit();
    expect(await screen.findAllByText(s.slugHint)).toHaveLength(2); // hint + field error
    expect(field(s.password)).toHaveAttribute("aria-invalid", "true");
    expect(field(s.orgSlug)).toHaveAttribute("aria-invalid", "true");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("201 → the 'check your email' panel (no delivery claim, no navigation) with a link to request a new link", async () => {
    const { request, router } = await open(json(201, { verificationRequired: true }));
    fill();
    submit();
    expect(await screen.findByText(s.sent)).toBeInTheDocument();
    expect(request(0)).toEqual({
      url: "/api/v1/auth/signup",
      body: {
        email: "owner@example.com",
        password: "a-long-password",
        displayName: "สมชาย",
        orgName: "Happy Paws",
        orgSlug: "happy-paws",
        branchName: "สาขาหลัก",
      },
    });
    expect(screen.getByRole("link", { name: s.resendLink })).toHaveAttribute("href", "/verify-email");
    expect(screen.queryByRole("button", { name: s.submit })).toBeNull();
    expect(router.state.location.pathname).toBe("/signup");
  });

  it("CONFLICT → one form message (email or slug, not which)", async () => {
    await open(apiError(409, "CONFLICT"));
    fill();
    submit();
    expect(await screen.findByText(s.conflict)).toBeInTheDocument();
  });

  it("server VALIDATION_FAILED → field message on that field", async () => {
    await open(apiError(400, "VALIDATION_FAILED", { fields: { branchName: ["Must be 1-100 characters"] } }));
    fill();
    submit();
    await waitFor(() => expect(field(s.branchName)).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(th.errors.VALIDATION_FAILED)).toBeInTheDocument();
  });

  it.each([
    [429, "RATE_LIMITED", th.errors.RATE_LIMITED],
    [500, "INTERNAL", th.errors.INTERNAL],
  ])("%s %s → errors.ts text", async (status, code, text) => {
    await open(apiError(status, code));
    fill();
    submit();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
