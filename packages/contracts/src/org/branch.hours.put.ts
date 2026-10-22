import { z } from "zod";
import { strictBody } from "./fields";

// docs/spec/features/foundation.md#contract-branch-hours — ASCII HH:mm 00:00–23:59, never trimmed or rounded.
export const HhMm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Expected HH:mm (00:00-23:59)");
const Weekday = z.number().int().min(1).max(7); // ISO: 1 = Monday … 7 = Sunday

// Both null = closed all day; otherwise both set and opensAt < closesAt (no equal, reversed or overnight intervals).
const BranchHoursItem = strictBody({ weekday: Weekday, opensAt: HhMm.nullable(), closesAt: HhMm.nullable() }).superRefine((day, ctx) => {
  if ((day.opensAt === null) !== (day.closesAt === null)) {
    const path = day.opensAt === null ? "opensAt" : "closesAt";
    ctx.addIssue({ code: "custom", path: [path], message: "opensAt and closesAt must both be null or both be set" });
  } else if (day.opensAt !== null && day.closesAt !== null && day.opensAt >= day.closesAt) {
    ctx.addIssue({ code: "custom", path: ["closesAt"], message: "closesAt must be after opensAt" });
  }
});

/** Full-week replacement: exactly 7 items, each ISO weekday once (`items` for the count, `items.<i>.weekday` for repeats). */
export const BranchHoursPutRequest = strictBody({ items: z.array(BranchHoursItem) }).superRefine((body, ctx) => {
  if (body.items.length !== 7) ctx.addIssue({ code: "custom", path: ["items"], message: "Expected exactly 7 days" });
  const seen = new Set<number>();
  for (const [i, day] of body.items.entries()) {
    if (seen.has(day.weekday)) ctx.addIssue({ code: "custom", path: ["items", i, "weekday"], message: "Duplicate weekday" });
    seen.add(day.weekday);
  }
});
export type BranchHoursPutRequest = z.infer<typeof BranchHoursPutRequest>;

// Exact projection sorted by weekday: no id, branchId, orgId, timestamps or version.
export const BranchHoursPutResponse = z.strictObject({
  items: z.array(z.strictObject({ weekday: Weekday, opensAt: HhMm.nullable(), closesAt: HhMm.nullable() })),
});
export type BranchHoursPutResponse = z.infer<typeof BranchHoursPutResponse>;
export const BRANCH_HOURS_PUT_STATUS = 200;
