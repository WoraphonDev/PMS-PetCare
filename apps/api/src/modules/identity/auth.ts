import { account, type Db, session, type Tx, twoFactor, user, verification } from "@app/db";
import { Logger } from "@nestjs/common";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor as twoFactorPlugin, username } from "better-auth/plugins";
import type { Config } from "../../config";
import type { EmailSender } from "../notification/email";
import { errorCode } from "./background";
import { resetPasswordEmail } from "./reset-password-email";

const USERNAME = /^[a-z0-9._-]{3,40}$/;

/**
 * Better Auth instance (ADR-0001). Its HTTP handler is NOT mounted: our controllers call `auth.api.*` so every
 * route keeps our contract and error envelope. Identity tables carry no org_id (no RLS) — the platform connection is used.
 */
export function createAuth(config: Config, db: Db | Tx, email: EmailSender, captureVerification?: (userId: string) => Promise<void>) {
  return betterAuth({
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.APP_ORIGIN,
    trustedOrigins: [config.APP_ORIGIN],
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification, twoFactor } }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // F11: single-use token, valid 1 hour. Better Auth's own link points at its (unmounted) handler — ours goes to the web app.
      resetPasswordTokenExpiresIn: 60 * 60,
      // Errors are caught here: Better Auth would log the whole error object, and provider messages carry the address.
      sendResetPassword: async ({ user, token }) => {
        await email.send(resetPasswordEmail(config.APP_ORIGIN, user.email, token)).catch((err: unknown) => {
          new Logger("Email").error(`password reset email failed (${errorCode(err)})`);
        });
      },
    },
    emailVerification: {
      sendOnSignUp: Boolean(captureVerification),
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      // Only the caller's transaction-local collector is allowed; native sender/link/token are discarded.
      sendVerificationEmail: async ({ user }) => {
        if (!captureVerification) throw new Error("Verification capture unavailable");
        await captureVerification(user.id);
      },
    },
    // Same rule as the DB CHECK user_username_format (#tbl-identity) — Better Auth's default rejects "-".
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 40, usernameValidator: (u) => USERNAME.test(u) }),
      twoFactorPlugin({ backupCodeOptions: { amount: 10 }, trustDeviceMaxAge: 30 * 24 * 60 * 60 }),
    ],
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
