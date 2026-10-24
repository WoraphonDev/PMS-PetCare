import { branchList, subscriptionGet } from "@app/api-client";
import type { SubscriptionGetResponse } from "@app/contracts";
import { useQuery } from "@tanstack/react-query";
import { t } from "../../i18n";
import { useOrgApi } from "../../lib/org-context";

// Shop-scoped keys: the org context drops them when the shop changes.
export const branchesKey = ["branches"] as const;
export const subscriptionKey = ["subscription"] as const;

/** #rule-branch-list — also the only source of one branch (there is no GET /branches/{id}). */
export function useBranches() {
  const o = useOrgApi();
  return useQuery(o.queryOptions(branchesKey, () => o.request(branchList)));
}

export function useSubscription(enabled: boolean) {
  const o = useOrgApi();
  return useQuery({ ...o.queryOptions(subscriptionKey, () => o.request(subscriptionGet)), enabled });
}

/** #rule-branch-capacity as shown: every branch counts; `maxBranches` null = unlimited. */
export const underLimit = (s: SubscriptionGetResponse) => s.plan.maxBranches === null || s.usage.branches < s.plan.maxBranches;

export const limitText = (s: SubscriptionGetResponse) =>
  t("scr-settings-branches.limitReached", { plan: s.plan.name, max: s.plan.maxBranches ?? 0, used: s.usage.branches });
