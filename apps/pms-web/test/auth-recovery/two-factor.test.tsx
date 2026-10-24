import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, noContent, renderRoute } from "../auth/render";

const f = th["scr-auth-2fa"];

async function open(...responses: Response[]) {
  const r = renderRoute("/login/2fa", ...responses);
  await screen.findByRole("heading", { name: f.title });
  return r;
}
function submit(code: string, trust = false) {
  fireEvent.change(screen.getByLabelText(f.code), { target: { value: code } });
  if (trust) fireEvent.click(screen.getByLabelText(f.trustDevice));
  fireEvent.click(screen.getByRole("button", { name: f.submit }));
}

describe("scr-auth-2fa (/login/2fa)", () => {
  it("posts { code, trustDevice: false } when the checkbox is off, then goes to /", async () => {
    const { request, router } = await open(noContent());
    expect(screen.getByLabelText(f.trustDevice)).not.toBeChecked();
    submit(" 123456 ");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(request(0)).toEqual({ url: "/api/v1/auth/2fa/verify", body: { code: "123456", trustDevice: false } });
  });

  it("sends trustDevice: true and accepts a backup code", async () => {
    const { request } = await open(noContent());
    submit("ABCD-EFGH-12", true);
    await waitFor(() => expect(request(0).body).toEqual({ code: "ABCD-EFGH-12", trustDevice: true }));
  });

  it("UNAUTHENTICATED (wrong code or expired pending session) → codeInvalid + link to /login, no redirect", async () => {
    const { router } = await open(apiError(401, "UNAUTHENTICATED"));
    submit("000000");
    expect(await screen.findByText(f.codeInvalid)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: f.toLogin })).toHaveAttribute("href", "/login");
    expect(router.state.location.pathname).toBe("/login/2fa");
  });

  it("VALIDATION_FAILED on code → field message", async () => {
    await open(apiError(400, "VALIDATION_FAILED", { fields: { code: ["Invalid two-factor request"] } }));
    submit("1");
    await waitFor(() => expect(screen.getByLabelText(f.code)).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(th.errors.VALIDATION_FAILED)).toBeInTheDocument();
  });

  it("RATE_LIMITED → rateLimited + link to /login; INTERNAL → errors.ts text", async () => {
    await open(apiError(429, "RATE_LIMITED"));
    submit("111111");
    expect(await screen.findByText(f.rateLimited)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: f.toLogin })).toBeInTheDocument();
  });

  it("INTERNAL → errors.ts text", async () => {
    await open(apiError(500, "INTERNAL"));
    submit("111111");
    expect(await screen.findByText(th.errors.INTERNAL)).toBeInTheDocument();
  });

  it("an empty code is blocked on the client", async () => {
    const { fetch } = await open();
    submit("   ");
    expect(await screen.findByText(th.errors.VALIDATION_FAILED)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
