import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, noContent, renderRoute } from "../auth/render";

const r = th["scr-auth-reset"];
const c = th["scr-auth-change-password"];
const TOKEN = "reset_Tok3n-xyz";

function openWith(search: string, ...responses: Response[]) {
  window.history.replaceState(null, "", `/reset-password${search}`);
  const replaceState = vi.spyOn(window.history, "replaceState");
  return { ...renderRoute("/reset-password", ...responses), replaceState };
}
function submit(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText(c.new), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(c.confirm), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: r.submit }));
}

const logs: unknown[][] = [];
beforeEach(() => {
  logs.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  expect(JSON.stringify(logs)).not.toContain(TOKEN);
});

describe("scr-auth-reset (/reset-password?token=…)", () => {
  it("removes the token from the address bar on load, before any request", async () => {
    const { fetch, replaceState } = openWith(`?token=${TOKEN}`);
    await screen.findByRole("heading", { name: r.title });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/reset-password");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts { token, password } from memory → 204 → success + link to /login", async () => {
    const { request } = openWith(`?token=${TOKEN}`, noContent());
    await screen.findByRole("heading", { name: r.title });
    submit("new-password-1");
    expect(await screen.findByText(r.success)).toBeInTheDocument();
    expect(request(0)).toEqual({ url: "/api/v1/auth/password/reset", body: { token: TOKEN, password: "new-password-1" } });
    expect(screen.getByRole("link", { name: th["scr-auth-login"].title })).toHaveAttribute("href", "/login");
  });

  it("mismatch and short passwords are blocked on the client", async () => {
    const { fetch } = openWith(`?token=${TOKEN}`);
    await screen.findByRole("heading", { name: r.title });
    submit("new-password-1", "new-password-2");
    expect(await screen.findByText(c.mismatch)).toBeInTheDocument();
    submit("short");
    await waitFor(() => expect(screen.getByLabelText(c.new)).toHaveAttribute("aria-invalid", "true"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("VALIDATION_FAILED on token → tokenInvalid + link to /forgot-password", async () => {
    openWith(`?token=${TOKEN}`, apiError(400, "VALIDATION_FAILED", { fields: { token: ["Invalid, expired or already used"] } }));
    await screen.findByRole("heading", { name: r.title });
    submit("new-password-1");
    expect(await screen.findByText(r.tokenInvalid)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: r.requestNew })).toHaveAttribute("href", "/forgot-password");
  });

  it("server VALIDATION_FAILED on password → field message", async () => {
    openWith(`?token=${TOKEN}`, apiError(400, "VALIDATION_FAILED", { fields: { password: ["Too small"] } }));
    await screen.findByRole("heading", { name: r.title });
    submit("new-password-1");
    await waitFor(() => expect(screen.getByLabelText(c.new)).toHaveAttribute("aria-invalid", "true"));
    expect(screen.queryByText(r.tokenInvalid)).toBeNull();
  });

  it("no token → tokenInvalid with no form and no request", async () => {
    const { fetch } = openWith("");
    expect(await screen.findByText(r.tokenInvalid)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: r.submit })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
