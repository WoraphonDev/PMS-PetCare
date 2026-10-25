import type { Branch } from "@app/contracts";
import { useId } from "react";
import { t } from "../../i18n";
import { canManageMember, type Role } from "../../lib/permissions";

const ROLES: readonly Role[] = ["owner", "manager", "front_desk", "groomer", "caretaker"];
export const isBranchRole = (role: Role) => role !== "owner" && role !== "manager";

/** #permissions ¹ — owner may assign every role; manager only the branch roles. */
export const assignableRoles = (actor: Role) => ROLES.filter((role) => canManageMember(actor, role));

export interface RoleBranches {
  role: Role;
  branchIds: string[];
}

/** owner/manager take no branch (sent as []); a branch role needs ≥ 1 (F02). */
export const roleBranchesBody = ({ role, branchIds }: RoleBranches) => ({ role, branchIds: isBranchRole(role) ? branchIds : [] });

export const missingBranch = (value: RoleBranches) => isBranchRole(value.role) && value.branchIds.length === 0;

export function RolePicker({ actor, value, onChange }: { actor: Role; value: Role; onChange: (role: Role) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {t("scr-staff.role")}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as Role)}
        className="h-10 rounded-md border border-input bg-background px-3 text-base"
      >
        {assignableRoles(actor).map((role) => (
          <option key={role} value={role}>
            {t(`shell.role.${role}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Multi-select over the shop's branches (inactive ones included); `ids` keeps the branch list order. */
export function BranchPicker({
  branches,
  value,
  error,
  onChange,
}: {
  branches: readonly Branch[];
  value: readonly string[];
  error?: string;
  onChange: (ids: string[]) => void;
}) {
  const id = useId();
  const toggle = (branchId: string) =>
    onChange(branches.map((b) => b.id).filter((b) => (b === branchId ? !value.includes(b) : value.includes(b))));
  return (
    <fieldset aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} className="flex flex-col gap-1">
      <legend className="text-sm font-medium">{t("scr-staff.branches")}</legend>
      {branches.map((b) => (
        <label key={b.id} className="flex items-center gap-2">
          <input type="checkbox" checked={value.includes(b.id)} onChange={() => toggle(b.id)} />
          {b.name}
        </label>
      ))}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Role select plus the branch picker, which is shown only for a branch role. */
export function RoleBranchFields({
  actor,
  branches,
  value,
  error,
  onChange,
}: {
  actor: Role;
  branches: readonly Branch[];
  value: RoleBranches;
  error?: string;
  onChange: (value: RoleBranches) => void;
}) {
  return (
    <>
      <RolePicker actor={actor} value={value.role} onChange={(role) => onChange({ ...value, role })} />
      {isBranchRole(value.role) && (
        <BranchPicker
          branches={branches}
          value={value.branchIds}
          error={error}
          onChange={(branchIds) => onChange({ ...value, branchIds })}
        />
      )}
    </>
  );
}
