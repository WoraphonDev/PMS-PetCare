import { createDb, type Db } from "@app/db";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import Valkey from "iovalkey";
import type { Config } from "../config";

export const RUNTIME_DB = Symbol("RUNTIME_DB"); // app_runtime — RLS applies; tenant data only via withTenant
export const PLATFORM_DB = Symbol("PLATFORM_DB"); // app_platform — BYPASSRLS; identity + cross-org reads
export const VALKEY = Symbol("VALKEY");

export interface Infra {
  runtimeDb: Db;
  platformDb: Db;
  valkey: Valkey;
}

/** Connections are lazy: nothing connects until first use, so the app boots without a database (health check). */
export function createInfra(config: Config): Infra {
  return {
    runtimeDb: createDb(config.DATABASE_URL),
    platformDb: createDb(config.DATABASE_PLATFORM_URL),
    valkey: new Valkey(config.VALKEY_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }),
  };
}

@Injectable()
export class InfraLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(RUNTIME_DB) private readonly runtimeDb: Db,
    @Inject(PLATFORM_DB) private readonly platformDb: Db,
    @Inject(VALKEY) private readonly valkey: Valkey,
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled([this.runtimeDb.$client.end(), this.platformDb.$client.end(), this.valkey.quit()]);
  }
}
