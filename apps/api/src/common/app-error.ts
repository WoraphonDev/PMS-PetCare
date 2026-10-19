import type { ErrorCode } from "@app/contracts";

/** Business error carried to the client as `{ error: { code, message, details } }` (foundation#errors). */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
