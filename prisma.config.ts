import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "prisma/config";
import { databaseUrl } from "./server/database-url.mjs";

if (existsSync(".env")) loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Only the CLI uses the session connection. Runtime uses DATABASE_URL.
  datasource: {
    url:
      process.env.DIRECT_URL || process.env.DATABASE_URL
        ? databaseUrl(process.env.DIRECT_URL || process.env.DATABASE_URL).toString()
        : undefined,
  },
});
