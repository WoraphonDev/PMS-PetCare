import { z } from "zod";

// docs/spec/features/foundation.md#ep-me.get — `{ user, memberships: [{ org, role, branches }] }`
export const StaffRole = z.enum(["owner", "manager", "front_desk", "groomer", "caretaker"]);

export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    // Managed accounts (F09) have no real email — null is returned instead of the internal placeholder.
    email: z.string().nullable(),
    username: z.string().nullable(),
    isPlatformAdmin: z.boolean(),
    mustChangePassword: z.boolean(),
    twoFactorEnabled: z.boolean(),
  }),
  memberships: z.array(
    z.object({
      org: z.object({ id: z.uuid(), slug: z.string(), displayName: z.string(), status: z.enum(["active", "suspended"]) }),
      role: StaffRole,
      branches: z.array(z.object({ id: z.uuid(), name: z.string() })),
    }),
  ),
});
export type MeResponse = z.infer<typeof MeResponse>;
