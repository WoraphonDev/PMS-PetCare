import { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./support/test-db";

// T-0041: stop() must wait for every pool client's socket to close before Postgres stops,
// otherwise Postgres sends 57P01 to the still-open backends and the pool re-emits it as an
// unhandled 'error'.

const CLIENTS_PER_POOL = 3;

describe("createTestDb().stop()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes every idle pool client before stopping the container", async () => {
    const t = await createTestDb();
    const pools: pg.Pool[] = [t.runtimeDb.$client, t.platformDb.$client, t.migratorDb.$client];

    const poolErrors: unknown[] = [];
    let opened = 0;
    let ended = 0;
    for (const pool of pools) {
      pool.on("error", (err) => poolErrors.push(err));
      const clients = await Promise.all(Array.from({ length: CLIENTS_PER_POOL }, () => pool.connect()));
      for (const client of clients) {
        opened += 1;
        client.on("end", () => {
          ended += 1;
        });
        await client.query("select 1");
        client.release();
      }
    }
    expect(pools.map((p) => p.idleCount)).toEqual(pools.map(() => CLIENTS_PER_POOL));

    let endedWhenContainerStopped: number | undefined;
    const originalStop = StartedPostgreSqlContainer.prototype.stop;
    vi.spyOn(StartedPostgreSqlContainer.prototype, "stop").mockImplementation(function (
      this: StartedPostgreSqlContainer,
      ...args: Parameters<typeof originalStop>
    ) {
      endedWhenContainerStopped = ended;
      return originalStop.apply(this, args);
    });

    await t.stop();

    expect(endedWhenContainerStopped).toBe(opened);
    expect(ended).toBe(opened);
    expect(poolErrors).toEqual([]);
  });
});
