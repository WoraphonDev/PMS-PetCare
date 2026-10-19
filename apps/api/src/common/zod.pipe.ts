import type { PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { AppError } from "./app-error";

/** `details.fields` shape for VALIDATION_FAILED: dotted path → messages. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] = [...(fields[key] ?? []), issue.message];
  }
  return fields;
}

/** Validates a request part with a zod schema; failure → 400 VALIDATION_FAILED. */
export class ZodBody<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Invalid request", { fields: fieldErrors(parsed.error) });
    return parsed.data;
  }
}
