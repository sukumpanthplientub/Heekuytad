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
// eslint-disable-next-line no-control-regex -- Filename sanitizers must explicitly remove control characters.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
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
  return id.toLowerCase();
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
      return v;
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
    .name.replace(CONTROL_CHARACTERS, "_")
    .replace(/[<>:"/\\|?*]/g, "_")
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
export async function createStudioApi(options) {
  const storage = await createStorage(options);
  const { db, info, absolute, withJob } = storage;
  info.mode = options.hosted ? "hosted" : "local";
  info.canOpenFolder = !options.hosted;
  const uploads = new Set();
  let draining = false;
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
  const jobRow = async (id, includeDeleted = false, client = db) => {
    const row = await client.job.findFirst({
      where: { id: validId(id), ...(!includeDeleted ? { deleted_at: null } : {}) },
    });
    if (!row) throw new ApiError(404, "ไม่พบงานนี้");
    return row;
  };
  const assetRow = async (id, includeDeleted = false, client = db) => {
    const row = await client.asset.findFirst({
      where: {
        id: validId(id),
        ...(!includeDeleted ? { deleted_at: null, job: { deleted_at: null } } : {}),
      },
    });
    if (!row) throw new ApiError(404, "ไม่พบไฟล์นี้");
    return row;
  };
  const activeAssets = {
    where: { deleted_at: null },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
  };
  const fullJob = async (id, includeDeleted = false, client = db) => {
    const row = await client.job.findFirst({
      where: { id: validId(id), ...(!includeDeleted ? { deleted_at: null } : {}) },
      include: { assets: activeAssets },
    });
    if (!row) throw new ApiError(404, "ไม่พบงานนี้");
    return mapJob(row, row.assets.map(mapAsset));
  };
  const settings = async (client = db) => {
    const row = await client.settings.findUnique({ where: { id: 1 } });
    return row
      ? { reelAnchor: row.reel_anchor, reelEnabled: row.reel_enabled }
      : { reelAnchor: "", reelEnabled: true };
  };

  router.get("/studio", async (_req, res) => {
    const [rows, currentSettings] = await Promise.all([
      db.job.findMany({
        where: { deleted_at: null },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        include: { assets: activeAssets },
      }),
      settings(),
    ]);
    res.json({
      jobs: rows.map((row) => mapJob(row, row.assets.map(mapAsset))),
      settings: currentSettings,
      storage: info,
    });
  });
  router.get("/storage", (_req, res) => res.json(info));
  router.post("/storage/open", async (_req, res) => {
    if (options.hosted)
      throw new ApiError(409, "ไฟล์อยู่บนเซิร์ฟเวอร์ ใช้ปุ่มดาวน์โหลดเพื่อบันทึกลงเครื่องของคุณ");
    res.json(await openFolder(storage.root));
  });

  router.post("/jobs", async (req, res) => {
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
        throw new ApiError(400, "ไม่รองรับข้อมูลช่อง " + key.slice(0, 50));
    const values = validatedPatch({ ...defaults, ...input });
    const result = await withJob(id, async (tx) => {
      const existing = await tx.job.findUnique({ where: { id } });
      if (existing?.deleted_at)
        throw new ApiError(409, "รหัสนี้เป็นงานในถังขยะ กรุณากู้คืนหรือสร้างงานใหม่");
      if (!existing) await tx.job.create({ data: { id, ...values } });
      return { created: !existing, job: await fullJob(id, false, tx) };
    });
    res.status(result.created ? 201 : 200).json({ job: result.job });
  });
  router.patch("/jobs/:id", async (req, res) => {
    const id = validId(req.params.id);
    const patch = validatedPatch(jsonBody(req));
    const job = await withJob(id, async (tx, rollback, committed) => {
      const current = await jobRow(id, false, tx);
      const timestamp = now();
      if ("work_status" in patch)
        patch.completed_at =
          patch.work_status === "done" ? current.completed_at || timestamp : null;
      patch.updated_at = timestamp;
      if (patch.store) await storage.moveJobShop(tx, current, patch.store, rollback, committed);
      await tx.job.update({ where: { id }, data: patch });
      return fullJob(id, false, tx);
    });
    res.json({ job });
  });
  router.delete("/jobs/:id", async (req, res) => {
    const id = validId(req.params.id);
    await withJob(id, async (tx) => {
      await jobRow(id, false, tx);
      await tx.job.update({ where: { id }, data: { deleted_at: now() } });
    });
    res.json({ ok: true });
  });
  router.post("/jobs/:id/restore", async (req, res) => {
    const id = validId(req.params.id);
    const job = await withJob(id, async (tx) => {
      await jobRow(id, true, tx);
      await tx.job.update({ where: { id }, data: { deleted_at: null } });
      return fullJob(id, false, tx);
    });
    res.json({ job });
  });
  router.post("/jobs/:id/folder", async (req, res) => {
    if (options.hosted)
      throw new ApiError(409, "ไฟล์อยู่บนเซิร์ฟเวอร์ ใช้ปุ่มดาวน์โหลดเพื่อบันทึกลงเครื่องของคุณ");
    const row = await jobRow(req.params.id);
    res.json(await openFolder(storage.jobFolder(row, true)));
  });

  router.get("/trash", async (_req, res) => {
    const [jobs, assets] = await Promise.all([
      db.job.findMany({
        where: { deleted_at: { not: null } },
        orderBy: { deleted_at: "desc" },
        include: { assets: activeAssets },
      }),
      db.asset.findMany({
        where: { deleted_at: { not: null }, job: { deleted_at: null } },
        orderBy: { deleted_at: "desc" },
        include: { job: { select: { title: true } } },
      }),
    ]);
    res.json({
      jobs: jobs.map((row) => mapJob(row, row.assets.map(mapAsset))),
      assets: assets.map((row) => ({ ...mapAsset(row), jobTitle: row.job.title })),
    });
  });

  async function receiveUpload(req, res, controller) {
    await jobRow(req.params.id);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (req.aborted) throw new ApiError(400, "การอัปโหลดถูกยกเลิก");
    const maxBytes = info.maxUploadBytes;
    const maxLabel = Math.round(maxBytes / 1024 / 1024);
    if (!req.is("multipart/form-data")) throw new ApiError(415, "กรุณาเลือกไฟล์จากปุ่มอัปโหลด");
    if (Number(req.headers["content-length"] || 0) > maxBytes + 128 * 1024)
      throw new ApiError(413, `ไฟล์ต้องมีขนาดไม่เกิน ${maxLabel} MB`);
    storage.checkUploadSpace(Math.min(Number(req.headers["content-length"]) || maxBytes, maxBytes));
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
    const onAborted = () => controller.abort(new ApiError(400, "การอัปโหลดถูกยกเลิก"));
    const cancelParser = () => parser.destroy(controller.signal.reason);
    controller.signal.addEventListener("abort", cancelParser, { once: true });
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
              .replace(CONTROL_CHARACTERS, "")
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
              if (bytes > maxBytes)
                return callback(new ApiError(413, `ไฟล์ต้องมีขนาดไม่เกิน ${maxLabel} MB`));
              if (header.length < 64)
                header = Buffer.concat([header, chunk.subarray(0, 64 - header.length)]);
              callback(null, chunk);
            },
          });
          writes.push(
            pipeline(stream, counter, createWriteStream(temporaryFile, { flags: "wx" }), {
              signal: controller.signal,
            }).catch((error) => {
              fileError ||= error;
              parser.destroy(error);
            }),
          );
        });
        req.pipe(parser);
      });
      await Promise.all(writes);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (fileError) throw fileError;
      if (bytes > maxBytes) throw new ApiError(413, `ไฟล์ต้องมีขนาดไม่เกิน ${maxLabel} MB`);
      if (!seen || !bytes) throw new ApiError(400, "ไฟล์นี้ไม่มีข้อมูล");
      if (!validHeader(header, mimeType))
        throw new ApiError(415, "เนื้อหาไฟล์ไม่ตรงกับชนิดรูปหรือวิดีโอ กรุณาเลือกไฟล์ใหม่");
      // Take the job lock only after streaming, so other tabs can edit during upload.
      const asset = await withJob(req.params.id, async (tx, rollback) => {
        const job = await jobRow(req.params.id, false, tx);
        const type = MIME_TYPES[mimeType];
        const relativePath = path.posix.join(
          storage.jobRelative(job),
          type.kind === "image" ? "images" : "videos",
          safeBase(fileName) + "_" + id + "." + type.extension,
        );
        const destination = absolute(relativePath);
        mkdirSync(path.dirname(destination), { recursive: true });
        renameSync(temporaryFile, destination);
        rollback.push(() => {
          if (existsSync(destination)) unlinkSync(destination);
        });
        const row = await tx.asset.create({
          data: {
            id,
            job_id: job.id,
            relative_path: relativePath,
            name: fileName,
            mime_type: mimeType,
            size: bytes,
            kind: type.kind,
          },
        });
        await tx.job.update({ where: { id: job.id }, data: { updated_at: now() } });
        return mapAsset(row);
      });
      completed = true;
      res.status(201).json({ asset });
    } finally {
      req.off("aborted", onAborted);
      controller.signal.removeEventListener("abort", cancelParser);
      req.unpipe(parser);
      if (!req.complete && !res.headersSent) res.setHeader("Connection", "close");
      await Promise.allSettled(writes);
      if (!completed && existsSync(temporaryFile)) unlinkSync(temporaryFile);
    }
  }

  router.post("/jobs/:id/assets", async (req, res) => {
    if (draining) throw new ApiError(503, "ระบบกำลังเริ่มใหม่ กรุณาลองอัปโหลดอีกครั้ง");
    if (uploads.size >= 2) {
      res.setHeader("Retry-After", "3");
      throw new ApiError(429, "มีไฟล์กำลังอัปโหลดอยู่ กรุณารอสักครู่แล้วลองอีกครั้ง");
    }
    const controller = new AbortController();
    uploads.add(controller);
    try {
      await receiveUpload(req, res, controller);
    } finally {
      uploads.delete(controller);
    }
  });

  router.get("/assets/:id", async (req, res) => {
    const row = await assetRow(req.params.id);
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
  router.delete("/assets/:id", async (req, res) => {
    const initial = await assetRow(req.params.id);
    await withJob(initial.job_id, async (tx) => {
      const row = await assetRow(req.params.id, false, tx);
      await tx.asset.update({ where: { id: row.id }, data: { deleted_at: now() } });
      await tx.job.update({ where: { id: row.job_id }, data: { updated_at: now() } });
    });
    res.json({ ok: true });
  });
  router.post("/assets/:id/restore", async (req, res) => {
    const initial = await assetRow(req.params.id, true);
    const asset = await withJob(initial.job_id, async (tx) => {
      const row = await assetRow(req.params.id, true, tx);
      await jobRow(row.job_id, false, tx);
      const restored = await tx.asset.update({ where: { id: row.id }, data: { deleted_at: null } });
      await tx.job.update({ where: { id: row.job_id }, data: { updated_at: now() } });
      return mapAsset(restored);
    });
    res.json({ asset });
  });

  router.patch("/settings", async (req, res) => {
    const input = jsonBody(req);
    if (
      !Object.keys(input).length ||
      Object.keys(input).some((key) => !["reelAnchor", "reelEnabled"].includes(key))
    )
      throw new ApiError(400, "ข้อมูลการตั้งค่าไม่ถูกต้อง");
    const patch = {};
    if ("reelAnchor" in input) patch.reel_anchor = date(input.reelAnchor, "วันเริ่มรอบ Reel");
    if ("reelEnabled" in input) {
      if (typeof input.reelEnabled !== "boolean")
        throw new ApiError(400, "การตั้งค่ารอบ Reel ไม่ถูกต้อง");
      patch.reel_enabled = input.reelEnabled;
    }
    const row = await db.settings.upsert({
      where: { id: 1 },
      create: { id: 1, ...patch },
      update: patch,
    });
    res.json({ settings: { reelAnchor: row.reel_anchor, reelEnabled: row.reel_enabled } });
  });
  router.use((_req, _res, next) => next(new ApiError(404, "ไม่พบคำสั่งนี้")));
  router.use((error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return res.end();
    const status =
      error.code === "ENOSPC"
        ? 507
        : error instanceof ApiError
          ? error.status
          : error.type === "entity.too.large"
            ? 413
            : error.type === "entity.parse.failed"
              ? 400
              : 500;
    if (status === 500) console.error("Studio API:", error.code || error.name);
    const message =
      status === 507
        ? "พื้นที่เก็บไฟล์บนเซิร์ฟเวอร์ไม่เพียงพอ กรุณาเพิ่มพื้นที่แล้วลองอีกครั้ง"
        : error instanceof ApiError
          ? error.message
          : status === 413
            ? "รายละเอียดงานยาวเกินไป"
            : status === 400
              ? "รูปแบบข้อมูลไม่ถูกต้อง"
              : "บันทึกหรือโหลดข้อมูลไม่สำเร็จ ตรวจการเชื่อมต่อฐานข้อมูลและพื้นที่เก็บไฟล์";
    res.status(status).json({ error: message });
  });
  return {
    router,
    storageInfo: info,
    health: () => storage.health(),
    drain() {
      draining = true;
      for (const controller of uploads)
        controller.abort(new ApiError(503, "ระบบกำลังเริ่มใหม่ กรุณาลองอัปโหลดอีกครั้ง"));
    },
    close: () => storage.close(),
  };
}
