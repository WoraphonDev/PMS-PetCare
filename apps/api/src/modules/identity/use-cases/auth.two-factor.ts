import type { AuthTwoFactorEnableResponse } from "@app/contracts";
import { auditLog, type Db } from "@app/db";
import { AppError } from "../../../common/app-error";
import type { Config } from "../../../config";
import type { EmailSender } from "../../notification/email";
import { type Auth, createAuth } from "../auth";
import { hasTwoFactorSession, recordTwoFactorSession } from "../two-factor-session";

interface Input {
  password?: string;
  code?: string;
  trustDevice?: boolean;
}
interface Context {
  headers: Headers;
  now: Date;
  ip: string;
  userAgent: string | null;
}
interface Dependencies {
  platformDb: Db;
  config: Config;
  email: EmailSender;
}
type Operation = "enable" | "verify" | "disable";

async function rejected(res: Response): Promise<AppError> {
  const body = (await res.json()) as { code?: string };
  if (res.status === 429 || body.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") return new AppError("RATE_LIMITED");
  if (res.status >= 500) return new AppError("INTERNAL");
  if (res.status === 401 || body.code === "INVALID_PASSWORD" || body.code?.includes("INVALID_")) {
    return new AppError("UNAUTHENTICATED");
  }
  if (res.status === 409) return new AppError("UNAUTHENTICATED"); // concurrent backup redemption lost the CAS
  return new AppError("VALIDATION_FAILED", "Invalid two-factor request", { fields: { code: ["Invalid two-factor request"] } });
}

function verify(auth: Auth, input: Input, headers: Headers) {
  const body = { code: input.code as string, trustDevice: input.trustDevice };
  return /^\d{6}$/.test(body.code)
    ? auth.api.verifyTOTP({ body, headers, asResponse: true })
    : auth.api.verifyBackupCode({ body, headers, asResponse: true });
}

/** Plugin mutations, activation/session rotation and audit share one PostgreSQL transaction.
 * T-0010-01 permits the pinned plugin's internal clock; application audit time comes only from CLOCK.
 */
export async function authTwoFactor(op: Operation, input: Input, ctx: Context, deps: Dependencies) {
  try {
    const result = await deps.platformDb.transaction(async (tx) => {
      const auth = createAuth(deps.config, tx, deps.email);
      const adapter = (await auth.$context).adapter;
      const found = await auth.api.getSession({ headers: ctx.headers });
      if (op !== "verify" && !found) throw new AppError("UNAUTHENTICATED");
      // Serialize setup/disable against other changes to this user's credentials. The plugin never sees a stale user.
      if (found) await adapter.update({ model: "user", where: [{ field: "id", value: found.user.id }], update: { updatedAt: ctx.now } });
      const user = found ? await tx.query.user.findFirst({ where: (u, { eq }) => eq(u.id, found.user.id) }) : undefined;
      if (user?.twoFactorEnabled && !(await hasTwoFactorSession(tx, found?.session.id as string, user.id, ctx.now)))
        throw new AppError("UNAUTHENTICATED");
      if (op === "disable" && user?.isPlatformAdmin) throw new AppError("FORBIDDEN");
      let res: Response;
      if (op === "enable") {
        res = await auth.api.enableTwoFactor({ body: { password: input.password as string }, headers: ctx.headers, asResponse: true });
      } else if (op === "disable") {
        // Verify both factors before consuming a backup code; any subsequent failure rolls back that consumption.
        const hash = await tx.query.account.findFirst({
          where: (a, { and, eq }) => and(eq(a.userId, user?.id as string), eq(a.providerId, "credential")),
        });
        if (
          !hash?.password ||
          !(await (await auth.$context).password.verify({ hash: hash.password, password: input.password as string }))
        ) {
          throw new AppError("UNAUTHENTICATED");
        }
        const proof = await verify(auth, input, ctx.headers);
        if (!proof.ok) throw await rejected(proof);
        res = await auth.api.disableTwoFactor({ body: { password: input.password as string }, headers: ctx.headers, asResponse: true });
      } else res = await verify(auth, input, ctx.headers);
      if (!res.ok) {
        const error = await rejected(res);
        // Failed sign-in attempts must retain the plugin's attempt/lockout counters.
        if (op === "verify" && !found) return { error };
        throw error;
      }
      const setCookies = res.headers.getSetCookie();
      let verifiedSession = found?.session;
      if (setCookies.length) {
        const headers = new Headers(ctx.headers);
        headers.set("cookie", setCookies.map((c) => c.split(";")[0]).join("; "));
        verifiedSession = (await auth.api.getSession({ headers }))?.session;
      }
      if (op === "verify" && verifiedSession && !(await hasTwoFactorSession(tx, verifiedSession.id, verifiedSession.userId, ctx.now))) {
        await recordTwoFactorSession(tx, verifiedSession, ctx.now);
      }
      const activation =
        op === "verify" &&
        user &&
        !user.twoFactorEnabled &&
        (await tx.query.user.findFirst({ where: (u, { eq }) => eq(u.id, user.id) }))?.twoFactorEnabled;
      if (activation || op === "disable") {
        const userId = user?.id as string;
        if (activation) {
          // Activation rotates the plugin session. Revoke every earlier password-only session, including other devices.
          if (!verifiedSession) throw new AppError("INTERNAL");
          await adapter.deleteMany({
            model: "session",
            where: [
              { field: "userId", value: userId },
              { field: "id", operator: "ne", value: verifiedSession.id },
            ],
          });
        } else {
          await adapter.deleteMany({
            model: "verification",
            where: [
              { field: "value", value: userId },
              { field: "identifier", operator: "starts_with", value: "trust-device-" },
            ],
          });
        }
        await adapter.update({ model: "user", where: [{ field: "id", value: userId }], update: { updatedAt: ctx.now } });
        await tx.insert(auditLog).values({
          actorUserId: userId,
          action: activation ? "auth.two_factor_enabled" : "auth.two_factor_disabled",
          entityType: "user",
          entityId: userId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          occurredAt: ctx.now,
          createdAt: ctx.now,
        });
      }
      let body: AuthTwoFactorEnableResponse | undefined;
      if (op === "enable") {
        const data = (await res.json()) as { totpURI: string; backupCodes: string[] };
        body = { totpUri: data.totpURI, backupCodes: data.backupCodes };
      }
      return { setCookies, body };
    });
    if ("error" in result) throw result.error;
    return result;
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Adapter errors may contain SQL parameters with encrypted secrets; do not pass them to request logging.
    throw new AppError("INTERNAL");
  }
}
