import { ApiError, staffList } from "@app/api-client";
import { useQuery } from "@tanstack/react-query";
import { t } from "../../i18n";
import { type FormErrors, formErrors } from "../../lib/form-errors";
import { useOrgApi } from "../../lib/org-context";

// Keyed by shop, so a response that arrives after a shop switch only writes its own shop's entry.
export const staffKey = (orgId: string) => ["staff", orgId] as const;

/** #contract-staff-list — members and pending invitations, already ordered and F02-filtered by the API. */
export function useStaff(enabled: boolean) {
  const o = useOrgApi();
  const query = useQuery({ ...o.queryOptions(staffKey(o.orgId), () => o.request(staffList)), enabled });
  // A disabled query still returns its cached data; hide it so a role that lost access never sees it.
  return enabled ? query : { ...query, data: undefined };
}

/** Write errors of the invite and account forms (§7 copy); anything else → errors.ts / field messages. */
export function staffWriteErrors(error: unknown, fields: readonly string[]): FormErrors {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "PLAN_LIMIT_REACHED") return { fields: {}, form: t("scr-staff.limitReached") };
  if (code === "FORBIDDEN") return { fields: {}, form: t("scr-staff.roleNotAllowed") };
  if (code === "ALREADY_MEMBER") return { fields: { email: t("scr-staff.alreadyMember") } };
  if (code === "CONFLICT") return { fields: { username: t("scr-staff.usernameTaken") } };
  if (code === "BRANCH_REQUIRED") return { fields: { branchIds: t("errors.BRANCH_REQUIRED") } };
  return formErrors(error, fields);
}
