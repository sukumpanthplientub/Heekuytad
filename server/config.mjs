import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfiguration() {
  const envFile = path.join(PROJECT_ROOT, ".env");
  if (existsSync(envFile)) loadEnvFile(envFile);
  return configurationFrom(process.env, process.argv);
}

export function configurationFrom(env = {}, argv = []) {
  const dev = argv.includes("--dev");
  const hosted = !dev;
  const portFlag = argv.indexOf("--port");
  const port = Number(portFlag === -1 ? (hosted ? 10000 : 3000) : argv[portFlag + 1]);
  const hostFlag = argv.indexOf("--host");
  const allowedHosts = hosted ? ["0.0.0.0"] : ["127.0.0.1", "localhost"];
  if (hostFlag !== -1 && !allowedHosts.includes(argv[hostFlag + 1])) {
    throw new Error(
      `Host must be ${hosted ? "0.0.0.0 for hosted mode" : "127.0.0.1 or localhost"}`,
    );
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port must be an integer between 1024 and 65535");
  }

  const appUsername = env.APP_USERNAME || "super6";
  const appPassword = env.APP_PASSWORD || "1234";
  if (appUsername.includes(":")) throw new Error("APP_USERNAME must not contain a colon");

  return {
    port,
    host: hosted ? "0.0.0.0" : "127.0.0.1",
    // Render's persistent disk is mounted at /var/data. Windows and dev use local data.
    storagePath:
      hosted && process.platform !== "win32"
        ? "/var/data/supersix-studio"
        : path.join(PROJECT_ROOT, "data"),
    maxUploadBytes: 500 * 1024 * 1024,
    dev,
    hosted,
    mode: hosted ? "hosted" : "local",
    appUsername,
    appPassword,
    databaseUrl: env.DATABASE_URL || "",
  };
}
