import type { Clock } from "@app/domain";

/** Per-request context passed to every use case (docs/spec/01-conventions.md#requestcontext). Grows with later cards. */
export interface RequestContext {
  requestId: string;
  now: Date;
  buildSha: string;
}

export const CLOCK = Symbol("CLOCK");
export const CONFIG = Symbol("CONFIG");
export type { Clock };
