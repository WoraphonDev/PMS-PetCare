import { sql } from "drizzle-orm";
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

/** Parameterized SQL on the caller's transaction; never obtains another connection or commits. */
export function transactionQuery(tx: Tx) {
  return <Row extends Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) =>
    tx.execute<Row>(sql(strings, ...values));
}
