import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { configurationFrom } from "./config.mjs";
import { localRequestGuard } from "./security.mjs";
import { createStudioApi } from "./api.mjs";

const secret = "test-password-long-enough-for-hosting";

test("Render configuration binds the assigned port and requires credentials and a canonical URL", () => {
  const config = configurationFrom({
    RENDER: "true",
    PORT: "10000",
    RENDER_EXTERNAL_URL: "https://studio.example",
    APP_PASSWORD: secret,
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 10000);
  assert.equal(config.storagePath, "/var/data/supersix-studio");
  assert.equal(config.publicOrigin, "https://studio.example");
  assert.equal(config.appUsername, "super6");
  assert.throws(
    () => configurationFrom({ RENDER: "true", RENDER_EXTERNAL_URL: "https://studio.example" }),
    /APP_PASSWORD/,
  );
  assert.throws(
    () => configurationFrom({ APP_MODE: "hosted", APP_PASSWORD: secret }),
    /PUBLIC_URL/,
  );
  assert.throws(
    () =>
      configurationFrom({
        APP_MODE: "hosted",
        APP_PASSWORD: secret,
        PUBLIC_URL: "http://studio.example",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      configurationFrom({
        APP_MODE: "hosted",
        APP_PASSWORD: secret,
        PUBLIC_URL: "https://studio.example/subpath",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      configurationFrom(
        { APP_MODE: "hosted", APP_PASSWORD: secret, PUBLIC_URL: "https://studio.example" },
        ["--dev"],
      ),
    /not --dev/,
  );
  assert.equal(configurationFrom({}).host, "127.0.0.1");
});

test("Hosted requests protect pages, APIs and media while leaving only readiness public", async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "supersix-hosted-"));
  const studio = createStudioApi({ storagePath: temp, hosted: true });
  const app = express();
  app.use(
    localRequestGuard({
      port: 10000,
      hosted: true,
      publicOrigin: "https://studio.example",
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
    studio.close();
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
        headers: { Authorization: authorization, Host: "unrelated.example" },
      })
    ).status,
    403,
  );
});
