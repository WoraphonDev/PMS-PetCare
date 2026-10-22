import { z } from "zod";
import { strictBody, Text } from "./fields";

// docs/spec/features/foundation.md#rule-branch-closure-calendar — exact ASCII YYYY-MM-DD, years 0001–9999, real proleptic
// Gregorian dates. Checked arithmetically: JS Date would normalize invalid dates and remap years 00–99.
const LOCAL_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
function isLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return year >= 1 && days !== undefined && day >= 1 && day <= days;
}
export const LocalDate = z.string().refine(isLocalDate, "Expected a real YYYY-MM-DD date in years 0001-9999");

// #contract-branch-closures: PostgreSQL UTF-8 text cannot store U+0000 or unpaired surrogates — reject them as field errors.
const Reason = Text(500).refine((value) => !value.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(value), "Invalid character");

export const BranchClosureCreateRequest = strictBody({
  startDate: LocalDate,
  endDate: LocalDate,
  reason: Reason.nullable().default(null),
}).superRefine((body, ctx) => {
  if (body.startDate > body.endDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "endDate must not be before startDate" });
});
export type BranchClosureCreateRequest = z.infer<typeof BranchClosureCreateRequest>;

// Exact DTO: lowercase UUIDs, inclusive local dates, reason always present, canonical UTC ISO instants; no orgId/version.
export const Closure = z.strictObject({
  id: z.uuid(),
  branchId: z.uuid(),
  startDate: LocalDate,
  endDate: LocalDate,
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Closure = z.infer<typeof Closure>;
export const BRANCH_CLOSURE_CREATE_STATUS = 201;
