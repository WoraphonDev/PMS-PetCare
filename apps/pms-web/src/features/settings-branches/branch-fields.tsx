import type { Branch } from "@app/contracts";
import { t } from "../../i18n";
import { Field } from "../auth/field";

// Form state is text; these turn it into contract values (#contract-branch).
export type BranchValues = Record<"name" | "address" | "phone" | "latitude" | "longitude", string>;
export const emptyBranch: BranchValues = { name: "", address: "", phone: "", latitude: "", longitude: "" };

export const branchValues = (b: Branch): BranchValues => ({
  name: b.name,
  address: b.address ?? "",
  phone: b.phone ?? "",
  latitude: b.latitude === null ? "" : String(b.latitude),
  longitude: b.longitude === null ? "" : String(b.longitude),
});

/** Blank optional text → null (clears it). */
export const textOrNull = (value: string) => (value.trim() === "" ? null : value);
/** Blank → null; anything else as a JSON number (non-numbers fail the contract check). */
export const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

/** Both coordinates or neither: checked before the contract so the message can say so. */
export function coordsError(values: BranchValues): Record<string, string> {
  const lat = values.latitude.trim() === "";
  const lng = values.longitude.trim() === "";
  if (lat === lng) return {};
  return { [lat ? "latitude" : "longitude"]: t("scr-settings-branch.coordsTogether") };
}

export function BranchFields({
  values,
  errors,
  onChange,
  disabled,
}: {
  values: BranchValues;
  errors: Record<string, string>;
  onChange: (values: BranchValues) => void;
  disabled?: boolean;
}) {
  const field = (key: keyof BranchValues, extra: { inputMode?: "decimal" | "tel"; autoComplete?: string } = {}) => (
    <Field
      label={t(`scr-settings-branch.${key}`)}
      value={values[key]}
      error={errors[key]}
      disabled={disabled}
      onChange={(e) => onChange({ ...values, [key]: e.target.value })}
      {...extra}
    />
  );
  return (
    <>
      {field("name")}
      {field("address")}
      {field("phone", { inputMode: "tel", autoComplete: "tel" })}
      <div className="grid grid-cols-2 gap-3">
        {field("latitude", { inputMode: "decimal" })}
        {field("longitude", { inputMode: "decimal" })}
      </div>
    </>
  );
}
