import type { StaffListResponse, StaffMember } from "@app/contracts";
import { isOrgWideRole, type Role } from "@app/domain";
import type { OrgRequestContext } from "../../../common/context";
import { staffProfiles } from "../../identity";
import { listActiveMembers, listPendingInvitations, toInvitation } from "../staff.repository";

const RANK: Record<Role, number> = { owner: 0, manager: 1, front_desk: 2, groomer: 3, caretaker: 4 };

/**
 * docs/spec/features/foundation.md#contract-staff-list — owner/manager see everything. A branch-scoped caller (F02)
 * sees branch-role staff and invitations sharing one of its branches, every owner/manager, and only its own branch ids.
 */
export async function staffList(ctx: OrgRequestContext): Promise<StaffListResponse> {
  const scope = ctx.branchScope;
  const visible = (ids: readonly string[]) => (scope === null ? [...ids] : ids.filter((id) => scope.includes(id)));
  return ctx.db.run(async (tx) => {
    const members = await listActiveMembers(tx);
    const pending = await listPendingInvitations(tx, ctx.now);
    const profiles = new Map(
      (
        await staffProfiles(
          tx,
          members.map((m) => m.userId),
        )
      ).map((p) => [p.id, p]),
    );
    const shown = members.flatMap((m): StaffMember[] => {
      const profile = profiles.get(m.userId);
      const orgWide = isOrgWideRole(m.role);
      const branchIds = orgWide && scope !== null ? [] : visible(m.branchIds);
      if (!profile || (!orgWide && scope !== null && branchIds.length === 0)) return [];
      return [
        {
          membershipId: m.id,
          userId: m.userId,
          displayName: m.displayName,
          email: profile.email,
          username: profile.username,
          role: m.role,
          branchIds,
          status: "active",
          isManaged: profile.isManaged,
          twoFactorEnabled: profile.twoFactorEnabled,
          createdAt: m.createdAt.toISOString(),
        },
      ];
    });
    const invitations = pending.flatMap((row) => {
      const branchIds = visible(row.branchIds);
      if (scope !== null && (isOrgWideRole(row.role) || branchIds.length === 0)) return [];
      return [{ ...toInvitation(row), branchIds }];
    });
    shown.sort((a, b) => RANK[a.role] - RANK[b.role] || compare(a.displayName, b.displayName) || compare(a.membershipId, b.membershipId));
    invitations.sort((a, b) => compare(b.createdAt, a.createdAt) || compare(a.id, b.id));
    return { members: shown, invitations };
  });
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
