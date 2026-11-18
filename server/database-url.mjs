import { fileURLToPath } from "node:url";

export function databaseUrl(value) {
  if (!value) throw new Error("Set DATABASE_URL in .env or the server environment");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Database URL must be a PostgreSQL connection URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Database URL must be a PostgreSQL connection URL");
  const schema = url.searchParams.get("schema") || "supersix";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid database schema name");
  url.searchParams.set("schema", schema);
  if (url.hostname.endsWith(".pooler.supabase.com") || url.hostname.endsWith(".supabase.co")) {
    url.searchParams.set("sslmode", "verify-full");
    if (!url.searchParams.has("sslrootcert"))
      url.searchParams.set(
        "sslrootcert",
        fileURLToPath(new URL("../certs/supabase-ca.crt", import.meta.url)),
      );
  }
  return url;
}

export function databaseOptions(value) {
  const url = databaseUrl(value);
  const schema = url.searchParams.get("schema");
  // pg does not apply Prisma's schema parameter; pass it to the adapter explicitly.
  url.searchParams.delete("schema");
  url.searchParams.delete("pgbouncer");
  return { connectionString: url.toString(), schema };
}
