import { loadConfiguration } from "../server/config.mjs";
import { createDatabase } from "../server/database.mjs";

const db = createDatabase(loadConfiguration().databaseUrl);
try {
  await db.$connect();
  const [jobs, assets, settings] = await Promise.all([
    db.job.count(),
    db.asset.count(),
    db.settings.count(),
  ]);
  console.log(JSON.stringify({ ok: true, provider: "postgresql", jobs, assets, settings }));
} catch (error) {
  console.error("Database check failed:", error.code || error.name);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
