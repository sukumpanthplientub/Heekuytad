import { DatabaseSync } from "node:sqlite";
import { mkdirSync, realpathSync, existsSync, lstatSync, renameSync } from "node:fs";
import path from "node:path";

export const SHOP_FOLDERS = Object.freeze({
  supersix: "supersix-shop",
  fern: "fern",
  gstation: "g-station",
});

export function createStorage({ storagePath, maxUploadBytes = 500 * 1024 * 1024 }) {
  if (!storagePath) throw new Error("storagePath is required");
  mkdirSync(path.resolve(storagePath), { recursive: true });
  const root = realpathSync(path.resolve(storagePath));
  const uploadsPath = path.join(root, "uploads");
  const temporaryPath = path.join(root, ".uploading");
  mkdirSync(uploadsPath, { recursive: true });
  mkdirSync(temporaryPath, { recursive: true });
  const databasePath = path.join(root, "studio.sqlite");
  const db = new DatabaseSync(databasePath);
  // Refuse a newer database before changing pragmas or creating any tables.
  const versionTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get();
  if (versionTable) {
    const knownVersion = db.prepare("SELECT version FROM schema_version").get();
    if (!knownVersion || knownVersion.version !== 1) {
      db.close();
      throw new Error(
        "Unsupported database version; keep a backup and use the matching app version.",
      );
    }
  }
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, store TEXT NOT NULL, title TEXT NOT NULL,
      requester TEXT NOT NULL DEFAULT '', brief TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'image', planned_date TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal', quantity INTEGER,
      work_status TEXT NOT NULL DEFAULT 'todo', post_status TEXT NOT NULL DEFAULT 'unposted',
      post_url TEXT NOT NULL DEFAULT '', post_date TEXT NOT NULL DEFAULT '', post_note TEXT NOT NULL DEFAULT '',
      reference_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      completed_at TEXT, archived INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), relative_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL,
      created_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK(id = 1), reel_anchor TEXT NOT NULL DEFAULT '',
      reel_enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(deleted_at, created_at);
    CREATE INDEX IF NOT EXISTS assets_job_idx ON assets(job_id, deleted_at);
  `);
  const info = { root, rootPath: root, uploadsPath, databasePath, maxUploadBytes };

  // All stored paths are relative. A moved project/data folder remains portable.
  // Reject traversal and directory links so media routes cannot expose other files.
  function absolute(relative) {
    if (typeof relative !== "string" || relative.includes("\0") || path.isAbsolute(relative))
      throw new Error("Invalid stored path");
    const result = path.resolve(root, relative);
    const rel = path.relative(root, result);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
      throw new Error("Path is outside the data folder");
    let current = root;
    for (const part of rel.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (existsSync(current) && lstatSync(current).isSymbolicLink())
        throw new Error("Symbolic links are not supported inside the data folder");
    }
    return result;
  }

  function jobRelative(job, store = job.store) {
    const year = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
    }).format(new Date(job.created_at));
    return path.posix.join("uploads", SHOP_FOLDERS[store], year, job.id);
  }

  function jobFolder(job, create = false) {
    const location = absolute(jobRelative(job));
    if (create) mkdirSync(location, { recursive: true });
    return location;
  }

  function transaction(action) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  // Metadata and physical folders follow a shop change together. Same data root
  // guarantees rename stays on one filesystem; rollback puts the folder back.
  function moveJobShop(job, nextStore, updateMetadata) {
    if (job.store === nextStore) return transaction(updateMetadata);
    const oldRelative = jobRelative(job);
    const nextRelative = jobRelative(job, nextStore);
    const oldFolder = absolute(oldRelative);
    const nextFolder = absolute(nextRelative);
    let moved = false;
    try {
      if (existsSync(oldFolder)) {
        mkdirSync(path.dirname(nextFolder), { recursive: true });
        if (existsSync(nextFolder)) throw new Error("Destination job folder already exists");
        renameSync(oldFolder, nextFolder);
        moved = true;
      }
      return transaction(() => {
        const assets = db
          .prepare("SELECT id, relative_path FROM assets WHERE job_id = ?")
          .all(job.id);
        for (const asset of assets) {
          if (!asset.relative_path.startsWith(`${oldRelative}/`))
            throw new Error("Unexpected stored asset path");
          const destination = nextRelative + asset.relative_path.slice(oldRelative.length);
          db.prepare("UPDATE assets SET relative_path = ? WHERE id = ?").run(destination, asset.id);
        }
        return updateMetadata();
      });
    } catch (error) {
      if (moved) renameSync(nextFolder, oldFolder);
      throw error;
    }
  }

  let closed = false;
  return {
    db,
    info,
    root,
    uploadsPath,
    temporaryPath,
    absolute,
    jobRelative,
    jobFolder,
    transaction,
    moveJobShop,
    close() {
      if (closed) return;
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      closed = true;
    },
  };
}
