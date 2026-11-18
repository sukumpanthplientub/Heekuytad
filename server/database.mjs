import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";
import { databaseOptions } from "./database-url.mjs";

export function createDatabase(connectionString) {
  const { connectionString: url, schema } = databaseOptions(connectionString);
  const adapter = new PrismaPg(
    {
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      query_timeout: 20000,
      application_name: "supersix-studio",
    },
    { schema },
  );
  return new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 5000, timeout: 20000 },
  });
}
