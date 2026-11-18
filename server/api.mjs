import express from "express";
import Busboy from "busboy";
import { randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  unlinkSync,
  statSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { createStorage } from "./storage.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_TYPES = {
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/png": { kind: "image", extension: "png" },
  "image/webp": { kind: "image", extension: "webp" },
  "image/gif": { kind: "image", extension: "gif" },
  "image/avif": { kind: "image", extension: "avif" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/webm": { kind: "video", extension: "webm" },
  "video/quicktime": { kind: "video", extension: "mov" },
};
const EXTENSION_MIMES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
function validId(id) {
  if (typeof id !== "string" || !UUID.test(id)) throw new ApiError(400, "รหัสรายการไม่ถูกต้อง");
  return id;
}
function text(value, label, max, required = false) {
  if (typeof value !== "string") throw new ApiError(400, `${label}ไม่ถูกต้อง`);
  const result = value.trim();
  if (result.length > max || result.includes("\0"))
    throw new ApiError(400, `${label}ยาวเกินไปหรือมีอักขระที่ไม่รองรับ`);
  if (required && !result) throw new ApiError(400, `กรุณากรอก${label}`);
  return result;
}
function date(value, label) {
  const result = text(value, label, 10);
  if (!result) return "";
  const parsed = new Date(`${result}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== result
  )
    throw new ApiError(400, `${label}ไม่ถูกต้อง`);
  return result;
}
function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new ApiError(400, `${label}ไม่ถูกต้อง`);
  return value;
}
function url(value, label) {
  const result = text(value, label, 2048);
  if (!result) return "";
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    throw new ApiError(400, `${label}ต้องเริ่มด้วย https:// หรือ http://`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new ApiError(400, `${label}ไม่ถูกต้อง`);
  return parsed.toString();
}
const FIELDS = {
  store: ["store", (v) => oneOf(v, ["supersix", "fern", "gstation"], "ร้าน")],
  title: ["title", (v) => text(v, "ชื่องาน", 180, true)],
  requester: ["requester", (v) => text(v, "ผู้สั่งงาน", 120)],
  brief: ["brief", (v) => text(v, "บรีฟงาน", 10000)],
  type: ["type", (v) => oneOf(v, ["image", "reel"], "ประเภทงาน")],
  plannedDate: ["planned_date", (v) => date(v, "วันที่จะทำ")],
  dueDate: ["due_date", (v) => date(v, "กำหนดส่ง")],
  priority: ["priority", (v) => oneOf(v, ["normal", "high"], "ความสำคัญ")],
  quantity: [
    "quantity",
    (v) => {
      if (v === null) return null;
      if (!Number.isSafeInteger(v) || v < 1 || v > 100000)
        throw new ApiError(400, "จำนวนชิ้นงานต้องเป็นจำนวนเต็มอย่างน้อย 1 หรือเว้นว่าง");
      return v;
    },
  ],
  workStatus: ["work_status", (v) => oneOf(v, ["todo", "doing", "done"], "สถานะงาน")],
  postStatus: [
    "post_status",
    (v) => oneOf(v, ["unposted", "scheduled", "partial", "posted"], "สถานะโพสต์"),
  ],
  postUrl: ["post_url", (v) => url(v, "ลิงก์โพสต์")],
  postDate: ["post_date", (v) => date(v, "วันที่โพสต์")],
  postNote: ["post_note", (v) => text(v, "รายละเอียดการโพสต์", 2000)],
  referenceUrl: ["reference_url", (v) => url(v, "ลิงก์อ้างอิง")],
  archived: [
    "archived",
    (v) => {
      if (typeof v !== "boolean") throw new ApiError(400, "สถานะเก็บงานไม่ถูกต้อง");
      return v ? 1 : 0;
    },
  ],
};
function jsonBody(req) {
  if (!req.is("application/json")) throw new ApiError(415, "รูปแบบข้อมูลไม่ถูกต้อง");
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    throw new ApiError(400, "รูปแบบข้อมูลไม่ถูกต้อง");
  return req.body;
}
function validatedPatch(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(FIELDS, key))
      throw new ApiError(400, `ไม่รองรับข้อมูลช่อง ${key.slice(0, 50)}`);
    const [column, validate] = FIELDS[key];
    output[column] = validate(value);
  }
  if (!Object.keys(output).length) throw new ApiError(400, "ไม่พบข้อมูลที่ต้องการแก้ไข");
  return output;
}
function mapAsset(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    kind: row.kind,
    url: `/api/assets/${row.id}`,
    createdAt: row.created_at,
    relativePath: row.relative_path,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}
function mapJob(row, assets = []) {
  return {
    id: row.id,
    store: row.store,
    title: row.title,
    requester: row.requester,
    brief: row.brief,
    type: row.type,
    plannedDate: row.planned_date,
    dueDate: row.due_date,
    priority: row.priority,
    quantity: row.quantity,
    workStatus: row.work_status,
    postStatus: row.post_status,
    postUrl: row.post_url,
    postDate: row.post_date,
    postNote: row.post_note,
    referenceUrl: row.reference_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    archived: !!row.archived,
    assets,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}
function validHeader(bytes, mimeType) {
  const ascii = bytes.toString("latin1");
  switch (mimeType) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/gif":
      return ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
    case "image/webp":
      return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
    case "image/avif":
      return ascii.slice(4, 8) === "ftyp" && (ascii.includes("avif") || ascii.includes("avis"));
    case "video/mp4":
      return ascii.slice(4, 8) === "ftyp";
    case "video/quicktime":
      return ["ftyp", "wide", "moov", "mdat"].includes(ascii.slice(4, 8));
    case "video/webm":
      return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    default:
      return false;
  }
}

function safeBase(name) {
  const basename = path.win32.basename(path.posix.basename(String(name || "file")));
  let result = path
    .parse(basename)
    .name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  result = Array.from(result).slice(0, 64).join("") || "file";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `file_${result}`;
  return result;
}

async function openFolder(location) {
  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  return new Promise((resolve) => {
    const child = spawn(command, [location], { shell: false, windowsHide: true, stdio: "ignore" });
    let settled = false;
    const finish = (opened) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          path: location,
          opened,
          ...(!opened
            ? { error: "เปิดโปรแกรมจัดการไฟล์ไม่สำเร็จ คุณสามารถคัดลอกตำแหน่งโฟลเดอร์ไปเปิดเองได้" }
            : {}),
        });
      }
    };
    const timer = setTimeout(() => {
      child.unref();
      finish(true);
    }, 1500);
    child.once("error", () => finish(false));
    child.once("exit", (code) =>
      finish(code === 0 || (process.platform === "win32" && code === 1)),
    );
  });
}

/** Mount at /api after the entrypoint's authentication and origin guards. */
export function createStudioApi(options) {
  const storage = createStorage(options);
  const { db, info, absolute, transaction } = storage;
  info.mode = options.hosted ? "hosted" : "local";
  info.canOpenFolder = !options.hosted;
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    next();
  });
  router.use(express.json({ limit: "256kb" }));
  const jobRow = (id, includeDeleted = false) => {
    validId(id);
    const row = db
      .prepare(`SELECT * FROM jobs WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`)
      .get(id);
    if (!row) throw new ApiError(404, "ไม่พบงานนี้");
    return row;
  };
  const assetRow = (id, includeDeleted = false) => {
    validId(id);
    const row = db
      .prepare(
        `SELECT assets.* FROM assets JOIN jobs ON jobs.id = assets.job_id WHERE assets.id = ?${includeDeleted ? "" : " AND assets.deleted_at IS NULL AND jobs.deleted_at IS NULL"}`,
      )
      .get(id);
    if (!row) throw new ApiError(404, "ไม่พบไฟล์นี้");
    return row;
  };
  const assetsFor = (id) =>
    db
      .prepare(
        "SELECT * FROM assets WHERE job_id = ? AND deleted_at IS NULL ORDER BY created_at, id",
      )
      .all(id)
      .map(mapAsset);
  const fullJob = (id, includeDeleted = false) => mapJob(jobRow(id, includeDeleted), assetsFor(id));
  const settings = () => {
    const row = db.prepare("SELECT * FROM settings WHERE id = 1").get();
    return row
      ? { reelAnchor: row.reel_anchor, reelEnabled: !!row.reel_enabled }
      : { reelAnchor: "", reelEnabled: true };
  };

  router.get("/studio", (_req, res) => {
    const grouped = new Map();
    for (const row of db
      .prepare(
        "SELECT assets.* FROM assets JOIN jobs ON jobs.id = assets.job_id WHERE assets.deleted_at IS NULL AND jobs.deleted_at IS NULL ORDER BY assets.created_at, assets.id",
      )
      .all()) {
      const entries = grouped.get(row.job_id) || [];
      entries.push(mapAsset(row));
      grouped.set(row.job_id, entries);
    }
    const jobs = db
      .prepare("SELECT * FROM jobs WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC")
      .all()
      .map((row) => mapJob(row, grouped.get(row.id) || []));
    res.json({ jobs, settings: settings(), storage: info });
  });
  router.get("/storage", (_req, res) => res.json(info));
  router.post("/storage/open", async (_req, res) => {
    if (options.hosted)
      throw new ApiError(409, "ไฟล์อยู่บนเซิร์ฟเวอร์ ใช้ปุ่มดาวน์โหลดเพื่อบันทึกลงเครื่องของคุณ");
    res.json(await openFolder(storage.root));
  });

  router.post("/jobs", (req, res) => {
    const input = { ...jsonBody(req) };
    const id = input.id === undefined ? randomUUID() : validId(input.id);
    delete input.id;
    const defaults = {
      store: "supersix",
      title: "",
      requester: "",
      brief: "",
      type: "image",
      plannedDate: "",
      dueDate: "",
      priority: "normal",
      quantity: null,
      referenceUrl: "",
    };
    for (const key of Object.keys(input))
      if (!Object.hasOwn(defaults, key))
        throw new ApiError(400, `ไม่รองรับข้อมูลช่อง ${key.slice(0, 50)}`);
    const values = validatedPatch({ ...defaults, ...input });
    const existing = db.prepare("SELECT deleted_at FROM jobs WHERE id = ?").get(id);
    if (existing) {
      if (existing.deleted_at)
        throw new ApiError(409, "รหัสนี้เป็นงานในถังขยะ กรุณากู้คืนหรือสร้างงานใหม่");
      return res.json({ job: fullJob(id) });
    }
    const columns = Object.keys(values);
    const timestamp = now();
    db.prepare(
      `INSERT INTO jobs(id,${columns.join(",")},created_at,updated_at) VALUES (${Array(
        columns.length + 3,
      )
        .fill("?")
        .join(",")})`,
    ).run(id, ...Object.values(values), timestamp, timestamp);
    res.status(201).json({ job: fullJob(id) });
  });
  router.patch("/jobs/:id", (req, res) => {
    const current = jobRow(req.params.id);
    const patch = validatedPatch(jsonBody(req));
    const timestamp = now();
    if ("work_status" in patch)
      patch.completed_at = patch.work_status === "done" ? current.completed_at || timestamp : null;
    patch.updated_at = timestamp;
    const apply = () =>
      db
        .prepare(
          `UPDATE jobs SET ${Object.keys(patch)
            .map((column) => `${column} = ?`)
            .join(",")} WHERE id = ?`,
        )
        .run(...Object.values(patch), current.id);
    if (patch.store && patch.store !== current.store)
      storage.moveJobShop(current, patch.store, apply);
    else transaction(apply);
    res.json({ job: fullJob(current.id) });
  });
  router.delete("/jobs/:id", (req, res) => {
    const row = jobRow(req.params.id);
    db.prepare("UPDATE jobs SET deleted_at = ?, updated_at = ? WHERE id = ?").run(
      now(),
      now(),
      row.id,
    );
    res.json({ ok: true });
  });
  router.post("/jobs/:id/restore", (req, res) => {
    const row = jobRow(req.params.id, true);
    db.prepare("UPDATE jobs SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(now(), row.id);
    res.json({ job: fullJob(row.id) });
  });
  router.post("/jobs/:id/folder", async (req, res) => {
    if (options.hosted)
      throw new ApiError(409, "ไฟล์อยู่บนเซิร์ฟเวอร์ ใช้ปุ่มดาวน์โหลดเพื่อบันทึกลงเครื่องของคุณ");
    const row = jobRow(req.params.id);
    res.json(await openFolder(storage.jobFolder(row, true)));
  });

  router.get("/trash", (_req, res) => {
    const jobs = db
      .prepare("SELECT * FROM jobs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
      .all()
      .map((row) => mapJob(row, assetsFor(row.id)));
    const assets = db
      .prepare(
        "SELECT assets.*, jobs.title AS job_title FROM assets JOIN jobs ON jobs.id = assets.job_id WHERE assets.deleted_at IS NOT NULL AND jobs.deleted_at IS NULL ORDER BY assets.deleted_at DESC",
      )
      .all()
      .map((row) => ({ ...mapAsset(row), jobTitle: row.job_title }));
    res.json({ jobs, assets });
  });

  router.post("/jobs/:id/assets", async (req, res) => {
    jobRow(req.params.id);
    const maxBytes = info.maxUploadBytes;
    const maxLabel = Math.round(maxBytes / 1024 / 1024);
    if (!req.is("multipart/form-data")) throw new ApiError(415, "กรุณาเลือกไฟล์จากปุ่มอัปโหลด");
    if (Number(req.headers["content-length"] || 0) > maxBytes + 128 * 1024)
      throw new ApiError(413, `ไฟล์ต้องมีขนาดไม่เกิน ${maxLabel} MB`);
    const id = randomUUID();
    const temporaryFile = path.join(storage.temporaryPath, `${id}.partial`);
    let fileName = "";
    let mimeType = "";
    let bytes = 0;
    let header = Buffer.alloc(0);
    let fileError;
    let seen = false;
    let completed = false;
    const writes = [];
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        defParamCharset: "utf8",
        limits: { files: 1, fields: 0, parts: 2, fileSize: maxBytes + 1, headerPairs: 100 },
      });
    } catch {
      throw new ApiError(400, "ข้อมูลอัปโหลดไม่ถูกต้อง");
    }
    const onAborted = () => parser.destroy(new ApiError(400, "การอัปโหลดถูกยกเลิก"));
    req.once("aborted", onAborted);
    try {
      await new Promise((resolve, reject) => {
        parser.once("error", reject);
        parser.once("close", resolve);
        parser.on("filesLimit", () => {
          fileError = new ApiError(400, "กรุณาส่งไฟล์ครั้งละหนึ่งไฟล์");
        });
        parser.on("fieldsLimit", () => {
          fileError = new ApiError(400, "ไม่รองรับข้อมูลเพิ่มเติมในไฟล์อัปโหลด");
        });
        parser.on("partsLimit", () => {
          fileError = new ApiError(400, "กรุณาส่งไฟล์ครั้งละหนึ่งไฟล์");
        });
        parser.on("file", (field, stream, metadata) => {
          if (seen || field !== "file") {
            fileError = new ApiError(400, "กรุณาเลือกไฟล์อัปโหลด");
            stream.resume();
            return;
          }
          seen = true;
          fileName =
            path.win32
              .basename(path.posix.basename(metadata.filename || "file"))
              .replace(/[\u0000-\u001f\u007f]/g, "")
              .slice(0, 240) || "file";
          mimeType = metadata.mimeType;
          if (mimeType === "application/octet-stream")
            mimeType = EXTENSION_MIMES[path.extname(fileName).toLowerCase()] || mimeType;
          if (!Object.hasOwn(MIME_TYPES, mimeType)) {
            fileError = new ApiError(415, "รองรับ JPG, PNG, WEBP, GIF, AVIF, MP4, WEBM และ MOV");
            stream.resume();
            return;
          }
          stream.once("limit", () => {
            fileError = new ApiError(413, `ไฟล์ต้องมีขนาดไม่เกิน ${maxLabel} MB`);
          });
          const counter = new Transform({
            transform(chunk, _encoding, callback) {
              bytes += chunk.length;
              if (header.length < 64)
                header = Buffer.concat([header, chunk.subarray(0, 64 - header.length)]);
              callback(null, chunk);
            },
          });
          writes.push(
            pipeline(stream, counter, createWriteStream(temporaryFile, { flags: "wx" })).catch(
              (error) => {
                fileError ||= error;
                parser.destroy(error);
              },
            ),
          );
        });
        req.pipe(parser);
      });
      await Promise.all(writes);
      if (fileError) throw fileError;
      if (bytes > maxBytes) throw new ApiError(413, `ไฟล์ต้องมีขนาดไม่เกิน ${maxLabel} MB`);
      if (!seen || !bytes) throw new ApiError(400, "ไฟล์นี้ไม่มีข้อมูล");
      if (!validHeader(header, mimeType))
        throw new ApiError(415, "เนื้อหาไฟล์ไม่ตรงกับชนิดรูปหรือวิดีโอ กรุณาเลือกไฟล์ใหม่");
      // Re-read after streaming: a second browser tab may have moved/removed the job.
      const job = jobRow(req.params.id);
      const type = MIME_TYPES[mimeType];
      const relativePath = path.posix.join(
        storage.jobRelative(job),
        type.kind === "image" ? "images" : "videos",
        `${safeBase(fileName)}_${id}.${type.extension}`,
      );
      const destination = absolute(relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      renameSync(temporaryFile, destination);
      const timestamp = now();
      try {
        transaction(() => {
          db.prepare(
            "INSERT INTO assets(id,job_id,relative_path,name,mime_type,size,kind,created_at) VALUES (?,?,?,?,?,?,?,?)",
          ).run(id, job.id, relativePath, fileName, mimeType, bytes, type.kind, timestamp);
          db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(timestamp, job.id);
        });
      } catch (error) {
        unlinkSync(destination);
        throw error;
      }
      completed = true;
      res.status(201).json({ asset: mapAsset(assetRow(id)) });
    } finally {
      req.off("aborted", onAborted);
      await Promise.allSettled(writes);
      if (!completed && existsSync(temporaryFile)) unlinkSync(temporaryFile);
    }
  });

  router.get("/assets/:id", async (req, res) => {
    const row = assetRow(req.params.id);
    const location = absolute(row.relative_path);
    let file;
    try {
      file = statSync(location);
    } catch (error) {
      if (error.code === "ENOENT")
        throw new ApiError(404, "ไม่พบไฟล์บนดิสก์ อาจถูกย้ายหรือลบจากโฟลเดอร์โดยตรง");
      throw error;
    }
    if (!file.isFile()) throw new ApiError(404, "ไม่พบไฟล์ต้นฉบับ");
    const total = file.size;
    const range = req.headers.range;
    let start = 0;
    let end = total - 1;
    const invalidRange = () =>
      res
        .status(416)
        .set({ "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" })
        .end();
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match || (!match[1] && !match[2])) return invalidRange();
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalidRange();
        start = Math.max(0, total - suffix);
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), total - 1);
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= total
        )
          return invalidRange();
      }
    }
    const encodedName = encodeURIComponent(row.name).replace(
      /['()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    res.status(range ? 206 : 200).set({
      "Content-Type": row.mime_type,
      "Content-Length": String(range ? end - start + 1 : total),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="media.${MIME_TYPES[row.mime_type].extension}"; filename*=UTF-8''${encodedName}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    if (range) res.set("Content-Range", `bytes ${start}-${end}/${total}`);
    if (req.method === "HEAD") return res.end();
    try {
      await pipeline(createReadStream(location, { start, end }), res);
    } catch (error) {
      if (!res.destroyed) throw error;
    }
  });
  router.delete("/assets/:id", (req, res) => {
    const row = assetRow(req.params.id);
    transaction(() => {
      db.prepare("UPDATE assets SET deleted_at = ? WHERE id = ?").run(now(), row.id);
      db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(now(), row.job_id);
    });
    res.json({ ok: true });
  });
  router.post("/assets/:id/restore", (req, res) => {
    const row = assetRow(req.params.id, true);
    jobRow(row.job_id);
    transaction(() => {
      db.prepare("UPDATE assets SET deleted_at = NULL WHERE id = ?").run(row.id);
      db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(now(), row.job_id);
    });
    res.json({ asset: mapAsset(assetRow(row.id)) });
  });

  router.patch("/settings", (req, res) => {
    const input = jsonBody(req);
    const current = settings();
    if (
      !Object.keys(input).length ||
      Object.keys(input).some((key) => !["reelAnchor", "reelEnabled"].includes(key))
    )
      throw new ApiError(400, "ข้อมูลการตั้งค่าไม่ถูกต้อง");
    if ("reelAnchor" in input) current.reelAnchor = date(input.reelAnchor, "วันเริ่มรอบ Reel");
    if ("reelEnabled" in input) {
      if (typeof input.reelEnabled !== "boolean")
        throw new ApiError(400, "การตั้งค่ารอบ Reel ไม่ถูกต้อง");
      current.reelEnabled = input.reelEnabled;
    }
    db.prepare(
      "INSERT INTO settings(id,reel_anchor,reel_enabled,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET reel_anchor=excluded.reel_anchor,reel_enabled=excluded.reel_enabled,updated_at=excluded.updated_at",
    ).run(current.reelAnchor, current.reelEnabled ? 1 : 0, now());
    res.json({ settings: current });
  });
  router.use((_req, _res, next) => next(new ApiError(404, "ไม่พบคำสั่งนี้")));
  router.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status =
      error instanceof ApiError
        ? error.status
        : error.type === "entity.too.large"
          ? 413
          : error.type === "entity.parse.failed"
            ? 400
            : 500;
    if (status === 500) console.error("Studio API:", error.message);
    const message =
      error instanceof ApiError
        ? error.message
        : status === 413
          ? "รายละเอียดงานยาวเกินไป"
          : status === 400
            ? "รูปแบบข้อมูลไม่ถูกต้อง"
            : "บันทึกหรือโหลดข้อมูลไม่สำเร็จ ตรวจว่าโฟลเดอร์มีสิทธิ์เขียนและพื้นที่ว่างเพียงพอ";
    res.status(status).json({ error: message });
  });
  return { router, storageInfo: info, close: () => storage.close() };
}
