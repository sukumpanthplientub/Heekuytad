import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { loadConfiguration, PROJECT_ROOT } from "./config.mjs";
import { localRequestGuard } from "./security.mjs";
import { createReadinessCheck } from "./readiness.mjs";

if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("Supersix Studio ต้องใช้ Node.js 24 ขึ้นไป: https://nodejs.org/en/download");
  process.exit(1);
}

let studio;
let vite;
let server;
let shuttingDown = false;
try {
  const config = loadConfiguration();
  const app = express();
  app.set("env", config.dev ? "development" : "production");
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((_req, res, next) => {
    if (!shuttingDown) return next();
    res.set({ Connection: "close", "Retry-After": "5", "Cache-Control": "no-store" });
    res.status(503).json({ error: "ระบบกำลังเริ่มใหม่ กรุณาลองอีกครั้ง" });
  });
  app.use(localRequestGuard(config));

  // Import after the Node-version check so old versions show a useful message.
  const { createStudioApi } = await import("./api.mjs");
  studio = await createStudioApi({
    storagePath: config.storagePath,
    databaseUrl: config.databaseUrl,
    maxUploadBytes: config.maxUploadBytes,
    hosted: config.hosted,
  });
  const ready = createReadinessCheck(() => studio.health());
  app.get("/api/health", async (_req, res) => {
    const ok = await ready();
    res.status(ok ? 200 : 503).json({ ok });
  });
  app.use("/api", studio.router);
  app.use("/api", (_req, res) => res.status(404).json({ error: "ไม่พบคำสั่งนี้" }));

  server = createServer(app);
  // Video uploads are streamed to disk. A larger timeout allows slower disks
  // without loading the complete video into RAM.
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 60 * 1000;

  if (config.dev) {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      root: PROJECT_ROOT,
      configFile: path.join(PROJECT_ROOT, "vite.config.ts"),
      appType: "custom",
      server: {
        middlewareMode: true,
        hmr: { server },
        fs: {
          deny: [
            "**/.env*",
            "**/data/**",
            "**/*.sqlite*",
            "**/server/**",
            `${config.storagePath.replaceAll("\\", "/")}/**`,
          ],
        },
      },
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      try {
        const template = await readFile(path.join(PROJECT_ROOT, "index.html"), "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.setHeader("Cache-Control", "no-store");
        res.type("html").send(html);
      } catch (error) {
        vite.ssrFixStacktrace(error);
        next(error);
      }
    });
  } else {
    const distPath = path.join(PROJECT_ROOT, "dist");
    try {
      await access(path.join(distPath, "index.html"));
    } catch {
      throw new Error("ไม่พบไฟล์หน้าเว็บ กรุณารัน npm run build ก่อน แล้วรัน npm start อีกครั้ง");
    }
    // Only fingerprinted build assets are immutable; page/API/media stay private.
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), {
        index: false,
        dotfiles: "deny",
        immutable: true,
        maxAge: "1y",
        setHeaders: (res) => res.setHeader("Cache-Control", "private, max-age=31536000, immutable"),
      }),
    );
    app.use(express.static(distPath, { index: false, dotfiles: "deny" }));
    app.get("/", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.use((_req, res) => res.status(404).json({ error: "ไม่พบหน้านี้" }));
  app.use((error, _req, res, _next) => {
    console.error("Request failed:", error.message);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: "เกิดข้อผิดพลาด ดูรายละเอียดในหน้าต่าง Terminal" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  console.log("\nSupersix Studio");
  console.log(
    `เปิดเว็บ: ${config.hosted ? `ผ่านโดเมน HTTPS ของเซิร์ฟเวอร์ (port ${config.port})` : `http://127.0.0.1:${config.port}`}`,
  );
  console.log(`โฟลเดอร์ข้อมูล: ${config.storagePath}`);
  console.log(`ไฟล์ละไม่เกิน: ${config.maxUploadBytes / (1024 * 1024)} MB`);
  console.log(
    `โหมด: ${config.hosted ? "hosted" : config.dev ? "แก้ไขโค้ด (dev)" : "ใช้งานในเครื่อง"}`,
  );
  console.log("ปิดโปรแกรม: กด Ctrl+C ในหน้าต่างนี้\n");

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nกำลังปิด Supersix Studio...");
    studio.drain();
    const forceExit = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 25000);
    forceExit.unref();
    // Close HMR sockets before waiting for the parent HTTP server to close.
    await vite?.close().catch((error) => console.error("Vite shutdown:", error.code || error.name));
    server.close(async () => {
      try {
        await studio.close();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (error) {
        console.error("Database shutdown:", error.code || error.name);
        process.exit(1);
      }
    });
    server.closeIdleConnections();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  if (error.code === "EADDRINUSE") {
    console.error(
      "พอร์ตนี้ถูกใช้งานอยู่ ปิด Supersix Studio หน้าต่างเดิม หรือใช้ npm start -- --port 10001",
    );
  } else {
    console.error(error.message);
  }
  await vite?.close();
  await studio?.close();
  server?.close();
  process.exitCode = 1;
}
