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

export function configurationFrom(env, argv = []) {
  const hosted = env.RENDER === "true" || env.APP_MODE === "hosted";
  const dev = argv.includes("--dev");
  if (hosted && dev) throw new Error("Hosted mode uses npm start after npm run build, not --dev");
  const portFlag = argv.indexOf("--port");
  const port = Number(portFlag === -1 ? env.PORT || (hosted ? 10000 : 3000) : argv[portFlag + 1]);
  const hostFlag = argv.indexOf("--host");
  const allowedHosts = hosted ? ["0.0.0.0"] : ["127.0.0.1", "localhost"];
  if (hostFlag !== -1 && !allowedHosts.includes(argv[hostFlag + 1])) {
    throw new Error(
      `Host must be ${hosted ? "0.0.0.0 for hosted mode" : "127.0.0.1 or localhost"}`,
    );
  }
  const maxUploadMb = Number(env.MAX_UPLOAD_MB || 500);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("PORT ต้องเป็นเลขจำนวนเต็มตั้งแต่ 1024 ถึง 65535");
  }
  if (!Number.isInteger(maxUploadMb) || maxUploadMb < 1 || maxUploadMb > 4096) {
    throw new Error("MAX_UPLOAD_MB ต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ถึง 4096");
  }

  const storagePath = path.resolve(
    PROJECT_ROOT,
    env.STORAGE_PATH?.trim() || (env.RENDER === "true" ? "/var/data/supersix-studio" : "data"),
  );
  let publicOrigin = "";
  const appUsername = env.APP_USERNAME || "super6";
  const appPassword = env.APP_PASSWORD || "";
  if (hosted) {
    if (appPassword.length < 16)
      throw new Error("Hosted mode requires APP_PASSWORD of at least 16 characters");
    if (!appUsername || appUsername.includes(":"))
      throw new Error("APP_USERNAME must not contain a colon");
    let url;
    try {
      url = new URL(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "");
    } catch {
      throw new Error("Set PUBLIC_URL or use Render's RENDER_EXTERNAL_URL");
    }
    const localHttp =
      url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (!localHttp && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("PUBLIC_URL must be an HTTPS origin, without a path or credentials");
    }
    publicOrigin = url.origin;
  }
  return {
    port,
    host: hosted ? "0.0.0.0" : "127.0.0.1",
    storagePath,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    dev,
    hosted,
    mode: hosted ? "hosted" : "local",
    publicOrigin,
    appUsername,
    appPassword,
  };
}
