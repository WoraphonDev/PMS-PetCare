import { ApiError } from "@app/api-client";
import { t } from "../i18n";

export interface FormErrors {
  fields: Record<string, string>;
  form?: string;
}

/** Thai text for any failure: errors.ts per code; no HTTP response → the network text. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t("errors.INTERNAL");
  if (error.status === 0) return t("errors.network");
  return t(`errors.${error.code}`);
}

/** VALIDATION_FAILED `details.fields` → per-field messages for the fields this form shows; the rest is form-level. */
export function formErrors(error: unknown, fields: readonly string[]): FormErrors {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_FAILED") return { fields: {}, form: errorMessage(error) };
  const result: FormErrors = { fields: {} };
  const reported = (error.details?.fields ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(reported)) {
    if (fields.includes(key)) result.fields[key] = t("errors.VALIDATION_FAILED");
    else result.form = t("errors.VALIDATION_FAILED");
  }
  if (Object.keys(reported).length === 0) result.form = t("errors.VALIDATION_FAILED");
  return result;
}

/** Client-side contract check (`safeParse`) → the same per-field shape. */
// Structural type of a contract parse error, so the app needs no direct zod dependency.
type ParseError = { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> };

export function issueErrors(error: ParseError, messages: Record<string, string> = {}): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    fields[key] ??= messages[key] ?? t("errors.VALIDATION_FAILED");
  }
  return fields;
}
