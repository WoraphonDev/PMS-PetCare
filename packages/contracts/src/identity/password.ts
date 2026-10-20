import { z } from "zod";

// docs/spec/features/foundation.md#rule-F11 — every endpoint that sets a password uses this.
export const Password = z.string().min(10).max(128);
