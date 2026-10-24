import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "../../src/i18n/th";
import { apiError, noContent, renderRoute } from "../auth/render";

const f = th["scr-auth-forgot"];
const emailLabel = th["scr-auth-verify-email"].email;

async function open(...responses: Response[]) {
  const r = renderRoute("/forgot-password", ...responses);
  await screen.findByRole("heading", { name: f.title });
  return r;
}
const submit = (email: string) => {
  fireEvent.change(screen.getByLabelText(emailLabel), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: f.submit }));
};

describe("scr-auth-forgot (/forgot-password)", () => {
  it("says it works only for email accounts", async () => {
    await open();
    expect(screen.getByText(f.note)).toBeInTheDocument();
  });

  it("204 → the same acknowledgement for any email", async () => {
    const { request } = await open(noContent());
    submit("anyone@example.com");
    expect(await screen.findByText(f.forgotAck)).toBeInTheDocument();
    expect(request(0)).toEqual({ url: "/api/v1/auth/password/forgot", body: { email: "anyone@example.com" } });
  });

  it("a malformed email is blocked on the client", async () => {
    const { fetch } = await open();
    submit("not-an-email");
    await waitFor(() => expect(screen.getByLabelText(emailLabel)).toHaveAttribute("aria-invalid", "true"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("INTERNAL → errors.ts text, no acknowledgement", async () => {
    await open(apiError(500, "INTERNAL"));
    submit("a@example.com");
    expect(await screen.findByText(th.errors.INTERNAL)).toBeInTheDocument();
    expect(screen.queryByText(f.forgotAck)).toBeNull();
  });
});
