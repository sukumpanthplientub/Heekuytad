import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { loadConfiguration, PROJECT_ROOT } from "./config.mjs";
import { databaseUrl as normalizeUrl } from "./database-url.mjs";

// Tests never clear or reset the application's schema. Each test owns a random
// schema, applies the checked-in migrations there, and drops only that schema.
export async function createTestDatabase() {
  const config = loadConfiguration();
  const runtime = normalizeUrl(config.databaseUrl);
  const direct = normalizeUrl(process.env.DIRECT_URL || config.databaseUrl);
  const schema = `supersix_test_${randomUUID().replaceAll("-", "")}`;
  runtime.searchParams.set("schema", schema);
  direct.searchParams.delete("schema");
  const client = new pg.Client({
    connectionString: direct.toString(),
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  let created = false;
  const close = async () => {
    try {
      if (created) {
        if (!/^supersix_test_[0-9a-f]{32}$/.test(schema)) throw new Error("Unsafe test schema");
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        created = false;
      }
    } finally {
      await client.end();
    }
  };
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query("SELECT set_config('search_path', $1, false)", [schema]);
    const migrationsPath = path.join(PROJECT_ROOT, "prisma", "migrations");
    const folders = (await readdir(migrationsPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const folder of folders)
      await client.query(
        await readFile(path.join(migrationsPath, folder, "migration.sql"), "utf8"),
      );
    return { url: runtime.toString(), client, schema, close };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await close();
    throw error;
  }
}
