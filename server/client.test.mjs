import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { api } from "../src/lib/api.ts";
import { createSnapshotVersion } from "../src/lib/snapshot-version.ts";
import { createReadinessCheck } from "./readiness.mjs";

test("API client rejects malformed success responses and preserves server errors", async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>proxy error</html>"),
  );
  await assert.rejects(api("/api/studio"), /ไม่สามารถอ่านข้อมูล/);
  fetchMock.mock.mockImplementation(async () => Response.json(null));
  await assert.rejects(api("/api/studio"), /ไม่สามารถอ่านข้อมูล/);
  fetchMock.mock.mockImplementation(async () =>
    Response.json({ error: "ไม่พบงานนี้" }, { status: 404 }),
  );
  await assert.rejects(
    api("/api/studio"),
    (error) => error.status === 404 && error.message === "ไม่พบงานนี้",
  );
  fetchMock.mock.mockImplementation(async () => Response.json({ jobs: [] }));
  assert.deepEqual(await api("/api/studio"), { jobs: [] });
});

test("API client times out without retrying a write and supports cancellation", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_path, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  await Promise.all([
    assert.rejects(
      api("/api/jobs", "POST", { title: "timeout" }, { timeoutMs: 10 }),
      /โหลดข้อมูลล่าสุด/,
    ),
    delay(30),
  ]);
  assert.equal(calls, 1);
  const controller = new AbortController();
  const request = api("/api/studio", "GET", undefined, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});

test("late snapshots cannot overwrite newer requests or completed mutations", () => {
  const version = createSnapshotVersion();
  const first = version.begin();
  assert.equal(first.current(), true);
  version.changed();
  assert.equal(first.stale(), true);
  const second = version.begin();
  assert.equal(first.current(), false);
  assert.equal(second.stale(), false);
  version.cancel();
  assert.equal(second.current(), false);
});

test("health checks coalesce concurrent probes, cache briefly, and recover from failure", async () => {
  let clock = 0;
  let calls = 0;
  let finish;
  let fail = false;
  const ready = createReadinessCheck(
    async () => {
      calls++;
      if (fail) throw new Error("database unavailable");
      await new Promise((resolve) => {
        finish = resolve;
      });
    },
    { now: () => clock },
  );
  const requests = Array.from({ length: 10 }, () => ready());
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await Promise.all(requests), Array(10).fill(true));
  assert.equal(await ready(), true);
  assert.equal(calls, 1);
  clock = 5001;
  fail = true;
  assert.equal(await ready(), false);
  assert.equal(await ready(), false);
  assert.equal(calls, 2);
  clock = 10002;
  fail = false;
  const recovered = ready();
  await Promise.resolve();
  finish();
  assert.equal(await recovered, true);
});
