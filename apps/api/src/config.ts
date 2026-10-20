import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  APP_ORIGIN: z.url(),
  /** app_runtime — RLS applies (ADR-0003). */
  DATABASE_URL: z.url(),
  /** app_platform — BYPASSRLS, only for withPlatform() work. */
  DATABASE_PLATFORM_URL: z.url(),
  VALKEY_URL: z.url(),
  BUILD_SHA: z.string().min(1).default("dev"),
  /** Signs session cookies (Better Auth). ≥ 32 random characters. */
  BETTER_AUTH_SECRET: z.string().min(32),
});
export type Config = z.infer<typeof Env>;

/** Parses the environment. On failure throws naming only the invalid keys — values may be secrets. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].sort();
    throw new Error(`Invalid environment: ${keys.join(", ")}`);
  }
  return parsed.data;
}
