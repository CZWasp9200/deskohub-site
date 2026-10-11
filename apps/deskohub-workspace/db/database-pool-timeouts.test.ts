import { expect, test } from "bun:test";
import { databasePoolTimeouts } from "./database-pool-timeouts";

test("connection acquisition waits longer than any allowed statement", () => {
  const { connectionTimeoutMillis, query_timeout, statement_timeout } =
    databasePoolTimeouts;

  expect(Number.isFinite(connectionTimeoutMillis)).toBe(true);
  expect(connectionTimeoutMillis).toBeGreaterThan(query_timeout);
  expect(connectionTimeoutMillis).toBeGreaterThan(statement_timeout);
});
