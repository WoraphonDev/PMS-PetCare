import { z } from "zod";

// docs/spec/features/foundation.md §10 shared rules: strings are trimmed first and measured like PostgreSQL
// char_length (code points); a blank string after trim is invalid.
export const Text = (max: number) =>
  z
    .string()
    .trim()
    .refine((value) => {
      const length = [...value].length;
      return length >= 1 && length <= max;
    }, `Must be 1-${max} characters`);

/** Strict body: every unknown key is reported under its own name (`details.fields.<key>`), not as one root issue. */
export const strictBody = <S extends z.ZodRawShape>(shape: S) =>
  z.preprocess((value, ctx) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(shape, key)) ctx.addIssue({ code: "custom", path: [key], message: "Field is not allowed" });
      }
    }
    return value;
  }, z.object(shape));

const coordinate = (limit: number) =>
  z
    .number()
    .min(-limit)
    .max(limit)
    // More than 6 decimals is rejected, never rounded (#contract-branch).
    .refine((value) => Number(value.toFixed(6)) === value, "At most 6 decimal places");
export const Latitude = coordinate(90).nullable();
export const Longitude = coordinate(180).nullable();

/** #contract-branch: latitude/longitude are sent together or not at all, and are both numbers or both null. */
export function coordinatePair(value: { latitude?: number | null; longitude?: number | null }, ctx: z.RefinementCtx): void {
  const lat = value.latitude;
  const lng = value.longitude;
  if ((lat === undefined) !== (lng === undefined) || (lat === null) !== (lng === null)) {
    const path = lat === undefined || lat === null ? "latitude" : "longitude";
    ctx.addIssue({ code: "custom", path: [path], message: "latitude and longitude must be set together" });
  }
}

/** PATCH bodies must carry at least one field (§10). */
export function notEmpty(value: object, ctx: z.RefinementCtx): void {
  if (Object.keys(value).length === 0) ctx.addIssue({ code: "custom", message: "At least one field is required" });
}

const MOBILE = /^0\d{9}$/;
const THIRTEEN_DIGITS = /^\d{13}$/;

/**
 * #rule-branch-promptpay-format (F08): a mobile number, or 13 digits whose check digit matches the PMS validation policy
 * of T-0014-02 — S = Σ d_i × (14 − i) over d1…d12, check = (11 − S mod 11) mod 10. A valid check digit only catches typos;
 * it says nothing about PromptPay registration or account ownership.
 */
export function isPromptpayId(value: string): boolean {
  if (MOBILE.test(value)) return true;
  if (!THIRTEEN_DIGITS.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 12).reduce((s, d, i) => s + d * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === digits[12];
}

/** Trimmed only: inner dashes or spaces and `+66` are rejected, never normalised. */
export const PromptpayId = z
  .string()
  .trim()
  .refine(isPromptpayId, "Must be a mobile number (0 and 9 digits) or a 13-digit ID with a valid check digit");
