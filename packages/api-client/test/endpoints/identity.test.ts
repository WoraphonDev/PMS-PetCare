import {
  AuthEmailVerificationResendRequest,
  AuthEmailVerifyRequest,
  AuthLoginRequest,
  type AuthLoginResponse,
  AuthPasswordChangeRequest,
  AuthPasswordForgotRequest,
  AuthPasswordResetRequest,
  AuthSignupRequest,
  AuthSignupWithInvitationRequest,
  AuthSignupWithInvitationResponse,
  AuthTwoFactorVerifyRequest,
  InvitationAcceptRequest,
  InvitationAcceptResponse,
  InvitationPreviewRequest,
  InvitationPreviewResponse,
  type MeResponse,
} from "@app/contracts";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  authEmailVerificationResend,
  authEmailVerify,
  authLogin,
  authLogout,
  authPasswordChange,
  authPasswordForgot,
  authPasswordReset,
  authSignup,
  authSignupWithInvitation,
  authTwoFactorVerify,
  createApiClient,
  invitationAccept,
  invitationPreview,
  meGet,
} from "../../src/index";

const me: MeResponse = {
  user: {
    id: "0b6f8f0e-6d8a-4f0f-9a3e-3c1f3b6f2a10",
    name: "สมชาย",
    email: "owner@example.com",
    username: null,
    isPlatformAdmin: false,
    mustChangePassword: false,
    twoFactorEnabled: false,
  },
  memberships: [
    {
      org: { id: "6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21", slug: "happy-paws", displayName: "Happy Paws", status: "active" },
      role: "owner",
      branches: [{ id: "8a0b5c1d-3e2f-4a6b-8c7d-9e0f1a2b3c4d", name: "สาขาหลัก" }],
    },
  ],
};

describe("me.get (foundation#ep-me.get)", () => {
  it("GET {baseUrl}/me with credentials and Accept JSON → parsed MeResponse", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(me), { status: 200 }));
    const api = createApiClient({ baseUrl: "/api/v1", fetch });

    const result = await api.request(meGet);

    expect(result).toEqual(me);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/me");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(init?.body).toBeUndefined();
  });

  it("is typed from the contract: resolves to MeResponse and takes no params or body", () => {
    const api = createApiClient({ baseUrl: "/api/v1", fetch: vi.fn() });
    // Type-level only: the closure is never called, so no request is made.
    const typeChecks = () => {
      expectTypeOf(api.request(meGet)).resolves.toEqualTypeOf<MeResponse>();
      // @ts-expect-error me.get has no body
      void api.request(meGet, { body: { x: 1 } });
      // @ts-expect-error me.get has no path params
      void api.request(meGet, { params: { id: "x" } });
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});

describe("auth descriptors (T-0023)", () => {
  const signup = {
    email: "owner@example.com",
    password: "a-long-password",
    displayName: "สมชาย",
    orgName: "Happy Paws",
    orgSlug: "happy-paws",
    branchName: "สาขาหลัก",
  };

  function setup(response: Response) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const api = createApiClient({ baseUrl: "/api/v1", fetch });
    const sent = () => {
      const [url, init] = fetch.mock.calls[0] ?? [];
      return { url, method: init?.method, body: init?.body, contentType: new Headers(init?.headers).get("content-type") };
    };
    return { api, sent };
  }

  it("auth.signup: POST /auth/signup with the JSON body → { verificationRequired: true } (foundation#ep-auth.signup)", async () => {
    const { api, sent } = setup(new Response(JSON.stringify({ verificationRequired: true }), { status: 201 }));
    await expect(api.request(authSignup, { body: signup })).resolves.toEqual({ verificationRequired: true });
    expect(sent()).toEqual({ url: "/api/v1/auth/signup", method: "POST", body: JSON.stringify(signup), contentType: "application/json" });
    expect(authSignup.body).toBe(AuthSignupRequest);
  });

  it("auth.email.verify: POST /auth/email/verify { token } → 204 undefined (foundation#ep-auth.email.verify)", async () => {
    const { api, sent } = setup(new Response(null, { status: 204 }));
    await expect(api.request(authEmailVerify, { body: { token: "abc" } })).resolves.toBeUndefined();
    expect(sent()).toEqual({ url: "/api/v1/auth/email/verify", method: "POST", body: '{"token":"abc"}', contentType: "application/json" });
    expect(authEmailVerify.body).toBe(AuthEmailVerifyRequest);
  });

  it("auth.email.verification.resend: POST /auth/email/verification/resend { email } → 204 undefined", async () => {
    const { api, sent } = setup(new Response(null, { status: 204 }));
    await expect(api.request(authEmailVerificationResend, { body: { email: "a@example.com" } })).resolves.toBeUndefined();
    expect(sent()).toEqual({
      url: "/api/v1/auth/email/verification/resend",
      method: "POST",
      body: '{"email":"a@example.com"}',
      contentType: "application/json",
    });
    expect(authEmailVerificationResend.body).toBe(AuthEmailVerificationResendRequest);
  });

  it("auth.login: POST /auth/login { identifier, password } → { twoFactorRequired, mustChangePassword } (foundation#ep-auth.login)", async () => {
    const { api, sent } = setup(new Response(JSON.stringify({ twoFactorRequired: true, mustChangePassword: false }), { status: 200 }));
    await expect(api.request(authLogin, { body: { identifier: "owner", password: "x" } })).resolves.toEqual({
      twoFactorRequired: true,
      mustChangePassword: false,
    });
    expect(sent()).toEqual({
      url: "/api/v1/auth/login",
      method: "POST",
      body: '{"identifier":"owner","password":"x"}',
      contentType: "application/json",
    });
    expect(authLogin.body).toBe(AuthLoginRequest);
  });

  it("types bodies and responses from the contracts", () => {
    const api = createApiClient({ baseUrl: "/api/v1", fetch: vi.fn() });
    const typeChecks = () => {
      expectTypeOf(api.request(authLogin, { body: { identifier: "a", password: "b" } })).resolves.toEqualTypeOf<AuthLoginResponse>();
      expectTypeOf(api.request(authEmailVerify, { body: { token: "a" } })).resolves.toEqualTypeOf<undefined>();
      // @ts-expect-error signup body needs every contract field
      void api.request(authSignup, { body: { email: "a@b.co" } });
      // @ts-expect-error verify needs a body
      void api.request(authEmailVerify);
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});

describe("2FA / password descriptors (T-0045)", () => {
  function setup(response: Response) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const api = createApiClient({ baseUrl: "/api/v1", fetch });
    const sent = () => {
      const [url, init] = fetch.mock.calls[0] ?? [];
      return { url, method: init?.method, body: init?.body };
    };
    return { api, sent };
  }

  it.each([
    [
      "auth.twoFactor.verify",
      authTwoFactorVerify,
      "/api/v1/auth/2fa/verify",
      { code: "123456", trustDevice: true },
      AuthTwoFactorVerifyRequest,
    ],
    [
      "auth.passwordChange",
      authPasswordChange,
      "/api/v1/auth/password/change",
      { currentPassword: "old-password", newPassword: "new-password-1" },
      AuthPasswordChangeRequest,
    ],
    ["auth.passwordForgot", authPasswordForgot, "/api/v1/auth/password/forgot", { email: "a@example.com" }, AuthPasswordForgotRequest],
    [
      "auth.passwordReset",
      authPasswordReset,
      "/api/v1/auth/password/reset",
      { token: "t", password: "new-password-1" },
      AuthPasswordResetRequest,
    ],
  ] as const)("%s: POST %s with the JSON body → 204 undefined", async (_, endpoint, url, body, schema) => {
    const { api, sent } = setup(new Response(null, { status: 204 }));
    const request = api.request as (endpoint: unknown, input: unknown) => Promise<unknown>;
    await expect(request(endpoint, { body })).resolves.toBeUndefined();
    expect(sent()).toEqual({ url, method: "POST", body: JSON.stringify(body) });
    expect(endpoint.body).toBe(schema);
    expect(endpoint.response).toBeNull();
  });
});

describe("auth.logout (T-0024, foundation#ep-auth.logout)", () => {
  it("POST /auth/logout with no body, no Content-Type and no X-Org-Id → 204 undefined", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: "/api/v1", fetch });

    await expect(api.request(authLogout)).resolves.toBeUndefined();

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/auth/logout");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
    expect(new Headers(init?.headers).get("x-org-id")).toBeNull();
    expect(authLogout.response).toBeNull();
  });
});

describe("invitation descriptors (T-0047, foundation#contract-invitation-accept / -preview / -signup-with-invitation)", () => {
  const ORG_ID = "6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21";
  const token = `${ORG_ID}.abc`;
  const preview = {
    orgDisplayName: "Happy Paws",
    role: "groomer",
    branchNames: ["สาขาหลัก"],
    email: "staff@example.com",
    expiresAt: "2030-01-08T00:00:00.000Z",
  };
  const accepted = {
    orgId: ORG_ID,
    membershipId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
    role: "groomer",
    branchIds: ["8a0b5c1d-3e2f-4a6b-8c7d-9e0f1a2b3c4d"],
  };

  it.each([
    [
      "invitation.preview",
      invitationPreview,
      "/api/v1/invitations/preview",
      { token },
      200,
      preview,
      InvitationPreviewRequest,
      InvitationPreviewResponse,
    ],
    [
      "invitation.accept",
      invitationAccept,
      "/api/v1/invitations/accept",
      { token },
      200,
      accepted,
      InvitationAcceptRequest,
      InvitationAcceptResponse,
    ],
    [
      "auth.signupWithInvitation",
      authSignupWithInvitation,
      "/api/v1/auth/signup/invitation",
      { token, displayName: "น้องบี", password: "new-password-1" },
      201,
      { orgId: ORG_ID, role: "groomer" },
      AuthSignupWithInvitationRequest,
      AuthSignupWithInvitationResponse,
    ],
  ] as const)("%s: POST %s with the token in the JSON body, no X-Org-Id", async (_, endpoint, url, body, status, response, req, res) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(response), { status }));
    const api = createApiClient({ baseUrl: "/api/v1", fetch });
    const request = api.request as (endpoint: unknown, input: unknown) => Promise<unknown>;
    await expect(request(endpoint, { body })).resolves.toEqual(response);
    const [sentUrl, init] = fetch.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect({ url: sentUrl, method: init?.method, body: init?.body }).toEqual({ url, method: "POST", body: JSON.stringify(body) });
    expect(headers.get("x-org-id")).toBeNull();
    expect(String(sentUrl)).not.toContain(token);
    expect(endpoint.body).toBe(req);
    expect(endpoint.response).toBe(res);
  });
});
