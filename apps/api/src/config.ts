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
  /** Comma-separated proxy IPs/CIDRs from the deployment operator; absent means trust none. */
  TRUSTED_PROXY_CIDRS: z
    .string()
    .transform((value) => value.split(",").map((part) => part.trim()))
    .pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()])).min(1))
    .optional(),
  BUILD_SHA: z.string().min(1).default("dev"),
  /** Signs session cookies (Better Auth). ≥ 32 random characters. */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Outgoing email (ADR-0005). Required except in tests (createEmailSender); local dev → Mailpit. */
  SMTP_URL: z.url().optional(),
  MAIL_FROM: z.string().min(3).optional(),
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
