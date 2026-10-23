import type { Tx } from "@app/db";
import { can, type Permission, type Role } from "@app/domain";
import { AppError } from "../../common/app-error";
import { readMembership } from "./staff.repository";

/**
 * docs/spec/features/foundation.md#rule-staff-caller-recheck — after the subscription lock and the org-status re-read:
 * the caller's membership is read again; the role it returns is the one every ¹ rule uses from here on.
 */
export async function recheckCaller(tx: Tx, membershipId: string, permission: Permission): Promise<Role> {
  const caller = await readMembership(tx, membershipId);
  if (caller?.status !== "active" || !can(caller.role, permission)) throw new AppError("FORBIDDEN");
  return caller.role;
}
