/** Source of the current instant. Domain and use-case code must take a Clock instead of calling `new Date()`. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

// Full ISO 8601 instant with an explicit zone: 2026-10-20T03:00:00Z, 2026-10-20T10:00:00.123+07:00
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A clock frozen at `iso` (for tests). Throws if `iso` is not a valid ISO instant with a zone. */
export function fixedClock(iso: string): Clock {
  const match = ISO_INSTANT.exec(iso);
  const ms = Date.parse(iso);
  if (!match || Number.isNaN(ms)) throw new RangeError(`fixedClock: invalid ISO instant ${JSON.stringify(iso)}`);
  const [, year, month, day] = match;
  // Date.parse rolls over impossible dates (2026-02-30 → 2026-03-02); reject them.
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)) {
    throw new RangeError(`fixedClock: invalid ISO instant ${JSON.stringify(iso)}`);
  }
  return { now: () => new Date(ms) };
}
