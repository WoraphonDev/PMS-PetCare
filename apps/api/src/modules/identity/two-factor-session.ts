import { type Db, type Tx, verification } from "@app/db";

/** Proof is tied to one session, never inferred from the user's current enrollment flag. */
export async function recordTwoFactorSession(db: Db | Tx, session: { id: string; userId: string; expiresAt: Date }, now: Date) {
  await db.insert(verification).values({
    identifier: `2fa-session:${session.id}`,
    value: session.userId,
    expiresAt: session.expiresAt,
    createdAt: now,
    updatedAt: now,
  });
}

export async function hasTwoFactorSession(db: Db | Tx, sessionId: string, userId: string, now: Date) {
  const proof = await db.query.verification.findFirst({
    where: (v, { and, eq, gt }) => and(eq(v.identifier, `2fa-session:${sessionId}`), eq(v.value, userId), gt(v.expiresAt, now)),
  });
  return !!proof;
}

export async function platformSession(auth: import("./auth").Auth, db: Db, headers: Headers, now: Date) {
  const found = await auth.api.getSession({ headers });
  if (!found) return null;
  const user = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, found.user.id) });
  return user ? { user, verified: user.twoFactorEnabled && (await hasTwoFactorSession(db, found.session.id, user.id, now)) } : null;
}
