import { ApiError, branchCreate } from "@app/api-client";
import { type Branch, BranchCreateRequest, type BranchListResponse, type SubscriptionGetResponse } from "@app/contracts";
import { Button } from "@app/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useRef, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { useOrgApi } from "../../lib/org-context";
import { FormMessage } from "../auth/field";
import { BranchFields, coordsError, emptyBranch, numberOrNull, textOrNull } from "./branch-fields";
import { branchesKey, limitText, subscriptionKey } from "./queries";

// foundation#ep-branch.create — omitted optional fields are sent as null.
export function CreateBranchDialog({ subscription }: { subscription: SubscriptionGetResponse }) {
  const o = useOrgApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const current = useRef(o.orgId);
  current.current = o.orgId;
  const [values, setValues] = useState(emptyBranch);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const mutation = useMutation({
    // The shop goes with the variables: callbacks run with the latest render, which may be another shop by then.
    ...o.mutationOptions(({ body }: { orgId: string; body: BranchCreateRequest }) => o.request(branchCreate, { body })),
    onSuccess: async (created: Branch, { orgId }) => {
      // Known before the refetch, so the detail page never flashes "not found".
      queryClient.setQueryData<BranchListResponse>(branchesKey(orgId), (list) => list && { items: [...list.items, created] });
      void queryClient.invalidateQueries({ queryKey: branchesKey(orgId) });
      void queryClient.invalidateQueries({ queryKey: subscriptionKey(orgId) });
      if (orgId !== current.current) return;
      await navigate({ to: "/settings/branches/$branchId", params: { branchId: created.id } });
    },
    onError: (error, { orgId }) => {
      if (error instanceof ApiError && error.code === "PLAN_LIMIT_REACHED") {
        void queryClient.invalidateQueries({ queryKey: subscriptionKey(orgId) });
        setErrors({ fields: {}, form: limitText(subscription) });
      } else if (error instanceof ApiError && error.code === "CONFLICT") {
        setErrors({ fields: { name: t("scr-settings-branches.nameTaken") } });
      } else {
        setErrors(formErrors(error, Object.keys(emptyBranch)));
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const pair = coordsError(values);
    const parsed = BranchCreateRequest.safeParse({
      name: values.name,
      address: textOrNull(values.address),
      phone: textOrNull(values.phone),
      latitude: numberOrNull(values.latitude),
      longitude: numberOrNull(values.longitude),
    });
    if (!parsed.success || Object.keys(pair).length > 0) {
      setErrors({ fields: { ...(parsed.success ? {} : issueErrors(parsed.error)), ...pair } });
      return;
    }
    setErrors({ fields: {} });
    mutation.mutate({ orgId: o.orgId, body: parsed.data });
  }

  return (
    <div role="dialog" aria-modal="false" aria-label={t("scr-settings-branches.add")} className="rounded-md border p-4">
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <BranchFields values={values} errors={errors.fields} onChange={setValues} />
        <FormMessage>{errors.form}</FormMessage>
        <Button type="submit" disabled={mutation.isPending}>
          {t("scr-settings-branches.add")}
        </Button>
      </form>
    </div>
  );
}
