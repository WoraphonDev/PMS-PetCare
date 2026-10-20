import Valkey from "iovalkey";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
// Reuses @app/db's harness (roles, migrations, RLS) — imported by path, it is test-only and not part of the package API.
import { createTestDb, type TestDb } from "../../../../packages/db/test/support/test-db";
import type { Infra } from "../../src/common/db";

export interface TestInfra extends Infra {
  db: TestDb;
  stop(): Promise<void>;
}

export async function createTestInfra(): Promise<TestInfra> {
  const [db, valkeyContainer] = await Promise.all([
    createTestDb(),
    new GenericContainer("valkey/valkey:8-alpine").withExposedPorts(6379).start() as Promise<StartedTestContainer>,
  ]);
  const valkey = new Valkey(valkeyContainer.getMappedPort(6379), valkeyContainer.getHost());
  return {
    db,
    runtimeDb: db.runtimeDb,
    platformDb: db.platformDb,
    valkey,
    async stop() {
      await valkey.quit().catch(() => undefined);
      await Promise.all([db.stop(), valkeyContainer.stop()]);
    },
  };
}
