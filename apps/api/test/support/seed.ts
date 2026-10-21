import { randomUUID } from "node:crypto";
import { branch, membership, membershipBranch, organization, withTenant } from "@app/db";
import type { Role } from "@app/domain";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AUTH, type Auth } from "../../src/modules/identity";
import type { TestInfra } from "./infra";

/** Real session and tenant fixtures for API cards. Branch roles default to assignment to every supplied branch. */
export async function seedOrg(
  app: NestFastifyApplication,
  infra: TestInfra,
  options: { role: Role; branches: readonly string[]; assignedBranchIndexes?: readonly number[]; mustChangePassword?: boolean },
) {
  const orgId = randomUUID();
  const branchIds = options.branches.map(() => randomUUID());
  const email = `${randomUUID()}@example.com`;
  const password = "correct-horse-1";
  const signed = await app.get<Auth>(AUTH).api.signUpEmail({ body: { email, password, name: "Test staff" } });
  await withTenant(infra.runtimeDb, orgId, async (tx) => {
    await tx.insert(organization).values({ id: orgId, slug: orgId, displayName: "Test shop" });
    for (const [i, name] of options.branches.entries()) await tx.insert(branch).values({ id: branchIds[i], orgId, name });
    const [member] = await tx
      .insert(membership)
      .values({ orgId, userId: signed.user.id, role: options.role, displayName: "Staff" })
      .returning();
    for (const i of options.assignedBranchIndexes ?? branchIds.map((_, i) => i)) {
      await tx.insert(membershipBranch).values({ orgId, membershipId: member!.id, branchId: branchIds[i]! });
    }
  });
  // Positive authenticated tenant fixture: models an account that has completed email verification.
  await infra.platformDb.$client.query('update "user" set email_verified = true where id = $1', [signed.user.id]);
  // Fixture identity update, deliberately outside the tenant interface (user has no RLS).
  if (options.mustChangePassword) {
    await infra.platformDb.$client.query('update "user" set must_change_password = true where id = $1', [signed.user.id]);
  }
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifier: email, password } });
  if (login.statusCode !== 200) throw new Error(`seedOrg login failed: ${login.statusCode}`);
  const cookie = ([] as string[])
    .concat(login.headers["set-cookie"] ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return { userId: signed.user.id, orgId, branchIds, cookie, password, headers: { cookie, "x-org-id": orgId } };
}
