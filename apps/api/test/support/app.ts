import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Config } from "../../src/config";
import { createApp } from "../../src/create-app";

export const testConfig: Config = {
  NODE_ENV: "test",
  PORT: 0,
  APP_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "postgres://app_runtime:x@localhost:5432/pms",
  VALKEY_URL: "redis://localhost:6379",
  BUILD_SHA: "test-sha",
};

/** Boots the API in-process (no listening socket); requests go through `app.inject`. */
export async function bootTestApp(extraModules: unknown[] = []): Promise<NestFastifyApplication> {
  const app = await createApp(testConfig, { extraModules: extraModules as never[], logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
