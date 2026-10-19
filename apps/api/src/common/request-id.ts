import { randomUUID } from "node:crypto";

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Uses the caller's X-Request-Id when it is short and log-safe, otherwise a new UUID. */
export function requestIdFrom(headers: Record<string, string | string[] | undefined>): string {
  const incoming = headers["x-request-id"];
  return typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
}
