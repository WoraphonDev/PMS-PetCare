import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, noContent, renderRoute } from "./render";

const v = th["scr-auth-verify-email"];
const TOKEN = "tok_ABC.def-123";

function openWith(hash: string, ...responses: Array<Response | Error>) {
  window.history.replaceState(null, "", `/verify-email${hash}`);
  const replaceState = vi.spyOn(window.history, "replaceState");
  const r = renderRoute("/verify-email", ...responses);
  return { ...r, replaceState };
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

async function resend(email: string) {
  fireEvent.change(screen.getByLabelText(v.email), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: v.resendSubmit }));
}

describe("scr-auth-verify-email (/verify-email)", () => {
  it("clears the fragment from history BEFORE posting { token } as JSON, then shows success with a link to /login", async () => {
    const { fetch, request, replaceState } = openWith(`#token=${encodeURIComponent(TOKEN)}`, noContent());
    expect(await screen.findByText(v.success)).toBeInTheDocument();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/verify-email");
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0] as number);
    expect(request(0)).toEqual({ url: "/api/v1/auth/email/verify", body: { token: TOKEN } });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("link", { name: v.toLogin })).toHaveAttribute("href", "/login");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows pending while the request runs", async () => {
    openWith(`#token=${TOKEN}`, new Promise<Response>(() => {}) as unknown as Response);
    expect(await screen.findByText(v.pending)).toBeInTheDocument();
  });

  it("VALIDATION_FAILED on token → one invalid message + the resend form", async () => {
    openWith(`#token=${TOKEN}`, apiError(400, "VALIDATION_FAILED", { fields: { token: ["Invalid"] } }));
    expect(await screen.findByText(v.invalid)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: v.resendSubmit })).toBeInTheDocument();
  });

  it.each([
    ["no response (status 0)", new TypeError("Failed to fetch")],
    ["INTERNAL", apiError(500, "INTERNAL")],
  ])("%s → network state; retry re-posts the same token", async (_, first) => {
    const { fetch, request } = openWith(`#token=${TOKEN}`, first, noContent());
    expect(await screen.findByText(v.network)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: v.resendSubmit })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: v.retry }));
    expect(await screen.findByText(v.success)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(request(1)).toEqual({ url: "/api/v1/auth/email/verify", body: { token: TOKEN } });
  });

  it("an empty #token= is still posted (fragment cleared first) and the API's VALIDATION_FAILED shows invalid + resend", async () => {
    const { fetch, request, replaceState } = openWith("#token=", apiError(400, "VALIDATION_FAILED", { fields: { token: ["Too small"] } }));
    expect(await screen.findByText(v.invalid)).toBeInTheDocument();
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0] as number);
    expect(request(0)).toEqual({ url: "/api/v1/auth/email/verify", body: { token: "" } });
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("button", { name: v.resendSubmit })).toBeInTheDocument();
  });

  it("no fragment → resend form only, no verify request", async () => {
    const { fetch } = openWith("");
    expect(await screen.findByRole("heading", { name: v.resendTitle })).toBeInTheDocument();
    expect(screen.queryByText(v.pending)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resend: 204 → the same acknowledgement for any email (normalized before sending)", async () => {
    const { request } = openWith("", noContent());
    await screen.findByRole("heading", { name: v.resendTitle });
    await resend("  Someone@Example.com ");
    expect(await screen.findByText(v.resendAck)).toBeInTheDocument();
    expect(request(0)).toEqual({ url: "/api/v1/auth/email/verification/resend", body: { email: "someone@example.com" } });
  });

  it("resend: malformed email is blocked on the client; server VALIDATION_FAILED → field message", async () => {
    const { fetch } = openWith("", apiError(400, "VALIDATION_FAILED", { fields: { email: ["Invalid"] } }));
    await screen.findByRole("heading", { name: v.resendTitle });
    await resend("not-an-email");
    expect(await screen.findByText(th.errors.VALIDATION_FAILED)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    await resend("a@example.com");
    await vi.waitFor(() => expect(screen.getByLabelText(v.email)).toHaveAttribute("aria-invalid", "true"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(v.resendAck)).toBeNull();
  });
});
