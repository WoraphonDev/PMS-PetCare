import { z } from "zod";

// docs/spec/features/foundation.md#errors
export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "ORG_SUSPENDED",
  "PLAN_LIMIT_REACHED",
  "LAST_OWNER",
  "BRANCH_REQUIRED",
  "INVITATION_INVALID",
  "ALREADY_MEMBER",
  "RATE_LIMITED",
  "INTERNAL",
  "PASSWORD_CHANGE_REQUIRED",
  "MANAGED_ACCOUNT_ONLY",
  "TWO_FACTOR_REQUIRED",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const errorHttpStatus = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ORG_SUSPENDED: 423,
  PLAN_LIMIT_REACHED: 402,
  LAST_OWNER: 409,
  BRANCH_REQUIRED: 400,
  INVITATION_INVALID: 410,
  ALREADY_MEMBER: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PASSWORD_CHANGE_REQUIRED: 403,
  MANAGED_ACCOUNT_ONLY: 409,
  TWO_FACTOR_REQUIRED: 403,
} as const satisfies Record<ErrorCode, number>;

export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
