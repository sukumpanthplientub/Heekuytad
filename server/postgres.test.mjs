import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, rename, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { tmpdir } from "node:os";
import { createTestDatabase } from "./test-database.mjs";
import { createStorage } from "./storage.mjs";
import { importSqlite } from "../scripts/import-sqlite.mjs";
import { databaseUrl, databaseOptions } from "./database-url.mjs";

test("Supabase URLs verify TLS and keep Prisma's schema separate from pg options", () => {
  const url = databaseUrl(
    "postgres://user:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=disable",
  );
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.get("schema"), "supersix");
  assert.ok(url.searchParams.get("sslrootcert").endsWith("supabase-ca.crt"));
  const options = databaseOptions(url.toString());
  assert.equal(options.schema, "supersix");
  assert.equal(new URL(options.connectionString).searchParams.has("schema"), false);
  assert.throws(
    () => databaseUrl("postgres://user:password@localhost/db?schema=bad-name"),
    /schema/,
  );
  assert.throws(() => databaseUrl("invalid-secret-url"), /PostgreSQL connection URL/);
});

test("PostgreSQL transactions serialize edits and roll back metadata with media moves", async (t) => {
  const database = await createTestDatabase();
  const directory = await mkdtemp(path.join(tmpdir(), "supersix-transactions-"));
  let storage;
  t.after(async () => {
    await storage?.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });
  storage = await createStorage({ storagePath: directory, databaseUrl: database.url });
  const job = await storage.db.job.create({ data: { title: "Concurrent edits", quantity: 1 } });
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      storage.withJob(index % 2 ? job.id.toUpperCase() : job.id, async (tx) => {
        const current = await tx.job.findUnique({ where: { id: job.id } });
        await tx.job.update({ where: { id: job.id }, data: { quantity: current.quantity + 1 } });
      }),
    ),
  );
  assert.equal((await storage.db.job.findUnique({ where: { id: job.id } })).quantity, 6);
  const relativePath = path.posix.join(storage.jobRelative(job), "images", "original.png");
  await mkdir(path.dirname(storage.absolute(relativePath)), { recursive: true });
  await writeFile(storage.absolute(relativePath), "preserve original media");
  const asset = await storage.db.asset.create({
    data: {
      job_id: job.id,
      relative_path: relativePath,
      name: "original.png",
      mime_type: "image/png",
      size: 23,
      kind: "image",
    },
  });
  await assert.rejects(
    storage.withJob(job.id, async (tx, rollback) => {
      await storage.moveJobShop(tx, job, "fern", rollback);
      // The database constraint fails after both folder and asset paths have moved.
      await tx.job.update({ where: { id: job.id }, data: { store: "fern", quantity: -1 } });
    }),
  );
  assert.equal((await storage.db.job.findUnique({ where: { id: job.id } })).store, "supersix");
  assert.equal(
    (await storage.db.asset.findUnique({ where: { id: asset.id } })).relative_path,
    relativePath,
  );
  assert.equal(await readFile(storage.absolute(relativePath), "utf8"), "preserve original media");
  await assert.rejects(access(storage.absolute(storage.jobRelative(job, "fern"))));

  const tables = await database.client.query(
    "SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'r'",
    [database.schema],
  );
  assert.equal(tables.rows.length, 3);
  assert.ok(tables.rows.every((row) => row.relrowsecurity));
  const roles = await database.client.query(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
  );
  for (const { rolname } of roles.rows) {
    await database.client.query("BEGIN");
    try {
      await database.client.query(`SET LOCAL ROLE "${rolname}"`);
      try {
        const result = await database.client.query(`SELECT * FROM "${database.schema}"."jobs"`);
        assert.deepEqual(result.rows, []);
      } catch (error) {
        assert.equal(error.code, "42501");
      }
    } finally {
      await database.client.query("ROLLBACK");
    }
  }
});

test("SQLite import preserves IDs, timestamps, trash and paths without overwriting an existing database", async (t) => {
  const database = await createTestDatabase();
  const directory = await mkdtemp(path.join(tmpdir(), "supersix-import-"));
  let storage;
  t.after(async () => {
    await storage?.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const sourcePath = path.join(directory, "studio.sqlite");
  const source = new DatabaseSync(sourcePath);
  const id = randomUUID();
  const assetId = randomUUID();
  const timestamp = "2026-11-18T05:00:00.000Z";
  const relativePath = `uploads/supersix-shop/2026/${id}/images/original.png`;
  try {
    source.exec(`
      CREATE TABLE schema_version(version INTEGER); INSERT INTO schema_version VALUES (1);
      CREATE TABLE jobs(id TEXT, store TEXT, title TEXT, archived INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT);
      CREATE TABLE assets(id TEXT, job_id TEXT, relative_path TEXT, name TEXT, mime_type TEXT, size INTEGER, kind TEXT, created_at TEXT, deleted_at TEXT);
      CREATE TABLE settings(id INTEGER, reel_anchor TEXT, reel_enabled INTEGER, updated_at TEXT);
    `);
    source
      .prepare("INSERT INTO jobs VALUES (?, 'supersix', 'งานเดิม', 1, ?, ?, ?)")
      .run(id, timestamp, timestamp, timestamp);
    source
      .prepare("INSERT INTO assets VALUES (?, ?, ?, 'รูปเดิม.png', 'image/png', 23, 'image', ?, ?)")
      .run(assetId, id, relativePath, timestamp, timestamp);
    source.prepare("INSERT INTO settings VALUES (1, '2026-11-18', 0, ?)").run(timestamp);
  } finally {
    source.close();
  }
  const original = await readFile(sourcePath);
  assert.deepEqual(await importSqlite(sourcePath, database.url), {
    jobs: 1,
    assets: 1,
    settings: 1,
  });
  assert.deepEqual(await readFile(sourcePath), original);
  storage = await createStorage({ storagePath: directory, databaseUrl: database.url });
  const job = await storage.db.job.findUnique({ where: { id } });
  assert.equal(job.title, "งานเดิม");
  assert.equal(job.archived, true);
  assert.equal(job.deleted_at.toISOString(), timestamp);
  assert.equal(
    (await storage.db.asset.findUnique({ where: { id: assetId } })).relative_path,
    relativePath,
  );
  assert.equal((await storage.db.settings.findUnique({ where: { id: 1 } })).reel_enabled, false);
  await assert.rejects(importSqlite(sourcePath, database.url), /empty target schema/);
  assert.equal(await storage.db.job.count(), 1);
});

test("startup reconciles interrupted shop moves and cleans only its abandoned uploads", async (t) => {
  const database = await createTestDatabase();
  const directory = await mkdtemp(path.join(tmpdir(), "supersix-recovery-"));
  let storage;
  t.after(async () => {
    await storage?.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const open = () => createStorage({ storagePath: directory, databaseUrl: database.url });
  storage = await open();
  let job = await storage.db.job.create({ data: { title: "Recovery", store: "supersix" } });
  const relative = path.posix.join(storage.jobRelative(job), "images", "original.png");
  await mkdir(path.dirname(storage.absolute(relative)), { recursive: true });
  await writeFile(storage.absolute(relative), "original media");
  const asset = await storage.db.asset.create({
    data: {
      job_id: job.id,
      relative_path: relative,
      name: "original.png",
      mime_type: "image/png",
      size: 14,
      kind: "image",
    },
  });
  for (const committed of [false, true]) {
    const from = storage.jobRelative(job);
    const to = storage.jobRelative(job, "fern");
    await writeFile(
      path.join(directory, ".operations", `job-${job.id}.json`),
      JSON.stringify({
        version: 1,
        jobId: job.id,
        from: "supersix",
        to: "fern",
      }),
    );
    await mkdir(path.dirname(storage.absolute(to)), { recursive: true });
    await rename(storage.absolute(from), storage.absolute(to));
    if (committed) {
      await storage.db.$transaction([
        storage.db.job.update({ where: { id: job.id }, data: { store: "fern" } }),
        storage.db.asset.update({
          where: { id: asset.id },
          data: { relative_path: `${to}/images/original.png` },
        }),
      ]);
    }
    await writeFile(path.join(directory, ".uploading", `${randomUUID()}.partial`), "unfinished");
    await writeFile(path.join(directory, ".uploading", "notes.txt"), "keep");
    await storage.close();
    storage = await open();
    job = await storage.db.job.findUnique({ where: { id: job.id } });
    assert.equal(job.store, committed ? "fern" : "supersix");
    const saved = await storage.db.asset.findUnique({ where: { id: asset.id } });
    assert.equal(await readFile(storage.absolute(saved.relative_path), "utf8"), "original media");
    assert.deepEqual(await readdir(path.join(directory, ".operations")), []);
    assert.deepEqual(await readdir(path.join(directory, ".uploading")), ["notes.txt"]);
  }
});
