import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { localRequestGuard } from "./security.mjs";

test("localhost guard blocks remote websites and forged hosts, while same-origin UI can save", async (t) => {
  const app = express();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  app.use(localRequestGuard({ port }));
  app.all("/api/probe", (_req, res) => res.json({ ok: true }));

  assert.equal((await fetch(`${origin}/api/probe`)).status, 200);
  assert.equal(
    (await fetch(`${origin}/api/probe`, { method: "POST", headers: { Origin: origin } })).status,
    200,
  );
  assert.equal((await fetch(`${origin}/api/probe`, { method: "POST" })).status, 403);
  assert.equal(
    (
      await fetch(`${origin}/api/probe`, {
        method: "POST",
        headers: { Origin: "https://unrelated.example" },
      })
    ).status,
    403,
  );
  for (const prefix of ["API", "Api"]) {
    assert.equal(
      (
        await fetch(`${origin}/${prefix}/probe`, {
          method: "POST",
          headers: { Origin: "https://unrelated.example" },
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (await fetch(`${origin}/api/probe`, { headers: { "Sec-Fetch-Site": "cross-site" } })).status,
    403,
  );

  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(
      `${origin}/api/probe`,
      { headers: { Host: `attacker.example:${port}` } },
      (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode));
      },
    );
    req.once("error", reject);
  });
  assert.equal(forgedHostStatus, 403);
});
