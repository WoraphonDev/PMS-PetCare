import { orgGet, orgUpdate } from "@app/api-client";
import { type Organization, OrgUpdateRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { errorMessage, type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { useOrg, useOrgApi } from "../../lib/org-context";
import { can } from "../../lib/permissions";
import { Field, FormMessage } from "../auth/field";

// foundation#scr-settings-org — owner only (org.update); other roles get the forbidden text and no request.
// Keyed by shop: a save answered after a shop switch lands in its own shop's entry, never the current one.
const orgKey = (orgId: string) => ["org", orgId] as const;
const fields = ["displayName", "legalName", "taxId", "phone", "receiptFooter"] as const;
type Values = Record<(typeof fields)[number], string>;

const toValues = (org: Organization): Values => ({
  displayName: org.displayName,
  legalName: org.legalName ?? "",
  taxId: org.taxId ?? "",
  phone: org.phone ?? "",
  receiptFooter: org.receiptFooter ?? "",
});

/** Only changed fields; a blank optional field → null. `displayName` is never null (the contract rejects it). */
function changes(initial: Values, values: Values): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  for (const key of fields) {
    if (values[key] === initial[key]) continue;
    body[key] = key !== "displayName" && values[key].trim() === "" ? null : values[key];
  }
  return body;
}

export function OrgScreen() {
  const { membership } = useOrg();
  const isOwner = membership !== null && can(membership.role, "org.settings.update");
  const o = useOrgApi();
  const query = useQuery({ ...o.queryOptions(orgKey(o.orgId), () => o.request(orgGet)), enabled: isOwner });
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("scr-settings-org.title")}</h1>
      {!isOwner ? (
        <p>{t("errors.FORBIDDEN")}</p>
      ) : query.data ? (
        // Re-mount per shop only: a background refetch must not drop unsaved edits.
        <OrgForm key={o.orgId} org={query.data} saved={saved} onSaved={setSaved} />
      ) : (
        query.error && <FormMessage>{errorMessage(query.error)}</FormMessage>
      )}
    </div>
  );
}

function OrgForm({ org: latest, saved, onSaved }: { org: Organization; saved: boolean; onSaved: (saved: boolean) => void }) {
  const o = useOrgApi();
  const queryClient = useQueryClient();
  // `org` is the server copy the form started from; newer server data replaces it only while the form is
  // untouched (or on save), so a refetch never drops unsaved edits.
  const [org, setOrg] = useState(latest);
  const [values, setValues] = useState(() => toValues(latest));
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const initial = toValues(org);
  const body = changes(initial, values);
  const reset = (o: Organization) => {
    setOrg(o);
    setValues(toValues(o));
  };
  if (latest !== org && Object.keys(body).length === 0) reset(latest);
  const mutation = useMutation({
    ...o.mutationOptions((data: OrgUpdateRequest) => o.request(orgUpdate, { body: data })),
    onSuccess: (updated) => {
      reset(updated);
      onSaved(true);
      queryClient.setQueryData(orgKey(updated.id), updated);
    },
    onError: (error) => setErrors(formErrors(error, fields)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = OrgUpdateRequest.safeParse(body);
    if (!parsed.success) {
      setErrors({ fields: issueErrors(parsed.error) });
      return;
    }
    setErrors({ fields: {} });
    mutation.mutate(parsed.data);
  }

  const field = (key: (typeof fields)[number], extra: { inputMode?: "numeric" | "tel" } = {}) => (
    <Field
      label={t(`scr-settings-org.${key}`)}
      value={values[key]}
      error={errors.fields[key]}
      onChange={(e) => {
        onSaved(false);
        setValues((v) => ({ ...v, [key]: e.target.value }));
      }}
      {...extra}
    />
  );

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("scr-settings-org.slug")}</dt>
        <dd>{org.slug}</dd>
        <dt className="text-muted-foreground">{t("scr-settings-org.status")}</dt>
        <dd>{t(org.status === "active" ? "scr-settings-org.statusActive" : "scr-settings-org.statusSuspended")}</dd>
      </dl>
      {field("displayName")}
      {field("legalName")}
      {field("taxId", { inputMode: "numeric" })}
      {field("phone", { inputMode: "tel" })}
      {field("receiptFooter")}
      <FormMessage>{errors.form}</FormMessage>
      {saved && <p className="text-sm">{t("scr-settings-org.saved")}</p>}
      <Button type="submit" disabled={mutation.isPending || Object.keys(body).length === 0}>
        {t("scr-settings-org.save")}
      </Button>
    </form>
  );
}
