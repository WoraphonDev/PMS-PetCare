import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, json, renderRoute } from "./render";

const l = th["scr-auth-login"];

async function open(...responses: Response[]) {
  const r = renderRoute("/login", ...responses);
  await screen.findByRole("heading", { name: l.title });
  return r;
}
function submit(identifier = " owner@example.com ", password = "secret-pass") {
  fireEvent.change(screen.getByLabelText(l.identifier), { target: { value: identifier } });
  fireEvent.change(screen.getByLabelText(l.password), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: l.submit }));
}

describe("scr-auth-login (/login)", () => {
  it("has the §7 fields and links to forgot-password and verify-email", async () => {
    await open();
    expect(screen.getByLabelText(l.password)).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: l.forgot })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("link", { name: l.notVerified })).toHaveAttribute("href", "/verify-email");
  });

  it("posts { identifier, password } (identifier trimmed)", async () => {
    const { request } = await open(json(200, { twoFactorRequired: false, mustChangePassword: false }));
    submit();
    await waitFor(() => expect(request(0).url).toBe("/api/v1/auth/login"));
    expect(request(0).body).toEqual({ identifier: "owner@example.com", password: "secret-pass" });
  });

  it.each([
    [{ twoFactorRequired: true, mustChangePassword: true }, "/login/2fa"],
    [{ twoFactorRequired: false, mustChangePassword: true }, "/change-password"],
    [{ twoFactorRequired: false, mustChangePassword: false }, "/"],
  ])("%j → %s", async (body, path) => {
    const { router } = await open(json(200, body));
    submit();
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  });

  it("UNAUTHENTICATED → one 'failed' message that points to the verify link; stays on /login", async () => {
    const { router } = await open(apiError(401, "UNAUTHENTICATED"));
    submit();
    expect(await screen.findByText(l.failed)).toBeInTheDocument();
    expect(l.failed).toContain("ยืนยันอีเมล");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("RATE_LIMITED → rateLimited", async () => {
    await open(apiError(429, "RATE_LIMITED"));
    submit();
    expect(await screen.findByText(l.rateLimited)).toBeInTheDocument();
  });

  it("empty fields are blocked on the client", async () => {
    const { fetch } = await open();
    submit("  ", "");
    expect(await screen.findAllByText(th.errors.VALIDATION_FAILED)).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
