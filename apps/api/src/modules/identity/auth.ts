import { account, type Db, session, twoFactor, user, verification } from "@app/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import type { Config } from "../../config";
import type { EmailSender } from "../notification/email";
import { resetPasswordEmail } from "./reset-password-email";

const USERNAME = /^[a-z0-9._-]{3,40}$/;

/**
 * Better Auth instance (ADR-0001). Its HTTP handler is NOT mounted: our controllers call `auth.api.*` so every
 * route keeps our contract and error envelope. Identity tables carry no org_id (no RLS) — the platform connection is used.
 */
export function createAuth(config: Config, db: Db, email: EmailSender) {
  return betterAuth({
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.APP_ORIGIN,
    trustedOrigins: [config.APP_ORIGIN],
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification, twoFactor } }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // F11: single-use token, valid 1 hour. Better Auth's own link points at its (unmounted) handler — ours goes to the web app.
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: ({ user, token }) => email.send(resetPasswordEmail(config.APP_ORIGIN, user.email, token)),
    },
    // Same rule as the DB CHECK user_username_format (#tbl-identity) — Better Auth's default rejects "-".
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 40, usernameValidator: (u) => USERNAME.test(u) })],
    // Our own limiter (F11) counts failed logins per identifier + IP; Better Auth's per-path limiter would double count.
    rateLimit: { enabled: false },
    advanced: {
      database: { generateId: "uuid" },
      // Cookies are HttpOnly + SameSite=Lax by default; Secure everywhere except local development.
      useSecureCookies: config.NODE_ENV !== "development",
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export const AUTH = Symbol("AUTH");

/** Node/Fastify headers → Fetch Headers for Better Auth. */
export function toHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}
