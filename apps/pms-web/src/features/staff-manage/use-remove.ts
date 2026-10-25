import { ApiError, staffRemove } from "@app/api-client";
import type { StaffMember } from "@app/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t } from "../../i18n";
import { errorMessage } from "../../lib/form-errors";
import { useOrg, useOrgApi } from "../../lib/org-context";
import { meQueryKey } from "../../lib/session";
import { staffKey } from "../staff/queries";

/** #contract-staff-remove (F09) — asks first; removing yourself leaves this shop, so its cached data goes too. */
export function useRemoveMember(member: StaffMember) {
  const o = useOrgApi();
  const { me } = useOrg();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...o.mutationOptions((_: { orgId: string }) => o.request(staffRemove, { params: { membershipId: member.membershipId } })),
    onSuccess: (_, { orgId }) => {
      if (member.userId !== me.user.id) return void queryClient.invalidateQueries({ queryKey: staffKey(orgId) });
      // The shell then picks another shop from the new `me`, or shows noOrg.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
    onError: (error, { orgId }) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") void queryClient.invalidateQueries({ queryKey: staffKey(orgId) });
    },
  });

  const remove = () => {
    mutation.reset();
    const question = t("scr-staff-manage.confirmRemove", { name: member.displayName });
    if (window.confirm(member.isManaged ? `${question}\n${t("scr-staff-manage.managedRemoveNote")}` : question))
      mutation.mutate({ orgId: o.orgId });
  };
  const code = mutation.error instanceof ApiError ? mutation.error.code : undefined;
  const error = !mutation.error ? undefined : code === "LAST_OWNER" ? t("scr-staff-manage.lastOwner") : errorMessage(mutation.error);
  return { remove, pending: mutation.isPending, error };
}
