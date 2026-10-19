import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Drizzle client over a node-postgres pool. Close with `db.$client.end()`. */
export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  return drizzle({ client: pool, schema, casing: "snake_case" });
}
