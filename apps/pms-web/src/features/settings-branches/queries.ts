import { branchList, subscriptionGet } from "@app/api-client";
import type { SubscriptionGetResponse } from "@app/contracts";
import { useQuery } from "@tanstack/react-query";
import { t } from "../../i18n";
import { useOrg, useOrgApi } from "../../lib/org-context";
import { canSee } from "../../lib/permissions";

// Keyed by shop, so a response that arrives after a shop switch only writes its own shop's entry.
export const branchesKey = (orgId: string) => ["branches", orgId] as const;
export const subscriptionKey = (orgId: string) => ["subscription", orgId] as const;

/** #rule-branch-list — also the only source of one branch (there is no GET /branches/{id}). */
export function useBranches(enabled = true) {
  const o = useOrgApi();
  return useQuery({ ...o.queryOptions(branchesKey(o.orgId), () => o.request(branchList)), enabled });
}

/** §7: the branch screens are for owner and manager; other roles get the forbidden text and no request. */
export function useMaySeeBranches() {
  const { membership } = useOrg();
  return membership !== null && canSee("branches", membership.role);
}

export function useSubscription(enabled: boolean) {
  const o = useOrgApi();
  return useQuery({ ...o.queryOptions(subscriptionKey(o.orgId), () => o.request(subscriptionGet)), enabled });
}

/** #rule-branch-capacity as shown: every branch counts; `maxBranches` null = unlimited. */
export const underLimit = (s: SubscriptionGetResponse) => s.plan.maxBranches === null || s.usage.branches < s.plan.maxBranches;

export const limitText = (s: SubscriptionGetResponse) =>
  t("scr-settings-branches.limitReached", { plan: s.plan.name, max: s.plan.maxBranches ?? 0, used: s.usage.branches });
