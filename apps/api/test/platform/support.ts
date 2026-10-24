import { createHmac, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect } from "vitest";
import { AUTH, type Auth } from "../../src/modules/identity";
import type { TestInfra } from "../support/infra";

// Fixtures shared by the platform admin tests (§18).

// The 2FA proof of a session expires with the real session, so the injected clock stays near real time.
export const PLATFORM_NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const PASSWORD = "correct-horse-1";
let ip = 0;

const cookies = (r: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((r.headers["set-cookie"] as string | string[]) ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

// Independent RFC 6238 generator (same as test/identity/two-factor.test.ts).
function totp(uri: string, at = new Date()) {
  const secret = new URL(uri).searchParams.get("secret") as string;
  const bits = [...secret.toUpperCase()].map((c) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = (digest.at(-1) as number) & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/** A platform admin; `stage` = how far the session got through F10. */
export async function platformAdmin(
  app: NestFastifyApplication,
  infra: TestInfra,
  stage: "no-2fa" | "2fa-pending" | "verified" = "verified",
) {
  const post = (path: string, body: object, cookie: string) =>
    app.inject({ method: "POST", url: `/api/v1/auth/${path}`, payload: body, headers: { cookie }, remoteAddress: `10.41.0.${++ip}` });
  const email = `${randomUUID()}@example.com`;
  const { user } = await app.get<Auth>(AUTH).api.signUpEmail({ body: { email, password: PASSWORD, name: "Platform admin" } });
  await infra.platformDb.$client.query('update "user" set email_verified = true, is_platform_admin = true where id = $1', [user.id]);
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifier: email, password: PASSWORD } });
  let cookie = cookies(login);
  if (stage !== "no-2fa") {
    const enabled = await post("2fa/enable", { password: PASSWORD }, cookie);
    expect(enabled.statusCode).toBe(200);
    if (stage === "verified") {
      const verified = await post("2fa/verify", { code: totp(enabled.json<{ totpUri: string }>().totpUri) }, cookie);
      expect(verified.statusCode).toBe(204);
      cookie = cookies(verified);
    }
  }
  return { userId: user.id, cookie, headers: { cookie } };
}

/** A plan row (platform connection: the runtime role cannot write plans). */
export async function insertPlan(
  infra: TestInfra,
  fields: { code?: string; name?: string; maxBranches?: number | null; maxStaff?: number | null; isActive?: boolean; price?: number } = {},
) {
  const code = fields.code ?? `test_${randomUUID()}`;
  const { rows } = await infra.platformDb.$client.query<{ id: string }>(
    "insert into plan (code, name, max_branches, max_staff, price_satang_per_month, is_active) values ($1, $2, $3, $4, $5, $6) returning id",
    [
      code,
      fields.name ?? "Pro plan",
      fields.maxBranches === undefined ? 3 : fields.maxBranches,
      fields.maxStaff === undefined ? 10 : fields.maxStaff,
      fields.price ?? 49900,
      fields.isActive ?? true,
    ],
  );
  return { id: rows[0]!.id, code, name: fields.name ?? "Pro plan" };
}

export async function subscribe(
  infra: TestInfra,
  orgId: string,
  planId?: string,
  extra: { currentPeriodEnd?: Date | null; note?: string | null } = {},
) {
  await infra.platformDb.$client.query(
    "insert into subscription (org_id, plan_id, started_at, current_period_end, note) values ($1, $2, $3, $4, $5)",
    [
      orgId,
      planId ?? (await insertPlan(infra)).id,
      new Date("2031-01-02T03:04:05.678Z"),
      extra.currentPeriodEnd ?? null,
      extra.note ?? null,
    ],
  );
}
