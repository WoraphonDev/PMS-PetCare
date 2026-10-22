/**
 * ErrorFilter logs `{ err }`, and a DrizzleQueryError (or a pg error's `detail`) carries the query params — a PromptPay
 * ID, an email address. Only the SQLSTATE survives into the INTERNAL log entry (AGENTS.md rule 9).
 */
export function withoutParams(operation: string, error: unknown): Error {
  let e = error as { code?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; e && typeof e === "object" && depth < 5; depth++, e = e.cause as typeof e) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return new Error(`${operation} failed (SQLSTATE ${e.code})`);
  }
  return new Error(`${operation} failed`);
}
