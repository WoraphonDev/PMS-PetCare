import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, noContent, renderRoute } from "../auth/render";

const c = th["scr-auth-change-password"];

async function open(...responses: Response[]) {
  const r = renderRoute("/change-password", ...responses);
  await screen.findByRole("heading", { name: c.title });
  return r;
}
function submit(current: string, next: string, confirm = next) {
  fireEvent.change(screen.getByLabelText(c.current), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(c.new), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(c.confirm), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: c.submit }));
}

describe("scr-auth-change-password (/change-password)", () => {
  it("explains the forced change (F09) and has three password fields", async () => {
    await open();
    expect(screen.getByText(c.forced)).toBeInTheDocument();
    for (const label of [c.current, c.new, c.confirm]) expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
  });

  it("a mismatched confirmation is blocked without a request", async () => {
    const { fetch } = await open();
    submit("old-password", "new-password-1", "new-password-2");
    expect(await screen.findByText(c.mismatch)).toBeInTheDocument();
    expect(screen.getByLabelText(c.confirm)).toHaveAttribute("aria-invalid", "true");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a new password under 10 characters is blocked on the client", async () => {
    const { fetch } = await open();
    submit("old-password", "short");
    await waitFor(() => expect(screen.getByLabelText(c.new)).toHaveAttribute("aria-invalid", "true"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts { currentPassword, newPassword } (never the confirmation) → 204 → /", async () => {
    const { request, router } = await open(noContent());
    submit("old-password", "new-password-1");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(request(0)).toEqual({
      url: "/api/v1/auth/password/change",
      body: { currentPassword: "old-password", newPassword: "new-password-1" },
    });
  });

  it("UNAUTHENTICATED (wrong current password) → field message on the current password, no redirect", async () => {
    const { router } = await open(apiError(401, "UNAUTHENTICATED"));
    submit("wrong-password", "new-password-1");
    expect(await screen.findByText(c.wrongCurrent)).toBeInTheDocument();
    expect(screen.getByLabelText(c.current)).toHaveAttribute("aria-invalid", "true");
    expect(router.state.location.pathname).toBe("/change-password");
  });

  it("server VALIDATION_FAILED on newPassword → field message", async () => {
    await open(apiError(400, "VALIDATION_FAILED", { fields: { newPassword: ["Too small"] } }));
    submit("old-password", "new-password-1");
    await waitFor(() => expect(screen.getByLabelText(c.new)).toHaveAttribute("aria-invalid", "true"));
  });
});
