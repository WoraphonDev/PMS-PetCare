import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Infra } from "../../src/common/db";
import type { Config } from "../../src/config";
import { createApp } from "../../src/create-app";

export const testConfig: Config = {
  NODE_ENV: "test",
  PORT: 0,
  APP_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "postgres://app_runtime:x@localhost:5432/pms",
  DATABASE_PLATFORM_URL: "postgres://app_platform:x@localhost:5432/pms",
  VALKEY_URL: "redis://localhost:6379",
  BUILD_SHA: "test-sha",
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
};

/** Boots the API in-process (no listening socket); requests go through `app.inject`. */
export async function bootTestApp(
  extraModules: unknown[] = [],
  logStream?: { write(line: string): void },
  infra?: Infra,
): Promise<NestFastifyApplication> {
  const app = await createApp(testConfig, {
    extraModules: extraModules as never[],
    ...(logStream ? { logStream } : { logger: false }),
    ...(infra ? { infra } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
