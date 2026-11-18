import { useCallback, useEffect, useState } from "react";
import {
  ArchiveRestore,
  Check,
  Copy,
  FileImage,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Modal } from "./studio-forms";
import { api } from "./lib/api";
import { STORES, prettyDate, type StorageInfo, type TrashData } from "./lib/studio-types";

export function StorageDialog({
  storage,
  onClose,
}: {
  storage: StorageInfo | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [opening, setOpening] = useState(false);
  const [folderMessage, setFolderMessage] = useState("");
  const [folderError, setFolderError] = useState(false);
  const hosted = storage?.mode === "hosted";
  async function openRoot() {
    if (!storage?.canOpenFolder) return;
    setOpening(true);
    setFolderMessage("");
    try {
      const result = await api<{ path: string; opened: boolean; error?: string }>(
        "/api/storage/open",
        "POST",
      );
      setFolderError(!result.opened);
      setFolderMessage(
        result.opened
          ? "เปิดโฟลเดอร์ในเครื่องแล้ว"
          : `${result.error || "เปิดโฟลเดอร์อัตโนมัติไม่ได้"} คัดลอกตำแหน่งด้านบนไปเปิดเองได้`,
      );
    } catch (error) {
      setFolderError(true);
      setFolderMessage(error instanceof Error ? error.message : "เปิดโฟลเดอร์ไม่สำเร็จ");
    } finally {
      setOpening(false);
    }
  }
  async function copyPath() {
    if (!storage) return;
    try {
      await navigator.clipboard.writeText(storage.rootPath);
      setCopied(true);
    } catch {
      setCopyError("คัดลอกอัตโนมัติไม่ได้ เลือกข้อความตำแหน่งโฟลเดอร์ด้านบนแล้วกด Ctrl+C ได้");
    }
  }
  return (
    <Modal title="จัดเก็บไฟล์" subtitle="งานและไฟล์ของคุณเก็บอยู่ที่นี่" onClose={onClose}>
      <div className="form-body storage-body">
        <div className="storage-heading">
          <span>
            <HardDrive size={23} />
          </span>
          <div>
            <strong>{hosted ? "พื้นที่ส่วนตัวบนเซิร์ฟเวอร์" : "พื้นที่ส่วนตัวบนเครื่องนี้"}</strong>
            <p>
              {hosted
                ? "ไฟล์ที่แนบเก็บบนเซิร์ฟเวอร์ Render แยกตามร้านและงาน คุณดาวน์โหลดไฟล์กลับมาได้จากแต่ละงาน"
                : "ไฟล์ที่แนบจะถูกคัดลอกมาเก็บแยกตามร้านและงาน โดยไฟล์ต้นฉบับยังอยู่ที่เดิม"}
            </p>
          </div>
        </div>
        {storage ? (
          <>
            <label className="field-label" htmlFor="storage-location">
              {hosted ? "ตำแหน่งจัดเก็บบนเซิร์ฟเวอร์" : "โฟลเดอร์หลัก"}
            </label>
            <input
              id="storage-location"
              className="path-box"
              value={storage.rootPath}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="storage-buttons">
              {storage.canOpenFolder && (
                <button
                  className="btn btn-primary"
                  disabled={opening}
                  onClick={() => void openRoot()}
                >
                  {opening ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />}{" "}
                  เปิดโฟลเดอร์หลัก
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => void copyPath()}>
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? "คัดลอกแล้ว" : "คัดลอกตำแหน่ง"}
              </button>
            </div>
            {copyError && <p className="form-error">{copyError}</p>}
            {folderMessage && (
              <p className={folderError ? "form-error" : "trash-success"} role="status">
                {folderMessage}
              </p>
            )}
            <div className="storage-details">
              <div>
                <Folder size={17} />
                <span>
                  <strong>รูปและวิดีโอ</strong>
                  <small>แยกโฟลเดอร์ร้าน → ปี → รหัสงาน → images / videos</small>
                </span>
              </div>
              <div>
                <HardDrive size={17} />
                <span>
                  <strong>ข้อมูลรายการงาน</strong>
                  <small>เก็บในฐานข้อมูลออนไลน์ แยกจากไฟล์รูปและวิดีโอ</small>
                </span>
              </div>
              <div>
                <Trash2 size={17} />
                <span>
                  <strong>ลบแล้วกู้คืนได้</strong>
                  <small>การย้ายไปถังพักจะเก็บไฟล์จริงไว้ กู้คืนได้จากเมนูถังพัก</small>
                </span>
              </div>
            </div>
            <p className="field-hint">
              {hosted
                ? "ไฟล์อยู่ในพื้นที่จัดเก็บของเซิร์ฟเวอร์ ไม่ได้สร้างโฟลเดอร์บนคอมพิวเตอร์ของคุณ ควรสำรองฐานข้อมูลและไฟล์แนบไว้ด้วยกัน"
                : "สำรองฐานข้อมูลออนไลน์และคัดลอกโฟลเดอร์ไฟล์แนบเก็บไว้ด้วยกัน"}{" "}
              การส่งออก CSV เก็บเฉพาะข้อมูลตาราง
            </p>
          </>
        ) : (
          <p className="form-error">
            ยังอ่านตำแหน่งโฟลเดอร์ไม่ได้ ตรวจว่าโปรแกรมกำลังทำงานแล้วลองโหลดหน้าใหม่
          </p>
        )}
      </div>
      <div className="dialog-footer">
        <button className="btn btn-secondary" onClick={onClose}>
          ปิด
        </button>
      </div>
    </Modal>
  );
}

export function TrashDialog({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const [data, setData] = useState<TrashData>({ jobs: [], assets: [] });
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api<TrashData>("/api/trash"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "เปิดถังพักไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function restore(kind: "jobs" | "assets", id: string) {
    if (restoring) return;
    setRestoring(id);
    setError("");
    setMessage("");
    try {
      await api(`/api/${kind}/${id}/restore`, "POST");
      setMessage(kind === "jobs" ? "กู้คืนงานแล้ว" : "กู้คืนไฟล์แล้ว");
      await onRestored();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "กู้คืนไม่สำเร็จ");
    } finally {
      setRestoring("");
    }
  }
  return (
    <Modal
      title="ถังพัก"
      subtitle="งานและไฟล์ที่นำออก กู้คืนกลับมาได้"
      onClose={onClose}
      busy={Boolean(restoring)}
    >
      <div className="form-body trash-body">
        <p className="field-hint">
          ไฟล์จริงยังอยู่ในโฟลเดอร์เดิม การกู้คืนงานจะนำไฟล์ที่อยู่กับงานนั้นกลับมาด้วย
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="trash-success" role="status">
            <Check size={16} />
            {message}
          </p>
        )}
        {loading ? (
          <div className="trash-loading">
            <Loader2 className="spin" size={22} /> กำลังเปิดถังพัก…
          </div>
        ) : (
          <>
            {!data.jobs.length && !data.assets.length && !error && (
              <div className="trash-empty">
                <Trash2 size={30} />
                <h3>ไม่มีรายการในถังพัก</h3>
                <p>งานและไฟล์ที่นำออกจะแสดงที่นี่</p>
              </div>
            )}
            {data.jobs.length > 0 && (
              <section className="trash-section">
                <h3>
                  งาน <span>{data.jobs.length}</span>
                </h3>
                {data.jobs.map((job) => (
                  <div className="trash-item" key={job.id}>
                    <span className="trash-icon">
                      <Folder size={19} />
                    </span>
                    <div>
                      <strong>{job.title}</strong>
                      <small>
                        {STORES.find((store) => store.id === job.store)?.name}
                        {job.deletedAt ? ` · ${prettyDate(job.deletedAt)}` : ""}
                      </small>
                    </div>
                    <button
                      className="btn btn-small btn-secondary"
                      disabled={Boolean(restoring)}
                      onClick={() => void restore("jobs", job.id)}
                    >
                      {restoring === job.id ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <ArchiveRestore size={15} />
                      )}{" "}
                      กู้คืน
                    </button>
                  </div>
                ))}
              </section>
            )}
            {data.assets.length > 0 && (
              <section className="trash-section">
                <h3>
                  ไฟล์ที่นำออกจากงาน <span>{data.assets.length}</span>
                </h3>
                {data.assets.map((asset) => (
                  <div className="trash-item" key={asset.id}>
                    <span className="trash-icon">
                      <FileImage size={19} />
                    </span>
                    <div>
                      <strong>{asset.name}</strong>
                      <small>
                        {asset.jobTitle || "ไฟล์แนบงาน"}
                        {asset.deletedAt ? ` · ${prettyDate(asset.deletedAt)}` : ""}
                      </small>
                    </div>
                    <button
                      className="btn btn-small btn-secondary"
                      disabled={Boolean(restoring)}
                      onClick={() => void restore("assets", asset.id)}
                    >
                      {restoring === asset.id ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <ArchiveRestore size={15} />
                      )}{" "}
                      กู้คืน
                    </button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
      <div className="dialog-footer">
        <button
          className="btn btn-quiet"
          onClick={() => void load()}
          disabled={loading || Boolean(restoring)}
        >
          <RefreshCw size={15} /> โหลดอีกครั้ง
        </button>
        <button className="btn btn-secondary" onClick={onClose} disabled={Boolean(restoring)}>
          ปิด
        </button>
      </div>
    </Modal>
  );
}
