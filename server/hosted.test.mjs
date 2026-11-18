import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { configurationFrom, PROJECT_ROOT } from "./config.mjs";
import { localRequestGuard } from "./security.mjs";
import { createStudioApi } from "./api.mjs";
import { createTestDatabase } from "./test-database.mjs";

const secret = "1234";

test("production starts with fixed defaults and only credentials are read from env", () => {
  const config = configurationFrom({});
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 10000);
  assert.equal(
    config.storagePath,
    process.platform === "win32" ? path.join(PROJECT_ROOT, "data") : "/var/data/supersix-studio",
  );
  assert.equal(config.maxUploadBytes, 500 * 1024 * 1024);
  assert.equal(config.hosted, true);
  assert.equal(config.dev, false);
  assert.equal(config.appUsername, "super6");
  assert.equal(config.appPassword, secret);
  assert.deepEqual(
    configurationFrom({
      APP_MODE: "local",
      NODE_ENV: "development",
      RENDER: "false",
      PORT: "9000",
      STORAGE_PATH: "ignored",
      MAX_UPLOAD_MB: "1",
      PUBLIC_URL: "invalid",
      RENDER_EXTERNAL_URL: "invalid",
    }),
    config,
  );
  const custom = configurationFrom({ APP_USERNAME: "owner", APP_PASSWORD: "5678" });
  assert.equal(custom.appUsername, "owner");
  assert.equal(custom.appPassword, "5678");
  assert.throws(() => configurationFrom({ APP_USERNAME: "invalid:name" }), /APP_USERNAME/);
  assert.equal(configurationFrom({}, ["--port", "10001"]).port, 10001);
  for (const port of ["", "abc", "80", "65536"]) {
    assert.throws(() => configurationFrom({}, ["--port", port]), /--port/);
  }
  const dev = configurationFrom({}, ["--dev"]);
  assert.equal(dev.host, "127.0.0.1");
  assert.equal(dev.port, 3000);
  assert.equal(dev.hosted, false);
  assert.equal(dev.storagePath, path.join(PROJECT_ROOT, "data"));
});

test("Hosted requests protect pages, APIs and media while leaving only readiness public", async (t) => {
  const database = await createTestDatabase();
  const temp = await mkdtemp(path.join(os.tmpdir(), "supersix-hosted-"));
  const studio = await createStudioApi({
    storagePath: temp,
    hosted: true,
    databaseUrl: database.url,
  });
  const app = express();
  app.use(
    localRequestGuard({
      port: 10000,
      hosted: true,
      appUsername: "super6",
      appPassword: secret,
    }),
  );
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", studio.router);
  app.get("/", (_req, res) => res.send("Supersix Studio"));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await studio.close();
    await database.close();
    await rm(temp, { recursive: true, force: true });
  });
  const authorization = `Basic ${Buffer.from(`super6:${secret}`).toString("base64")}`;
  const request = (url, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: url,
          method,
          headers: { Host: "studio.example", ...headers },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  for (const url of ["/", "/api/studio", "/api/assets/00000000-0000-4000-8000-000000000000"]) {
    const result = await request(url);
    assert.equal(result.status, 401);
    assert.match(result.headers["www-authenticate"], /^Basic /);
  }
  assert.equal(
    (
      await request("/", {
        headers: { Authorization: "Basic " + Buffer.from("super6:wrong").toString("base64") },
      })
    ).status,
    401,
  );
  assert.equal((await request("/", { headers: { Authorization: authorization } })).status, 200);
  const health = await request("/api/health", { headers: { Host: "internal-health-check" } });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true });
  assert.equal(
    (await request("/api/health", { method: "HEAD", headers: { Host: "internal-health-check" } }))
      .status,
    200,
  );
  const storage = await request("/api/storage", { headers: { Authorization: authorization } });
  assert.equal(storage.status, 200);
  assert.equal(JSON.parse(storage.body).mode, "hosted");
  assert.equal(JSON.parse(storage.body).canOpenFolder, false);
  const ownHeaders = { Authorization: authorization, Origin: "https://studio.example" };
  assert.equal(
    (await request("/api/storage/open", { method: "POST", headers: ownHeaders })).status,
    409,
  );
  assert.equal(
    (
      await request("/api/jobs/00000000-0000-4000-8000-000000000000/folder", {
        method: "POST",
        headers: ownHeaders,
      })
    ).status,
    409,
  );
  for (const prefix of ["api", "API", "Api"]) {
    assert.equal(
      (
        await request(`/${prefix}/storage/open`, {
          method: "POST",
          headers: { Authorization: authorization, Origin: "https://unrelated.example" },
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await request("/api/settings", {
        method: "PATCH",
        headers: { ...ownHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ reelAnchor: "2026-11-18", reelEnabled: true }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/settings", { method: "PATCH", headers: { Authorization: authorization } }))
      .status,
    403,
  );
  assert.equal(
    (
      await request("/api/studio", {
        headers: { ...ownHeaders, Host: "unrelated.example" },
      })
    ).status,
    403,
  );
  for (const headers of [
    { Origin: "http://studio.example" },
    { Origin: "null" },
    { Origin: "https://unrelated.example", "X-Forwarded-Host": "unrelated.example" },
    { Origin: "http://studio.example", "X-Forwarded-Proto": "http" },
    { "Sec-Fetch-Site": "cross-site" },
    { Host: "studio.example/invalid" },
    { Host: "user@studio.example" },
  ]) {
    assert.equal(
      (await request("/api/studio", { headers: { ...ownHeaders, ...headers } })).status,
      403,
    );
  }
  for (const [host, origin] of [
    ["custom.example", "https://custom.example"],
    ["custom.example:8443", "https://custom.example:8443"],
    [`127.0.0.1:${port}`, `http://127.0.0.1:${port}`],
  ]) {
    assert.equal(
      (
        await request("/api/settings", {
          method: "PATCH",
          headers: {
            Authorization: authorization,
            Host: host,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reelEnabled: true }),
        })
      ).status,
      200,
    );
  }
});
