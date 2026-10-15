import { mkdtemp, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

/** The Workspace Drizzle migrations. */
export const workspaceMigrationsFolder = fileURLToPath(
  new URL("./migrations", import.meta.url)
);

/**
 * Links every migration that precedes `migration` into a scratch folder, so
 * a database can be brought to the state production is in before it.
 */
export const linkMigrationsBefore = async (migration: string) => {
  const folder = await mkdtemp(join(tmpdir(), "workspace-migrations-"));
  const names = await readdir(workspaceMigrationsFolder);
  for (const name of names.filter((entry) => entry < migration)) {
    await symlink(join(workspaceMigrationsFolder, name), join(folder, name));
  }
  return folder;
};

/**
 * Creates a disposable sibling database next to the configured test
 * database, runs the callback against it, and always drops it.
 */
export const withScratchDatabase = async (
  databaseUrl: string,
  namePrefix: string,
  run: (pool: Pool) => Promise<void>
) => {
  const name = `${namePrefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create database "${name}"`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  try {
    await run(pool);
  } finally {
    await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
};
