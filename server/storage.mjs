import {
  mkdirSync,
  realpathSync,
  existsSync,
  lstatSync,
  renameSync,
  readdirSync,
  unlinkSync,
  statfsSync,
} from "node:fs";
import path from "node:path";
import { createDatabase } from "./database.mjs";
import { createFileJournal } from "./file-journal.mjs";
import { databaseOptions } from "./database-url.mjs";
import { Prisma } from "./generated/prisma/client.ts";

export const SHOP_FOLDERS = Object.freeze({
  supersix: "supersix-shop",
  fern: "fern",
  gstation: "g-station",
});

export async function createStorage({
  storagePath,
  databaseUrl,
  maxUploadBytes = 500 * 1024 * 1024,
}) {
  if (!storagePath) throw new Error("storagePath is required");
  const db = createDatabase(databaseUrl);
  const assetsTable = Prisma.raw(`"${databaseOptions(databaseUrl).schema}"."assets"`);
  let root, uploadsPath, temporaryPath;
  try {
    await db.$connect();
    // Fail at startup if migrations have not been deployed.
    await Promise.all([
      db.job.findFirst({ select: { id: true } }),
      db.asset.findFirst({ select: { id: true } }),
      db.settings.findFirst({ select: { id: true } }),
    ]);
    mkdirSync(path.resolve(storagePath), { recursive: true });
    root = realpathSync(path.resolve(storagePath));
    uploadsPath = absolute("uploads");
    temporaryPath = absolute(".uploading");
    mkdirSync(uploadsPath, { recursive: true });
    mkdirSync(temporaryPath, { recursive: true });
    // No uploads are active before this single-disk server begins listening.
    for (const entry of readdirSync(temporaryPath, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.partial$/.test(entry.name)
      )
        unlinkSync(absolute(`.uploading/${entry.name}`));
    }
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
  const info = {
    root,
    rootPath: root,
    uploadsPath,
    databaseProvider: "postgresql",
    maxUploadBytes,
  };

  // Keep every media path beneath the configured disk, including after a shop move.
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

  let journal;
  try {
    journal = createFileJournal({ db, absolute, jobRelative });
    await journal.recoverAll();
  } catch (error) {
    await db.$disconnect();
    throw error;
  }

  // All changes to one job share a transaction-scoped lock. It also works through
  // Supabase's transaction pooler and prevents a completed upload racing a move.
  const jobLocks = new Map();
  async function withJob(id, action) {
    id = id.toLowerCase();
    // Keep same-process requests queued until filesystem compensation finishes,
    // even if PostgreSQL has already released its transaction lock on failure.
    const previous = jobLocks.get(id) || Promise.resolve();
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    jobLocks.set(id, waiting);
    await previous;
    const rollback = [];
    const committed = [];
    try {
      const result = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text AS locked`;
        await journal.recoverJob(id, tx);
        return action(tx, rollback, committed);
      });
      // Cleanup errors must never roll back files after a successful DB commit.
      for (const finish of committed) {
        try {
          finish();
        } catch (error) {
          console.error("Media journal cleanup deferred:", error.code || error.name);
        }
      }
      return result;
    } catch (error) {
      for (const undo of rollback.reverse()) {
        try {
          undo();
        } catch (undoError) {
          console.error("Media rollback failed:", undoError.code || "filesystem error");
        }
      }
      throw error;
    } finally {
      release();
      if (jobLocks.get(id) === waiting) jobLocks.delete(id);
    }
  }

  // Called only while holding withJob's lock. Compensate the filesystem rename
  // if any SQL statement or the transaction commit fails.
  async function moveJobShop(tx, job, nextStore, rollback, committed = []) {
    if (job.store === nextStore) return;
    const oldRelative = jobRelative(job);
    const nextRelative = jobRelative(job, nextStore);
    const oldFolder = absolute(oldRelative);
    const nextFolder = absolute(nextRelative);
    if (existsSync(oldFolder)) {
      mkdirSync(path.dirname(nextFolder), { recursive: true });
      if (existsSync(nextFolder)) throw new Error("Destination job folder already exists");
      committed.push(journal.begin(job, nextStore));
      renameSync(oldFolder, nextFolder);
      rollback.push(() => renameSync(nextFolder, oldFolder));
    }
    const unexpected = await tx.asset.findFirst({
      where: { job_id: job.id, NOT: { relative_path: { startsWith: `${oldRelative}/` } } },
      select: { id: true },
    });
    if (unexpected) throw new Error("Unexpected stored asset path");
    // One parameterized update instead of a network round trip for every asset.
    await tx.$executeRaw`UPDATE ${assetsTable}
      SET relative_path = ${nextRelative} || substring(relative_path from ${oldRelative.length + 1}::int)
      WHERE job_id = ${job.id}::uuid`;
  }

  return {
    db,
    info,
    root,
    uploadsPath,
    temporaryPath,
    absolute,
    jobRelative,
    jobFolder,
    withJob,
    moveJobShop,
    checkUploadSpace(bytes) {
      const disk = statfsSync(temporaryPath);
      if (disk.bavail * disk.bsize < bytes + 16 * 1024 * 1024) {
        const error = new Error("Not enough disk space for upload");
        error.code = "ENOSPC";
        throw error;
      }
    },
    async health() {
      await db.$queryRaw`SELECT 1`;
    },
    async close() {
      await db.$disconnect();
    },
  };
}
