import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

/** Inserts a synthetic session owned by `approvedBy` and rolls it back. */
const insertSessionOwnedBy = async (approvedBy: string | null) => {
  const client = await postgresDatabase!.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into cli_sessions (approved_by, token_hash, client_name, cli_version, build_target)
       values ($1, repeat('a', 43), 'Synthetic CLI', '1.0.0', 'development')`,
      [approvedBy]
    );
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
};

describe.skipIf(!postgresDatabase)("cli session ownership on Postgres", () => {
  test("stores a session owned by a syntactically valid administrator", async () => {
    await expect(
      insertSessionOwnedBy("alice.admin-1")
    ).resolves.toBeUndefined();
  });

  test("rejects a session without an owner", async () => {
    await expect(insertSessionOwnedBy(null)).rejects.toMatchObject({
      code: "23502",
    });
  });

  test.each(["Alice", " alice", "-alice", "alice smith", "a".repeat(81)])(
    "rejects a session owned by the malformed administrator %p",
    async (approvedBy) => {
      await expect(insertSessionOwnedBy(approvedBy)).rejects.toMatchObject({
        code: "23514",
        constraint: "cli_sessions_approved_by_check",
      });
    }
  );
});
