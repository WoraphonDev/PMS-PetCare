import type { PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { AppError } from "../../common/app-error";

/**
 * Like common ZodBody, but `details.fields` has no prototype: the strict org bodies report every unknown key by name
 * (#contract-org, #contract-branch), and a key such as `toString` or `constructor` must not hit Object.prototype.
 */
export class OrgBody<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    const fields: Record<string, string[]> = Object.create(null);
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] = [...(fields[key] ?? []), issue.message];
    }
    throw new AppError("VALIDATION_FAILED", "Invalid request", { fields });
  }
}

/**
 * GET/DELETE schedule routes take no body (#contract-branch-schedule-common): absent or zero-byte only. Checked on the
 * headers because Fastify never parses a GET body.
 */
export function assertNoBody(headers: Record<string, string | string[] | undefined>): void {
  const length = headers["content-length"];
  if (headers["transfer-encoding"] !== undefined || (length !== undefined && length !== "0")) {
    throw new AppError("VALIDATION_FAILED", "Invalid request", { fields: { _: ["Request body is not allowed"] } });
  }
}
