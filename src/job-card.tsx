import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import {
  Archive,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Share2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import {
  STORES,
  WORK_LABELS,
  POST_LABELS,
  prettyDate,
  isUpdatedOn,
  type Asset,
  type Job,
} from "./lib/studio-types";

export interface JobCardProps {
  job: Job;
  today: string;
  checkDate: string;
  busy: boolean;
  uploading: string;
  onFiles: (files: File[]) => void;
  onStart?: () => void;
  onStatus: () => void;
  onPost: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRemoveAsset: (asset: Asset) => void;
  onOpenFolder: () => void;
  canOpenFolder: boolean;
  maxUploadBytes: number;
  menuOpen: boolean;
  onMenu: (event: MouseEvent) => void;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function JobCard({
  job,
  today,
  checkDate,
  busy,
  uploading,
  onFiles,
  onStart,
  onStatus,
  onPost,
  onEdit,
  onArchive,
  onDelete,
  onRemoveAsset,
  onOpenFolder,
  canOpenFolder,
  maxUploadBytes,
  menuOpen,
  onMenu,
}: JobCardProps) {
  const inputId = useId();
  const titleId = useId();
  const menuId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const previousAssetCount = useRef(job.assets.length);
  const [dragging, setDragging] = useState(false);
  const [activeAsset, setActiveAsset] = useState(0);
  const [failedMedia, setFailedMedia] = useState<Set<string>>(new Set());
  const store = STORES.find((item) => item.id === job.store) ?? STORES[0];
  const updated = isUpdatedOn(job, checkDate);
  const isDone = job.workStatus === "done";
  const locked = busy || Boolean(uploading);
  const overdue = Boolean(job.dueDate && job.dueDate < today && !isDone);
  const isDemo = job.id.startsWith("demo-");
  const dateLabel = checkDate === today ? "วันนี้" : `วันที่ ${prettyDate(checkDate)}`;
  const latestAsset = job.assets.reduce<Asset | null>(
    (latest, asset) => (!latest || asset.createdAt > latest.createdAt ? asset : latest),
    null,
  );
  const showLatest =
    checkDate === today &&
    !updated &&
    (isDone || job.postStatus === "posted") &&
    Boolean(latestAsset);
  const showPlan =
    checkDate === today &&
    !updated &&
    !showLatest &&
    Boolean(job.plannedDate) &&
    job.plannedDate > today;
  const updateTone = updated ? "updated" : showLatest || showPlan ? "neutral" : "missing";
  const updateLabel =
    showLatest && latestAsset
      ? `ไฟล์ล่าสุด ${prettyDate(latestAsset.createdAt)}`
      : showPlan
        ? `วางแผน ${prettyDate(job.plannedDate)}`
        : updated
          ? `มีไฟล์อัปเดต${dateLabel}`
          : `ยังไม่มีไฟล์อัปเดต${dateLabel}`;

  const showAsset = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      const container = gallery.current;
      if (!container) return;
      const next = Math.max(0, Math.min(index, job.assets.length - 1));
      const element = container.children[next] as HTMLElement | undefined;
      if (!element) return;
      const left =
        element.getBoundingClientRect().left -
        container.getBoundingClientRect().left +
        container.scrollLeft;
      container.scrollTo({ left, behavior });
      setActiveAsset(next);
    },
    [job.assets.length],
  );

  useEffect(() => {
    const count = job.assets.length;
    if (count > previousAssetCount.current) showAsset(count - 1);
    else if (activeAsset >= count) showAsset(Math.max(0, count - 1), "auto");
    previousAssetCount.current = count;
  }, [activeAsset, job.assets.length, showAsset]);

  useEffect(() => {
    setActiveAsset(0);
    setFailedMedia(new Set());
    gallery.current?.scrollTo({ left: 0 });
  }, [job.id]);

  function trackScroll() {
    const container = gallery.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    let closest = 0;
    let distance = Infinity;
    Array.from(container.children).forEach((element, index) => {
      const delta = Math.abs(element.getBoundingClientRect().left - bounds.left);
      if (delta < distance) {
        closest = index;
        distance = delta;
      }
    });
    setActiveAsset(closest);
  }

  function acceptsDrop(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: DragEvent) {
    if (!acceptsDrop(event) || locked) return;
    event.preventDefault();
    dragDepth.current++;
    setDragging(true);
  }

  function handleDragLeave(event: DragEvent) {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: DragEvent) {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!locked && event.dataTransfer.files.length) onFiles(Array.from(event.dataTransfer.files));
  }

  function failMedia(id: string) {
    setFailedMedia((current) => new Set([...current, id]));
  }

  return (
    <article
      className={`job-card${isDone ? " complete" : ""}${isDemo ? " demo" : ""}`}
      aria-labelledby={titleId}
      aria-busy={locked}
    >
      <input
        ref={fileInput}
        id={inputId}
        className="sr-only"
        type="file"
        multiple
        disabled={locked}
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov"
        aria-label={`อัปโหลดรูปหรือคลิปสำหรับ ${job.title}`}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <div
        className={`job-media${dragging ? " dragging" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(event) => {
          if (acceptsDrop(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = locked ? "none" : "copy";
          }
        }}
        onDrop={handleDrop}
      >
        {job.assets.length > 0 ? (
          <>
            <div
              className="asset-gallery"
              ref={gallery}
              onScroll={trackScroll}
              aria-label={`ไฟล์แนบของ ${job.title}`}
            >
              {job.assets.map((asset, index) => (
                <figure className="asset-item" key={asset.id}>
                  {failedMedia.has(asset.id) ? (
                    <div className="media-empty" role="status">
                      <ImageIcon size={30} aria-hidden="true" />
                      <span>แสดงพรีวิวไฟล์นี้ไม่ได้</span>
                      <a className="reference-link" href={asset.url} download={asset.name}>
                        ดาวน์โหลดไฟล์ต้นฉบับ <Download size={14} aria-hidden="true" />
                      </a>
                    </div>
                  ) : asset.kind === "video" ? (
                    <video
                      className="asset-video"
                      src={asset.url}
                      controls
                      playsInline
                      preload={index === activeAsset ? "metadata" : "none"}
                      aria-label={`คลิป ${asset.name}`}
                      onError={() => failMedia(asset.id)}
                    >
                      เบราว์เซอร์นี้ไม่รองรับการเล่นคลิป คุณสามารถดาวน์โหลดไฟล์ได้ด้านล่าง
                    </video>
                  ) : (
                    <img
                      className="asset-image"
                      src={asset.url}
                      alt={`ภาพ ${index + 1} ของงาน ${job.title}`}
                      loading="lazy"
                      decoding="async"
                      onError={() => failMedia(asset.id)}
                    />
                  )}
                  <figcaption className="asset-caption">
                    <span title={asset.name}>{asset.name}</span>
                    <span>{fileSize(asset.size)}</span>
                    <a
                      className="icon-button"
                      href={asset.url}
                      download={asset.name}
                      aria-label={`ดาวน์โหลด ${asset.name}`}
                      title="ดาวน์โหลดไฟล์ต้นฉบับ"
                    >
                      <Download size={14} aria-hidden="true" />
                    </a>
                    <button
                      className="icon-button"
                      type="button"
                      disabled={locked}
                      onClick={() => onRemoveAsset(asset)}
                      aria-label={`ลบไฟล์ ${asset.name}`}
                      title="ย้ายไฟล์ไปถังพัก"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
            {job.assets.length > 1 && (
              <div className="gallery-controls">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => showAsset(activeAsset - 1)}
                  disabled={activeAsset === 0}
                  aria-label="ดูไฟล์ก่อนหน้า"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span aria-live="polite">
                  {activeAsset + 1} / {job.assets.length}
                </span>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => showAsset(activeAsset + 1)}
                  disabled={activeAsset >= job.assets.length - 1}
                  aria-label="ดูไฟล์ถัดไป"
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        ) : (
          <button
            className="media-empty"
            type="button"
            disabled={locked}
            onClick={() => fileInput.current?.click()}
            aria-controls={inputId}
          >
            <span className="media-empty-icon">
              <Upload size={26} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <strong>เพิ่มรูปหรือคลิปของงานนี้</strong>
            <span>คลิกเพื่อเลือกไฟล์ หรือลากมาวาง</span>
            <small>
              เลือกได้หลายไฟล์ · สูงสุด {Math.floor(maxUploadBytes / 1024 / 1024)} MB ต่อไฟล์
            </small>
          </button>
        )}
        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <Upload size={30} />
            <strong>วางไฟล์เพื่ออัปโหลด</strong>
          </div>
        )}
        {uploading && (
          <div className="upload-overlay" role="status" aria-live="polite">
            <Loader2 className="spin" size={24} aria-hidden="true" />
            <span>{uploading}</span>
          </div>
        )}
      </div>

      <div className="job-content">
        <div className="job-topline">
          <span className="store-tag" style={{ color: store.color }}>
            <span aria-hidden="true">{store.initial}</span>
            {store.name}
          </span>
          <div className="job-badges">
            <span className={`badge type-${job.type}`}>
              {job.type === "reel" ? (
                <Film size={12} aria-hidden="true" />
              ) : (
                <ImageIcon size={12} aria-hidden="true" />
              )}
              {job.type === "reel" ? "Reel" : "ภาพ"}
            </span>
            {job.priority === "high" && <span className="badge urgent">ด่วน</span>}
            {isDemo && <span className="badge">ตัวอย่าง</span>}
          </div>
          <div className="menu-wrap">
            <button
              className="icon-button"
              type="button"
              disabled={locked}
              onClick={onMenu}
              aria-label={`ตัวเลือกงาน ${job.title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
            >
              <MoreHorizontal size={20} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div
                className="dropdown-menu"
                id={menuId}
                role="menu"
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" role="menuitem" onClick={onEdit}>
                  <Pencil size={15} aria-hidden="true" />
                  แก้ไขรายละเอียด
                </button>
                <button type="button" role="menuitem" onClick={onArchive}>
                  <Archive size={15} aria-hidden="true" />
                  {job.archived ? "นำกลับมาที่งานของฉัน" : "เก็บงานเข้าคลัง"}
                </button>
                <button className="danger" type="button" role="menuitem" onClick={onDelete}>
                  <Trash2 size={15} aria-hidden="true" />
                  ย้ายไปถังพัก
                </button>
              </div>
            )}
          </div>
        </div>

        <h3 className="job-title" id={titleId}>
          {job.title}
        </h3>
        <p className="job-brief">{job.brief || "ยังไม่ได้เพิ่มบรีฟงาน"}</p>

        <div className="job-meta">
          <span className="meta-item" title="ผู้สั่งงาน">
            <span className="requester-avatar" aria-hidden="true">
              {job.requester ? Array.from(job.requester)[0] : "S6"}
            </span>
            {job.requester || "ไม่ได้ระบุผู้สั่ง"}
          </span>
          {job.plannedDate && (
            <span className="meta-item">
              <CalendarDays size={13} aria-hidden="true" />
              ทำ {prettyDate(job.plannedDate)}
            </span>
          )}
          {job.dueDate && (
            <span className={`meta-item${overdue ? " overdue" : ""}`}>
              <Clock3 size={13} aria-hidden="true" />
              {overdue ? "เกินกำหนด · " : ""}ส่ง {prettyDate(job.dueDate)}
            </span>
          )}
          {job.quantity !== null && (
            <span className="meta-item" title="จำนวนชิ้นงานตามบรีฟ ไม่ใช่จำนวนไฟล์เวอร์ชัน">
              ตามบรีฟ {job.quantity} {job.type === "reel" ? "คลิป" : "ภาพ"}
            </span>
          )}
        </div>

        {job.referenceUrl && (
          <a
            className="reference-link"
            href={job.referenceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Link2 size={13} aria-hidden="true" />
            ดูข้อมูลอ้างอิง
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        )}

        <div className="job-progress">
          <span className={`status-chip ${job.workStatus}`}>
            {isDone ? (
              <CheckCircle2 size={14} aria-hidden="true" />
            ) : job.workStatus === "doing" ? (
              <Clock3 size={14} aria-hidden="true" />
            ) : (
              <Circle size={14} aria-hidden="true" />
            )}
            {WORK_LABELS[job.workStatus]}
          </span>
          {job.workStatus === "todo" && onStart && (
            <button
              type="button"
              className="btn btn-small btn-quiet"
              disabled={locked}
              onClick={onStart}
              aria-label={`เริ่มทำ ${job.title}`}
            >
              เริ่มทำ
            </button>
          )}
          <span className={`post-chip ${job.postStatus}`}>
            <Share2 size={13} aria-hidden="true" />
            Facebook · {POST_LABELS[job.postStatus]}
          </span>
          {job.postUrl && (
            <a
              className="post-link"
              href={job.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`เปิดโพสต์ Facebook ของ ${job.title}`}
            >
              ดูโพสต์
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          )}
        </div>
        {(job.postNote || job.postDate) && (
          <p className="partial-note">
            {job.postDate && (
              <span>
                {job.postStatus === "scheduled" ? "ตั้งไว้วันที่" : "วันที่โพสต์"}{" "}
                {prettyDate(job.postDate)}
                {job.postNote ? " · " : ""}
              </span>
            )}
            {job.postNote}
          </p>
        )}

        <div className="job-footer">
          <span
            className={`update-status ${updateTone}`}
            title={
              showLatest
                ? "วันเวลาของไฟล์ที่อัปโหลดล่าสุดในงานนี้"
                : showPlan
                  ? "งานนี้วางแผนไว้ในอนาคต"
                  : `ตรวจจากวันเวลาที่อัปโหลดไฟล์ในวันที่ ${prettyDate(checkDate, true)}`
            }
          >
            {updated ? (
              <CheckCircle2 size={14} aria-hidden="true" />
            ) : showLatest ? (
              <ImageIcon size={14} aria-hidden="true" />
            ) : showPlan ? (
              <CalendarDays size={14} aria-hidden="true" />
            ) : (
              <XCircle size={14} aria-hidden="true" />
            )}
            {updateLabel}
          </span>
          <div className="file-actions">
            {canOpenFolder && (
              <button
                className="folder-button"
                type="button"
                disabled={locked || isDemo}
                onClick={onOpenFolder}
                title={isDemo ? "เพิ่มงานจริงก่อนเปิดโฟลเดอร์" : "เปิดโฟลเดอร์ของงานในเครื่อง"}
              >
                <FolderOpen size={14} aria-hidden="true" />
                เปิดโฟลเดอร์
              </button>
            )}
            <button
              className="upload-more"
              type="button"
              disabled={locked}
              onClick={() => fileInput.current?.click()}
              aria-controls={inputId}
            >
              <Upload size={14} aria-hidden="true" />
              เพิ่มไฟล์
            </button>
          </div>
        </div>
        <div className="job-actions">
          <button
            type="button"
            className={isDone ? "btn-completed" : "btn-secondary"}
            disabled={locked}
            onClick={onStatus}
            aria-pressed={isDone}
            title={isDone ? "นำกลับมาทำต่อ" : "ยืนยันว่างานนี้ทำเสร็จแล้ว"}
          >
            {busy ? (
              <Loader2 className="spin" size={15} aria-hidden="true" />
            ) : (
              <Check size={15} aria-hidden="true" />
            )}
            ทำเสร็จแล้ว{isDone && <RotateCcw className="undo-work" size={12} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={isDone && job.postStatus !== "posted" ? "btn-primary" : "btn-quiet"}
            disabled={locked}
            onClick={onPost}
          >
            <Share2 size={15} aria-hidden="true" />
            {job.postStatus === "posted" ? "รายละเอียดโพสต์" : "บันทึกการโพสต์"}
          </button>
        </div>
      </div>
    </article>
  );
}
