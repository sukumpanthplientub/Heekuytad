import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createDatabase } from "../server/database.mjs";
import { loadConfiguration } from "../server/config.mjs";

export async function importSqlite(file, databaseUrl) {
  if (!existsSync(file)) throw new Error("SQLite source file does not exist");
  const source = new DatabaseSync(file, { readOnly: true });
  let jobs, assets, settings;
  try {
    const version = source.prepare("SELECT version FROM schema_version").get();
    if (version?.version !== 1) throw new Error("Unsupported SQLite schema version");
    jobs = source
      .prepare("SELECT * FROM jobs")
      .all()
      .map((row) => ({ ...row, archived: !!row.archived }));
    assets = source.prepare("SELECT * FROM assets").all();
    settings = source
      .prepare("SELECT * FROM settings")
      .all()
      .map((row) => ({ ...row, reel_enabled: !!row.reel_enabled }));
  } finally {
    source.close();
  }
  const db = createDatabase(databaseUrl);
  try {
    await db.$transaction(
      async (tx) => {
        if ((await tx.job.count()) || (await tx.asset.count()) || (await tx.settings.count()))
          throw new Error("Import requires an empty target schema; no records were changed");
        for (let index = 0; index < jobs.length; index += 200)
          await tx.job.createMany({ data: jobs.slice(index, index + 200) });
        for (let index = 0; index < assets.length; index += 200)
          await tx.asset.createMany({ data: assets.slice(index, index + 200) });
        if (settings.length) await tx.settings.createMany({ data: settings });
      },
      { isolationLevel: "Serializable", timeout: 120000 },
    );
    return { jobs: jobs.length, assets: assets.length, settings: settings.length };
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run db:import-sqlite -- /path/to/studio.sqlite (stop the app first)");
    process.exitCode = 1;
  } else {
    try {
      console.log(
        JSON.stringify(await importSqlite(path.resolve(file), loadConfiguration().databaseUrl)),
      );
    } catch (error) {
      console.error("SQLite import failed:", error.code || error.message);
      process.exitCode = 1;
    }
  }
}
