import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createStudioApi } from "./api.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=",
  "base64",
);
const VIDEO = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom"),
  Buffer.alloc(64, 9),
]);

async function start(storagePath, maxUploadBytes = 1024 * 1024) {
  const api = createStudioApi({ storagePath, maxUploadBytes });
  const app = express();
  app.use("/api", api.router);
  const server = await new Promise((resolve) => {
    const result = app.listen(0, "127.0.0.1", () => resolve(result));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    base,
    async request(route, method = "GET", body) {
      const response = await fetch(base + route, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const data = await response.json();
      return { response, data };
    },
    async upload(jobId, bytes = PNG, name = "รูปโปรโมชั่น.png", type = "image/png") {
      const form = new FormData();
      form.set("file", new Blob([bytes], { type }), name);
      const response = await fetch(`${base}/jobs/${jobId}/assets`, { method: "POST", body: form });
      return { response, data: await response.json() };
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      api.close();
    },
  };
}

test("Local API writes real media folders, persists across restart, and recovers deleted work", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "supersix-backend-"));
  let app = await start(directory);
  t.after(async () => {
    await app.stop();
    await rm(directory, { recursive: true, force: true });
  });
  const id = randomUUID();
  let image;
  let secondImage;
  let video;

  await t.test("fresh data has no seeded examples and exposes local storage info", async () => {
    const { data } = await app.request("/studio");
    assert.deepEqual(data.jobs, []);
    assert.deepEqual(data.settings, { reelAnchor: "", reelEnabled: true });
    assert.equal(data.storage.root, directory);
    assert.equal(data.storage.rootPath, directory);
    assert.equal(data.storage.databasePath, path.join(directory, "studio.sqlite"));
  });
  await t.test("job creation is retry-safe and rejects invalid business data", async () => {
    const first = await app.request("/jobs", "POST", {
      id,
      title: "ภาพโปรโมชัน Heartopia",
      store: "supersix",
      plannedDate: "2026-11-18",
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.data.job.quantity, null);
    assert.equal(first.data.job.workStatus, "todo");
    assert.equal(first.data.job.postStatus, "unposted");
    const retry = await app.request("/jobs", "POST", { id, title: "ภาพโปรโมชัน Heartopia" });
    assert.equal(retry.response.status, 200);
    assert.equal((await app.request("/studio")).data.jobs.length, 1);
    assert.equal(
      (await app.request(`/jobs/${id}`, "PATCH", { dueDate: "2026-02-30" })).response.status,
      400,
    );
    assert.equal(
      (await app.request(`/jobs/${id}`, "PATCH", { quantity: -1 })).response.status,
      400,
    );
    assert.equal(
      (await app.request(`/jobs/${id}`, "PATCH", { referenceUrl: "javascript:alert(1)" })).response
        .status,
      400,
    );
    assert.equal(
      (await app.request(`/jobs/${id}`, "PATCH", { id: randomUUID() })).response.status,
      400,
    );
  });
  await t.test(
    "upload creates actual shop/year/job/media folders and distinct repeated filenames",
    async () => {
      const a = await app.upload(id);
      assert.equal(a.response.status, 201);
      image = a.data.asset;
      const b = await app.upload(id);
      assert.equal(b.response.status, 201);
      secondImage = b.data.asset;
      assert.notEqual(image.relativePath, secondImage.relativePath);
      assert.match(image.relativePath, new RegExp(`^uploads/supersix-shop/\\d{4}/${id}/images/`));
      assert.equal(image.name, "รูปโปรโมชั่น.png");
      assert.equal(image.size, PNG.length);
      assert.deepEqual(await readFile(path.join(directory, image.relativePath)), PNG);
      assert.deepEqual(await readFile(path.join(directory, secondImage.relativePath)), PNG);
      const uploaded = await app.upload(id, VIDEO, "คลิป.mp4", "video/mp4");
      assert.equal(uploaded.response.status, 201);
      video = uploaded.data.asset;
      assert.match(video.relativePath, /\/videos\//);
      assert.equal(video.kind, "video");
      const job = (await app.request("/studio")).data.jobs[0];
      assert.equal(job.workStatus, "todo");
      assert.equal(job.postStatus, "unposted");
      assert.equal(job.assets.length, 3);
      assert.ok(Date.now() - Date.parse(image.createdAt) < 30_000);
    },
  );
  await t.test("media GET, HEAD, range, suffix and invalid range return exact bytes", async () => {
    let response = await fetch(app.base + image.url.replace("/api", ""));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
    response = await fetch(app.base + video.url.replace("/api", ""), { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get("content-length")), VIDEO.length);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
    response = await fetch(app.base + video.url.replace("/api", ""), {
      headers: { Range: "bytes=4-11" },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes 4-11/${VIDEO.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), VIDEO.subarray(4, 12));
    response = await fetch(app.base + video.url.replace("/api", ""), {
      headers: { Range: "bytes=-5" },
    });
    assert.equal(response.status, 206);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), VIDEO.subarray(-5));
    response = await fetch(app.base + video.url.replace("/api", ""), {
      headers: { Range: "bytes=999999-" },
    });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${VIDEO.length}`);
  });
  await t.test(
    "moving a job to another shop moves files and keeps their asset URLs working",
    async () => {
      const result = await app.request(`/jobs/${id}`, "PATCH", {
        store: "fern",
        workStatus: "done",
      });
      assert.equal(result.response.status, 200);
      assert.ok(result.data.job.completedAt);
      assert.equal(result.data.job.postStatus, "unposted");
      image = result.data.job.assets.find((item) => item.id === image.id);
      secondImage = result.data.job.assets.find((item) => item.id === secondImage.id);
      video = result.data.job.assets.find((item) => item.id === video.id);
      assert.match(image.relativePath, /^uploads\/fern\//);
      assert.deepEqual(await readFile(path.join(directory, image.relativePath)), PNG);
      const response = await fetch(app.base + image.url.replace("/api", ""));
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    },
  );
  await t.test(
    "individual files and whole jobs can be removed and restored without deleting media",
    async () => {
      assert.equal((await app.request(`/assets/${image.id}`, "DELETE")).response.status, 200);
      assert.ok((await stat(path.join(directory, image.relativePath))).isFile());
      assert.equal((await app.request("/trash")).data.assets[0].id, image.id);
      assert.equal((await app.request(`/jobs/${id}`, "DELETE")).response.status, 200);
      assert.equal((await app.request("/studio")).data.jobs.length, 0);
      const trash = (await app.request("/trash")).data;
      assert.equal(trash.jobs.length, 1);
      assert.equal(trash.assets.length, 0);
      let response = await fetch(app.base + video.url.replace("/api", ""));
      assert.equal(response.status, 404);
      await response.arrayBuffer();
      const restored = await app.request(`/jobs/${id}/restore`, "POST");
      assert.equal(restored.data.job.assets.length, 2);
      assert.equal((await app.request("/trash")).data.assets.length, 1);
      assert.equal((await app.request(`/assets/${image.id}/restore`, "POST")).response.status, 200);
      assert.equal((await app.request("/studio")).data.jobs[0].assets.length, 3);
      assert.deepEqual(await readFile(path.join(directory, video.relativePath)), VIDEO);
    },
  );
  await t.test(
    "restart preserves jobs, Reel settings, media links and manual Facebook status",
    async () => {
      await app.request("/settings", "PATCH", { reelAnchor: "2026-11-18", reelEnabled: true });
      await app.request(`/jobs/${id}`, "PATCH", {
        postStatus: "posted",
        postDate: "2026-11-18",
        postUrl: "https://facebook.com/example",
      });
      await app.stop();
      app = await start(directory);
      const { data } = await app.request("/studio");
      assert.equal(data.jobs.length, 1);
      assert.equal(data.jobs[0].postStatus, "posted");
      assert.equal(data.jobs[0].assets.length, 3);
      assert.deepEqual(data.settings, { reelAnchor: "2026-11-18", reelEnabled: true });
      const response = await fetch(app.base + video.url.replace("/api", ""));
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), VIDEO);
    },
  );
  await t.test(
    "bad MIME, disguised files, extra files, and traversal names cannot write unsafe files",
    async () => {
      assert.equal(
        (await app.upload(id, Buffer.from("<script>alert(1)</script>"), "fake.png", "image/png"))
          .response.status,
        415,
      );
      assert.equal(
        (await app.upload(id, Buffer.from("<svg/>"), "file.svg", "image/svg+xml")).response.status,
        415,
      );
      const traversal = await app.upload(id, PNG, "../../CON.png", "image/png");
      assert.equal(traversal.response.status, 201);
      assert.ok(!traversal.data.asset.relativePath.includes(".."));
      assert.match(traversal.data.asset.relativePath, /file_CON_/);
      const form = new FormData();
      form.append("file", new Blob([PNG], { type: "image/png" }), "one.png");
      form.append("file", new Blob([PNG], { type: "image/png" }), "two.png");
      const response = await fetch(`${app.base}/jobs/${id}/assets`, { method: "POST", body: form });
      assert.equal(response.status, 400);
      await response.arrayBuffer();
      assert.deepEqual(await readdir(path.join(directory, ".uploading")), []);
    },
  );
});

test("streaming upload enforces exact size boundary and cleans rejected partial files", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "supersix-size-"));
  const app = await start(directory, PNG.length);
  t.after(async () => {
    await app.stop();
    await rm(directory, { recursive: true, force: true });
  });
  const created = await app.request("/jobs", "POST", { title: "ทดสอบขนาด" });
  const id = created.data.job.id;
  assert.equal((await app.upload(id)).response.status, 201);
  assert.equal((await app.upload(id, Buffer.concat([PNG, Buffer.from([0])]))).response.status, 413);
  assert.equal((await app.request("/studio")).data.jobs[0].assets.length, 1);
  assert.deepEqual(await readdir(path.join(directory, ".uploading")), []);
});

test("an in-flight upload follows shop changes and is discarded after job removal", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "supersix-race-"));
  const app = await start(directory);
  t.after(async () => {
    await app.stop();
    await rm(directory, { recursive: true, force: true });
  });
  const job = (await app.request("/jobs", "POST", { title: "งานระหว่างอัปโหลด" })).data.job;
  async function duringUpload(change) {
    const boundary = `studio-${randomUUID()}`;
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.png"\r\nContent-Type: image/png\r\n\r\n`,
    );
    const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
    let req;
    const reply = new Promise((resolve, reject) => {
      req = httpRequest(
        `${app.base}/jobs/${job.id}/assets`,
        {
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": prefix.length + PNG.length + ending.length,
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              data: JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      req.on("error", reject);
    });
    req.write(prefix);
    req.write(PNG.subarray(0, 20));
    try {
      for (let attempt = 0; ; attempt += 1) {
        if ((await readdir(path.join(directory, ".uploading"))).length) break;
        if (attempt > 100) throw new Error("Upload did not begin streaming");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await change();
      req.end(Buffer.concat([PNG.subarray(20), ending]));
      return await reply;
    } finally {
      req.destroy();
    }
  }
  const moved = await duringUpload(async () => {
    assert.equal(
      (await app.request(`/jobs/${job.id}`, "PATCH", { store: "gstation" })).response.status,
      200,
    );
  });
  assert.equal(moved.status, 201);
  assert.match(moved.data.asset.relativePath, /^uploads\/g-station\//);
  assert.deepEqual(await readFile(path.join(directory, moved.data.asset.relativePath)), PNG);
  const removed = await duringUpload(async () => {
    assert.equal((await app.request(`/jobs/${job.id}`, "DELETE")).response.status, 200);
  });
  assert.equal(removed.status, 404);
  assert.deepEqual(await readdir(path.join(directory, ".uploading")), []);
  const files = await readdir(path.dirname(path.join(directory, moved.data.asset.relativePath)));
  assert.equal(files.length, 1);
});
