import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  Clapperboard,
  Clock3,
  Image as ImageIcon,
  Info,
  Layers3,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import {
  STORES,
  addDays,
  prettyDate,
  type Job,
  type JobInput,
  type PostStatus,
  type StudioSettings,
} from "./lib/studio-types";

type ModalProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  drawer?: boolean;
  busy?: boolean;
};

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  drawer = false,
  busy = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  function dismiss() {
    if (busy || dialogRef.current?.querySelector('[aria-busy="true"]')) return;
    onClose();
  }
  return (
    <dialog
      ref={dialogRef}
      className={`studio-dialog${drawer ? " drawer" : " center"}`}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dismiss();
      }}
    >
      <div className="dialog-content">
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={subtitleId}>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-button dialog-close"
            onClick={dismiss}
            disabled={busy}
            aria-label="ปิดหน้าต่าง"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

const SUPPORTED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
const FILE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov";
type PendingFile = { key: string; file: File; preview: string };

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isValidUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
function messageFrom(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง";
}
function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function editableInput(input: JobInput): JobInput {
  return {
    store: input.store,
    title: input.title,
    requester: input.requester,
    brief: input.brief,
    type: input.type,
    plannedDate: input.plannedDate,
    dueDate: input.dueDate,
    priority: input.priority,
    quantity: input.quantity,
    referenceUrl: input.referenceUrl,
  };
}

export function JobForm({
  initial,
  editing,
  onClose,
  onSave,
  maxUploadBytes,
}: {
  initial: JobInput;
  editing?: Job;
  onClose: () => void;
  onSave: (input: JobInput, files: File[], editing?: Job) => Promise<void>;
  maxUploadBytes: number;
}) {
  const [draft, setDraft] = useState<JobInput>(() => editableInput(initial));
  const [quantity, setQuantity] = useState(
    initial.quantity == null ? "" : String(initial.quantity),
  );
  const [pending, setPending] = useState<PendingFile[]>([]);
  const pendingRef = useRef<PendingFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const isDemo = Boolean(editing?.id.startsWith("demo-"));
  useEffect(
    () => () => {
      pendingRef.current.forEach((item) => URL.revokeObjectURL(item.preview));
    },
    [],
  );
  const update = <K extends keyof JobInput>(key: K, value: JobInput[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  function addFiles(selected: FileList | File[]) {
    if (saving || isDemo) return;
    const next = [...pendingRef.current];
    const problems: string[] = [];
    for (const originalFile of Array.from(selected)) {
      const extension = originalFile.name.split(".").pop()?.toLowerCase() || "";
      const inferredType = MIME_BY_EXTENSION[extension];
      const file =
        (!originalFile.type || originalFile.type === "application/octet-stream") && inferredType
          ? new File([originalFile], originalFile.name, {
              type: inferredType,
              lastModified: originalFile.lastModified,
            })
          : originalFile;
      if (!SUPPORTED_MIMES.has(file.type)) {
        problems.push(`${file.name}: รูปแบบไฟล์ยังไม่รองรับ`);
        continue;
      }
      if (!file.size) {
        problems.push(`${file.name}: ไฟล์นี้ไม่มีข้อมูล`);
        continue;
      }
      if (file.size > maxUploadBytes) {
        problems.push(
          `${file.name}: ไฟล์ต้องไม่เกิน ${Math.floor(maxUploadBytes / 1024 / 1024)} MB`,
        );
        continue;
      }
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (next.some((item) => item.key === key)) continue;
      next.push({ key, file, preview: URL.createObjectURL(file) });
    }
    pendingRef.current = next;
    setPending(next);
    setError(problems.join("\n"));
  }
  function removeFile(key: string) {
    const item = pendingRef.current.find((file) => file.key === key);
    if (item) URL.revokeObjectURL(item.preview);
    const next = pendingRef.current.filter((file) => file.key !== key);
    pendingRef.current = next;
    setPending(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (!draft.title.trim()) {
      setError("กรุณาใส่ชื่องาน");
      return;
    }
    if (draft.plannedDate && !isValidDate(draft.plannedDate)) {
      setError("วันที่จะทำไม่ถูกต้อง");
      return;
    }
    if (draft.dueDate && !isValidDate(draft.dueDate)) {
      setError("กำหนดส่งไม่ถูกต้อง");
      return;
    }
    if (!isValidUrl(draft.referenceUrl)) {
      setError("ลิงก์อ้างอิงต้องเริ่มด้วย https:// หรือ http://");
      return;
    }
    const parsedQuantity = quantity.trim() ? Number(quantity) : null;
    if (
      parsedQuantity !== null &&
      (!Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 100000)
    ) {
      setError("จำนวนชิ้นงานต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100,000 หรือเว้นว่าง");
      return;
    }
    setSaving(true);
    try {
      await onSave(
        {
          ...editableInput(draft),
          title: draft.title.trim(),
          requester: draft.requester.trim(),
          brief: draft.brief.trim(),
          referenceUrl: draft.referenceUrl.trim(),
          quantity: parsedQuantity,
        },
        pendingRef.current.map((item) => item.file),
        editing,
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={editing ? "แก้ไขงาน" : "เพิ่มงานใหม่"}
      subtitle={
        isDemo
          ? "แก้ไขข้อมูลตัวอย่างเพื่อทดลองใช้งาน"
          : "จดสิ่งที่ต้องทำ แล้วค่อยเพิ่มรายละเอียดได้"
      }
      onClose={onClose}
      drawer
      busy={saving}
    >
      <form className="job-form" onSubmit={submit} aria-busy={saving}>
        <div className="form-body">
          <fieldset className="form-fieldset" disabled={saving}>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-title`}>
                ชื่องาน <span aria-hidden="true">*</span>
              </label>
              <input
                id={`${id}-title`}
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
                maxLength={180}
                required
                placeholder="เช่น ภาพโปรโมชัน Heartopia"
                autoComplete="off"
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="field-label" htmlFor={`${id}-store`}>
                  ร้าน
                </label>
                <select
                  id={`${id}-store`}
                  value={draft.store}
                  onChange={(event) => update("store", event.target.value as JobInput["store"])}
                >
                  {STORES.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${id}-requester`}>
                  ผู้สั่งงาน
                </label>
                <input
                  id={`${id}-requester`}
                  value={draft.requester}
                  onChange={(event) => update("requester", event.target.value)}
                  maxLength={120}
                  placeholder="ชื่อคนที่ฝากงาน หรือทำเอง"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label" id={`${id}-type-label`}>
                ประเภทงาน
              </span>
              <div className="type-selector" role="group" aria-labelledby={`${id}-type-label`}>
                <button
                  type="button"
                  className={`type-option${draft.type === "image" ? " active" : ""}`}
                  aria-pressed={draft.type === "image"}
                  onClick={() => update("type", "image")}
                >
                  <ImageIcon size={18} /> ภาพ
                </button>
                <button
                  type="button"
                  className={`type-option${draft.type === "reel" ? " active" : ""}`}
                  aria-pressed={draft.type === "reel"}
                  onClick={() => update("type", "reel")}
                >
                  <Clapperboard size={18} /> Reel
                </button>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="field-label" htmlFor={`${id}-planned`}>
                  วันที่จะทำ
                </label>
                <input
                  id={`${id}-planned`}
                  type="date"
                  value={draft.plannedDate}
                  onChange={(event) => update("plannedDate", event.target.value)}
                />
                <span className="field-hint">เว้นไว้ก่อนก็ได้</span>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${id}-due`}>
                  กำหนดส่ง
                </label>
                <input
                  id={`${id}-due`}
                  type="date"
                  value={draft.dueDate}
                  onChange={(event) => update("dueDate", event.target.value)}
                />
                <span className="field-hint">วันที่ต้องการให้งานเสร็จ</span>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-brief`}>
                บรีฟและสิ่งที่ต้องทำ
              </label>
              <textarea
                id={`${id}-brief`}
                value={draft.brief}
                onChange={(event) => update("brief", event.target.value)}
                maxLength={10000}
                rows={4}
                placeholder="ข้อความที่ต้องใส่ ขนาดภาพ จุดที่ต้องแก้ หรือรายละเอียดกันลืม…"
              />
            </div>
            <details
              className="extra-details"
              open={
                Boolean(
                  editing &&
                  (initial.quantity || initial.priority === "high" || initial.referenceUrl),
                ) || undefined
              }
            >
              <summary>
                รายละเอียดเพิ่มเติม <ChevronDown size={16} />
              </summary>
              <div className="form-grid">
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-quantity`}>
                    จำนวนชิ้นงาน
                  </label>
                  <input
                    id={`${id}-quantity`}
                    type="number"
                    min={1}
                    max={100000}
                    step={1}
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="ยังไม่ระบุ"
                  />
                  <span className="field-hint">จำนวนตามบรีฟ ไม่ใช่โควตารายวัน</span>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-priority`}>
                    ความสำคัญ
                  </label>
                  <select
                    id={`${id}-priority`}
                    value={draft.priority}
                    onChange={(event) =>
                      update("priority", event.target.value as JobInput["priority"])
                    }
                  >
                    <option value="normal">ปกติ</option>
                    <option value="high">ด่วน</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${id}-reference`}>
                  ลิงก์อ้างอิง
                </label>
                <input
                  id={`${id}-reference`}
                  type="url"
                  value={draft.referenceUrl}
                  onChange={(event) => update("referenceUrl", event.target.value)}
                  maxLength={2048}
                  placeholder="https://…"
                />
              </div>
            </details>
            <div className="field">
              <span className="field-label" id={`${id}-files-label`}>
                รูปและคลิปของงาน
              </span>
              {isDemo ? (
                <p className="field-hint">
                  ไฟล์ในงานนี้เป็นตัวอย่าง เพิ่มงานของคุณเองเพื่ออัปโหลดไฟล์
                </p>
              ) : (
                <>
                  <input
                    ref={fileRef}
                    id={`${id}-files`}
                    type="file"
                    accept={FILE_ACCEPT}
                    multiple
                    hidden
                    aria-labelledby={`${id}-files-label`}
                    onChange={(event) => {
                      if (event.target.files) addFiles(event.target.files);
                      event.target.value = "";
                    }}
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className={`upload-zone${dragging ? " dragging" : ""}`}
                    disabled={saving}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!saving) setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragging(false);
                      if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
                    }}
                  >
                    <Upload size={22} />
                    <strong>เลือกรูป / คลิป</strong>
                    <span>หรือลากไฟล์มาวางที่นี่ เลือกได้หลายไฟล์</span>
                  </button>
                  <span className="field-hint">
                    JPG, PNG, WEBP, GIF, AVIF, MP4, WEBM, MOV · ไม่เกิน{" "}
                    {Math.floor(maxUploadBytes / 1024 / 1024)} MB ต่อไฟล์
                  </span>
                </>
              )}
              {pending.length > 0 && (
                <ul className="pending-files" aria-label="ไฟล์ที่เลือก">
                  {pending.map((item) => (
                    <li key={item.key} className="pending-file">
                      {item.file.type.startsWith("image/") ? (
                        <img className="pending-file-thumb" src={item.preview} alt="" />
                      ) : (
                        <span className="pending-file-thumb pending-video">
                          <Clapperboard size={22} />
                        </span>
                      )}
                      <div className="pending-file-copy">
                        <strong>{item.file.name}</strong>
                        <span>{formatSize(item.file.size)}</span>
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => removeFile(item.key)}
                        aria-label={`นำ ${item.file.name} ออกจากรายการ`}
                      >
                        <X size={17} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {editing && !isDemo && editing.assets.length > 0 && (
                <span className="field-hint">
                  มีไฟล์ในงานนี้แล้ว {editing.assets.length} ไฟล์ ไฟล์ที่เลือกจะเพิ่มเข้าไปในงานเดิม
                </span>
              )}
            </div>
          </fieldset>
          {error && (
            <p className="form-error" role="alert" style={{ whiteSpace: "pre-line" }}>
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={17} className="spin" /> กำลังบันทึก…
              </>
            ) : (
              <>
                <Check size={17} /> {editing ? "บันทึกการแก้ไข" : "เพิ่มงาน"}
              </>
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

const POST_OPTIONS: { value: PostStatus; label: string; hint: string; icon: typeof Circle }[] = [
  { value: "unposted", label: "ยังไม่โพสต์", hint: "เก็บไว้ในคิว", icon: Circle },
  { value: "scheduled", label: "ตั้งเวลาแล้ว", hint: "รอเผยแพร่ตามเวลา", icon: Clock3 },
  { value: "partial", label: "โพสต์บางส่วน", hint: "ยังมีบางชิ้นที่ค้างอยู่", icon: Layers3 },
  { value: "posted", label: "โพสต์แล้ว", hint: "เผยแพร่เรียบร้อย", icon: CheckCheck },
];

export function PostDialog({
  job,
  today,
  onClose,
  onSave,
}: {
  job: Job;
  today: string;
  onClose: () => void;
  onSave: (patch: Partial<Job>) => Promise<void>;
}) {
  const [status, setStatus] = useState<PostStatus>(
    job.postStatus === "unposted" ? "posted" : job.postStatus,
  );
  const [postDate, setPostDate] = useState(job.postDate ? job.postDate.slice(0, 10) : today);
  const [postUrl, setPostUrl] = useState(job.postUrl);
  const [postNote, setPostNote] = useState(job.postNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (status !== "unposted" && postDate && !isValidDate(postDate)) {
      setError("วันที่โพสต์ไม่ถูกต้อง");
      return;
    }
    if (status !== "unposted" && !isValidUrl(postUrl)) {
      setError("ลิงก์โพสต์ต้องเริ่มด้วย https:// หรือ http://");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        postStatus: status,
        postDate: status === "unposted" ? "" : postDate,
        postUrl: status === "unposted" ? "" : postUrl.trim(),
        postNote: postNote.trim(),
      });
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="บันทึกการโพสต์" subtitle={job.title} onClose={onClose} busy={saving}>
      <form onSubmit={submit} aria-busy={saving}>
        <div className="form-body">
          <fieldset className="form-fieldset" disabled={saving}>
            <span className="field-label" id={`${id}-status-label`}>
              สถานะบน Facebook
            </span>
            <div className="post-options" role="radiogroup" aria-labelledby={`${id}-status-label`}>
              {POST_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <label
                    key={option.value}
                    className={`post-option${status === option.value ? " active" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`${id}-post-status`}
                      value={option.value}
                      checked={status === option.value}
                      onChange={() => setStatus(option.value)}
                    />
                    <Icon size={19} />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            {status !== "unposted" && (
              <>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-date`}>
                    {status === "scheduled" ? "วันที่ตั้งเวลาโพสต์" : "วันที่โพสต์"}
                  </label>
                  <input
                    id={`${id}-date`}
                    type="date"
                    value={postDate}
                    onChange={(event) => setPostDate(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-url`}>
                    ลิงก์โพสต์ <span className="field-hint">(ถ้ามี)</span>
                  </label>
                  <input
                    id={`${id}-url`}
                    type="url"
                    maxLength={2048}
                    value={postUrl}
                    onChange={(event) => setPostUrl(event.target.value)}
                    placeholder="https://www.facebook.com/…"
                  />
                </div>
              </>
            )}
            <div className="field">
              <label className="field-label" htmlFor={`${id}-note`}>
                {status === "partial" ? "ส่วนที่ยังไม่ได้โพสต์" : "รายละเอียดเพิ่มเติม"}
              </label>
              <textarea
                id={`${id}-note`}
                maxLength={2000}
                rows={3}
                value={postNote}
                onChange={(event) => setPostNote(event.target.value)}
                placeholder={
                  status === "partial"
                    ? "เช่น ลงภาพหลักแล้ว เหลือภาพแนวตั้งอีก 2 ภาพ"
                    : "จดรายละเอียดหรือสิ่งที่ต้องทำต่อ…"
                }
              />
            </div>
            <p className="field-hint">
              <Info size={15} /> บันทึกสถานะที่คุณทำบน Facebook ด้วยตัวเอง ปุ่มนี้ไม่ได้เผยแพร่โพสต์
            </p>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={17} className="spin" /> กำลังบันทึก…
              </>
            ) : (
              <>
                <Check size={17} /> บันทึกสถานะ
              </>
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function SettingsDialog({
  settings,
  today,
  onClose,
  onSave,
}: {
  settings: StudioSettings;
  today: string;
  onClose: () => void;
  onSave: (settings: StudioSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState<StudioSettings>({
    reelEnabled: settings.reelEnabled,
    reelAnchor: settings.reelAnchor || today,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const upcoming = useMemo(() => {
    if (!draft.reelEnabled || !isValidDate(draft.reelAnchor) || !isValidDate(today)) return [];
    const distance = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${draft.reelAnchor}T00:00:00Z`)) / 86400000,
    );
    const start = addDays(draft.reelAnchor, Math.max(0, Math.ceil(distance / 2) * 2));
    return [0, 2, 4, 6].map((offset) => addDays(start, offset)).filter(isValidDate);
  }, [draft.reelEnabled, draft.reelAnchor, today]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (
      (draft.reelEnabled && !draft.reelAnchor) ||
      (draft.reelAnchor && !isValidDate(draft.reelAnchor))
    ) {
      setError("กรุณาเลือกวันที่เริ่มรอบให้ถูกต้อง");
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="รอบทำ Reel" subtitle="สำหรับ Supersix Shop" onClose={onClose} busy={saving}>
      <form onSubmit={submit} aria-busy={saving}>
        <div className="form-body">
          <fieldset className="form-fieldset" disabled={saving}>
            <label className="setting-toggle" htmlFor={`${id}-enabled`}>
              <span>
                <strong>ทำ Reel วันเว้นวัน</strong>
                <small>แสดงรอบทำคลิปบนหน้าหลัก</small>
              </span>
              <input
                id={`${id}-enabled`}
                type="checkbox"
                role="switch"
                checked={draft.reelEnabled}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, reelEnabled: event.target.checked }))
                }
              />
            </label>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-anchor`}>
                วันเริ่มรอบ
              </label>
              <input
                id={`${id}-anchor`}
                type="date"
                value={draft.reelAnchor}
                disabled={!draft.reelEnabled}
                required={draft.reelEnabled}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, reelAnchor: event.target.value }))
                }
              />
              <span className="field-hint">นับทุก 2 วันจากวันที่เลือก เปลี่ยนวันเริ่มได้เสมอ</span>
            </div>
            {upcoming.length > 0 && (
              <div className="schedule-preview">
                <span className="field-label">
                  <CalendarDays size={16} /> รอบถัดไป
                </span>
                <div>
                  {upcoming.map((day) => (
                    <span key={day} className={day === today ? "active" : undefined}>
                      {day === today ? "วันนี้" : prettyDate(day)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="field-hint">
              รอบนี้ช่วยวางแผนวันที่จะทำคลิป คุณเพิ่มจำนวนคลิปและกำหนดวันโพสต์ของแต่ละงานได้เอง
            </p>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={17} className="spin" /> กำลังบันทึก…
              </>
            ) : (
              <>
                <Check size={17} /> บันทึกการตั้งค่า
              </>
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
