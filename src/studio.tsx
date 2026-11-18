import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  ArrowUpRight,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  PanelsTopLeft,
  List,
  Film,
  Check,
  Clock3,
  CalendarDays,
  SlidersHorizontal,
  X,
  Download,
  Trash2,
  Archive,
  Settings2,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send as Facebook,
  Sparkles,
  Menu,
  Inbox,
  HardDrive,
  FolderOpen,
  CheckCheck,
} from "lucide-react";
import {
  STORES,
  thaiDateKey,
  addDays,
  isReelDay,
  prettyDate,
  WORK_LABELS,
  POST_LABELS,
  type StoreId,
  type Job,
  type JobInput,
  type Asset,
  type StudioData,
  type StudioSettings,
  type JobType,
  type StorageInfo,
} from "./lib/studio-types";
import { getDemoJobs } from "./lib/demo-data";
import { JobCard } from "./job-card";
import { Modal, JobForm, PostDialog, SettingsDialog } from "./studio-forms";
import { StorageDialog, TrashDialog } from "./local-panels";
import { api } from "./lib/api";
import { normalizeMediaFile } from "./lib/media";

type Tab = "all" | "pending" | "ready" | "posted";
type Notice = { text: string; error?: boolean; action?: () => void; label?: string };
const DEFAULT_MAX_FILE = 500 * 1024 * 1024;
const MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];
function isDemo(job: Job) {
  return job.id.startsWith("demo-");
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง";
}
function storeName(id: StoreId) {
  return STORES.find((s) => s.id === id)?.name || id;
}
function newInput(store: StoreId, type: JobType, today: string): JobInput {
  return {
    store,
    title: "",
    requester: "",
    brief: "",
    type,
    plannedDate: today,
    dueDate: "",
    priority: "normal",
    quantity: null,
    referenceUrl: "",
  };
}

export default function Studio() {
  const [today, setToday] = useState(thaiDateKey());
  const [jobs, setJobs] = useState<Job[]>([]),
    [demoJobs, setDemoJobs] = useState<Job[]>(() => getDemoJobs(thaiDateKey()));
  const [storage, setStorage] = useState<StorageInfo | null>(null),
    [showStorage, setShowStorage] = useState(false),
    [showTrash, setShowTrash] = useState(false);
  const hosted = storage?.mode === "hosted";
  const [settings, setSettings] = useState<StudioSettings>({ reelAnchor: "", reelEnabled: true });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [demoMode, setDemoMode] = useState(false);
  const [shop, setShop] = useState<StoreId | "all">("supersix"),
    [tab, setTab] = useState<Tab>("all"),
    [archived, setArchived] = useState(false);
  const [query, setQuery] = useState(""),
    [dateFilter, setDateFilter] = useState("all"),
    [selectedDate, setSelectedDate] = useState(today),
    [typeFilter, setTypeFilter] = useState("all"),
    [view, setView] = useState<"large" | "compact">("large"),
    [sort, setSort] = useState("due");
  const [form, setForm] = useState<{ job?: Job; type: JobType } | null>(null),
    [postJob, setPostJob] = useState<Job | null>(null),
    [showSettings, setShowSettings] = useState(false),
    [showHelp, setShowHelp] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null),
    [busyId, setBusyId] = useState(""),
    [uploadProgress, setUploadProgress] = useState<{ jobId: string; text: string } | null>(null),
    [confirm, setConfirm] = useState<{ job: Job; asset?: Asset } | null>(null),
    [notice, setNotice] = useState<Notice | null>(null),
    [mobileMenu, setMobileMenu] = useState(false);
  const [busyJobs, setBusyJobs] = useState<string[]>([]);
  const mutatingJobs = useRef(new Set<string>());
  const searchRef = useRef<HTMLInputElement>(null),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    uploadLocked = useRef(false),
    createRequestId = useRef("");
  const notify = useCallback(
    (text: string, error = false, action?: () => void, label = "ย้อนกลับ") => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      setNotice({ text, error, action, label });
      noticeTimer.current = setTimeout(() => setNotice(null), error ? 8500 : 5500);
    },
    [],
  );
  const load = useCallback(async (initial = false) => {
    setError("");
    try {
      const data = await api<StudioData>("/api/studio");
      setJobs(data.jobs);
      setSettings(data.settings);
      setStorage(data.storage);
      if (
        initial &&
        data.jobs.length === 0 &&
        localStorage.getItem("supersix-demo-dismissed") !== "1"
      )
        setDemoMode(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(true);
    if (localStorage.getItem("supersix-view") === "compact") setView("compact");
    const timer = setInterval(() => setToday(thaiDateKey()), 30000);
    return () => {
      clearInterval(timer);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],dialog')
      )
        return;
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setForm({ type: "image" });
      }
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setMenuId(null);
        setMobileMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuId]);
  useEffect(() => {
    createRequestId.current = form && !form.job ? crypto.randomUUID() : "";
  }, [form]);
  const maxUploadBytes = storage?.maxUploadBytes ?? DEFAULT_MAX_FILE;
  const allJobs = demoMode ? demoJobs : jobs;
  const inStore = allJobs.filter(
    (j) => (shop === "all" || j.store === shop) && j.archived === archived,
  );
  const counts = {
    all: inStore.length,
    pending: inStore.filter((j) => j.workStatus !== "done").length,
    ready: inStore.filter((j) => j.workStatus === "done" && j.postStatus !== "posted").length,
    posted: inStore.filter((j) => j.postStatus === "posted").length,
  };
  const visibleJobs = inStore
    .filter((j) => {
      if (tab === "pending" && j.workStatus === "done") return false;
      if (tab === "ready" && (j.workStatus !== "done" || j.postStatus === "posted")) return false;
      if (tab === "posted" && j.postStatus !== "posted") return false;
      if (typeFilter !== "all" && j.type !== typeFilter) return false;
      if (dateFilter === "today" && j.plannedDate !== today && j.dueDate !== today) return false;
      if (dateFilter === "overdue" && (!j.dueDate || j.dueDate >= today || j.workStatus === "done"))
        return false;
      if (dateFilter === "date" && j.plannedDate !== selectedDate && j.dueDate !== selectedDate)
        return false;
      if (
        query &&
        !`${j.title} ${j.requester} ${j.brief} ${storeName(j.store)}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) =>
      sort === "newest"
        ? b.createdAt.localeCompare(a.createdAt)
        : Number(a.workStatus === "done") - Number(b.workStatus === "done") ||
          Number(b.priority === "high") - Number(a.priority === "high") ||
          (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
          b.createdAt.localeCompare(a.createdAt),
    );
  const currentShop = STORES.find((s) => s.id === shop);
  const activeReel = settings.reelEnabled && isReelDay(today, settings.reelAnchor);
  const nextReel = settings.reelAnchor
    ? today < settings.reelAnchor
      ? settings.reelAnchor
      : activeReel
        ? today
        : addDays(today, 1)
    : "";
  const dateHeading = new Intl.DateTimeFormat("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Bangkok",
  }).format(new Date(today + "T12:00:00+07:00"));
  const resetFilters = () => {
    setQuery("");
    setDateFilter("all");
    setTypeFilter("all");
    setTab("all");
  };
  const selectShop = (id: StoreId | "all") => {
    setShop(id);
    setArchived(false);
    resetFilters();
    setMobileMenu(false);
  };
  const exitDemo = () => {
    setDemoMode(false);
    localStorage.setItem("supersix-demo-dismissed", "1");
    resetFilters();
  };
  const replaceJob = (job: Job) =>
    setJobs((prev) =>
      prev.some((j) => j.id === job.id)
        ? prev.map((j) => (j.id === job.id ? job : j))
        : [job, ...prev],
    );
  const updateJob = async (job: Job, patch: Partial<Job>, undo = true): Promise<Job> => {
    if (mutatingJobs.current.has(job.id)) {
      const e = new Error("งานนี้กำลังบันทึก รอสักครู่แล้วลองอีกครั้ง");
      notify(e.message, true);
      throw e;
    }
    mutatingJobs.current.add(job.id);
    setBusyJobs([...mutatingJobs.current]);
    try {
      let result: Job;
      if (isDemo(job)) {
        result = {
          ...job,
          ...patch,
          updatedAt: new Date().toISOString(),
          ...(patch.workStatus
            ? { completedAt: patch.workStatus === "done" ? new Date().toISOString() : null }
            : {}),
        };
        setDemoJobs((prev) => prev.map((j) => (j.id === job.id ? result : j)));
      } else {
        const data = await api<{ job: Job }>(`/api/jobs/${job.id}`, "PATCH", patch);
        result = data.job;
        replaceJob(result);
      }
      const reverse = Object.fromEntries(Object.keys(patch).map((k) => [k, job[k as keyof Job]]));
      notify(
        isDemo(job) ? "เปลี่ยนข้อมูลตัวอย่างแล้ว" : "บันทึกการเปลี่ยนแปลงแล้ว",
        false,
        undo
          ? () => {
              void updateJob(result, reverse, false).catch(() => {});
            }
          : undefined,
      );
      return result;
    } catch (e) {
      notify(errorText(e), true);
      throw e;
    } finally {
      mutatingJobs.current.delete(job.id);
      setBusyJobs([...mutatingJobs.current]);
    }
  };
  const uploadFiles = async (job: Job, files: File[]) => {
    if (!files.length) return;
    if (isDemo(job)) {
      notify("เพิ่มงานจริงก่อนแนบไฟล์ของคุณ", false, () => setForm({ type: job.type }), "เพิ่มงาน");
      return;
    }
    if (uploadLocked.current || mutatingJobs.current.has(job.id)) {
      notify("รอไฟล์ที่กำลังอัปโหลดให้เสร็จก่อนครับ", true);
      return;
    }
    uploadLocked.current = true;
    mutatingJobs.current.add(job.id);
    setBusyJobs([...mutatingJobs.current]);
    let uploaded = 0;
    const failures: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = normalizeMediaFile(files[i]);
        if (file.size > maxUploadBytes) {
          failures.push(`${file.name}: เกิน ${Math.floor(maxUploadBytes / 1024 / 1024)} MB`);
          continue;
        }
        if (!MIME_TYPES.includes(file.type)) {
          failures.push(`${file.name}: ไม่รองรับไฟล์ชนิดนี้`);
          continue;
        }
        setUploadProgress({
          jobId: job.id,
          text: `กำลังอัปโหลด ${i + 1}/${files.length} · ${file.name}`,
        });
        try {
          const payload = new FormData();
          payload.append("file", file);
          const data = await api<{ asset: Asset }>(`/api/jobs/${job.id}/assets`, "POST", payload);
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? { ...j, assets: [...j.assets, data.asset], updatedAt: data.asset.createdAt }
                : j,
            ),
          );
          uploaded++;
        } catch (e) {
          failures.push(`${file.name}: ${errorText(e)}`);
        }
      }
    } finally {
      setUploadProgress(null);
      uploadLocked.current = false;
      mutatingJobs.current.delete(job.id);
      setBusyJobs([...mutatingJobs.current]);
    }
    if (failures.length)
      notify(
        `บันทึกสำเร็จ ${uploaded} ไฟล์ · ${failures[0]}${failures.length > 1 ? ` และอีก ${failures.length - 1} ไฟล์` : ""}`,
        true,
      );
    else notify(`บันทึก ${uploaded} ไฟล์แล้ว`);
  };
  const saveForm = async (input: JobInput, files: File[], editing?: Job) => {
    if (editing && mutatingJobs.current.has(editing.id))
      throw new Error("งานนี้กำลังบันทึก รอสักครู่แล้วลองอีกครั้ง");
    if (files.length && uploadLocked.current)
      throw new Error(
        "มีไฟล์งานอื่นกำลังอัปโหลดอยู่ รอให้เสร็จแล้วกดบันทึกอีกครั้ง ไฟล์ที่เลือกยังอยู่ครบ",
      );
    if (editing && isDemo(editing)) {
      await updateJob(editing, input);
      setForm(null);
      return;
    }
    if (!editing && !createRequestId.current) createRequestId.current = crypto.randomUUID();
    const data = await api<{ job: Job }>(
      editing ? `/api/jobs/${editing.id}` : "/api/jobs",
      editing ? "PATCH" : "POST",
      editing ? input : { ...input, id: createRequestId.current },
    );
    replaceJob(data.job);
    setForm(null);
    exitDemo();
    setShop(data.job.store);
    setArchived(false);
    notify(editing ? "บันทึกรายละเอียดแล้ว" : "เพิ่มงานแล้ว");
    if (files.length) await uploadFiles(data.job, files);
  };
  const deleteConfirmed = async () => {
    if (!confirm) return;
    const { job, asset } = confirm;
    setBusyId(job.id);
    try {
      if (isDemo(job)) {
        setDemoJobs((prev) =>
          asset
            ? prev.map((j) =>
                j.id === job.id ? { ...j, assets: j.assets.filter((a) => a.id !== asset.id) } : j,
              )
            : prev.filter((j) => j.id !== job.id),
        );
      } else if (asset) {
        await api(`/api/assets/${asset.id}`, "DELETE");
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id ? { ...j, assets: j.assets.filter((a) => a.id !== asset.id) } : j,
          ),
        );
      } else {
        await api(`/api/jobs/${job.id}`, "DELETE");
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
      }
      setConfirm(null);
      if (isDemo(job)) notify("นำข้อมูลตัวอย่างออกแล้ว");
      else
        notify(
          asset ? "ย้ายไฟล์ไปถังพักแล้ว" : "ย้ายงานไปถังพักแล้ว",
          false,
          () => setShowTrash(true),
          "เปิดถังพัก",
        );
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setBusyId("");
    }
  };
  const openFolder = async (job?: Job) => {
    if (!storage?.canOpenFolder) return;
    if (job && isDemo(job)) {
      notify("เพิ่มงานจริงก่อนเปิดโฟลเดอร์ของงาน");
      return;
    }
    try {
      const result = await api<{ path: string; opened: boolean; error?: string }>(
        job ? `/api/jobs/${job.id}/folder` : "/api/storage/open",
        "POST",
      );
      if (result.opened) notify("เปิดโฟลเดอร์ในเครื่องแล้ว");
      else notify(`${result.error || "เปิดโฟลเดอร์อัตโนมัติไม่ได้"} · ${result.path}`, true);
    } catch (e) {
      notify(errorText(e), true);
    }
  };
  const exportCsv = () => {
    const safe = (value: unknown) => {
      let s = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const rows = [
      [
        "รหัสงาน",
        "ร้าน",
        "ชื่องาน",
        "ผู้สั่ง",
        "ประเภท",
        "บรีฟ",
        "วันที่จะทำ",
        "กำหนดส่ง",
        "จำนวนชิ้นงาน",
        "สถานะงาน",
        "สถานะ Facebook",
        "วันโพสต์",
        "ลิงก์โพสต์",
        "หมายเหตุโพสต์",
        "จำนวนไฟล์",
        "ลิงก์ไฟล์",
        "วันที่รับงาน",
      ],
      ...visibleJobs.map((j) => [
        j.id,
        storeName(j.store),
        j.title,
        j.requester,
        j.type === "reel" ? "Reel" : "ภาพ",
        j.brief,
        j.plannedDate,
        j.dueDate,
        j.quantity ?? "",
        WORK_LABELS[j.workStatus],
        POST_LABELS[j.postStatus],
        j.postDate,
        j.postUrl,
        j.postNote,
        j.assets.length,
        j.assets.map((a) => new URL(a.url, window.location.origin).href).join("\n"),
        j.createdAt,
      ]),
    ];
    const blob = new Blob(["\uFEFF" + rows.map((r) => r.map(safe).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supersix-studio-${today}${demoMode ? "-demo" : ""}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("ส่งออก CSV แล้ว · นำเข้า Google Sheets ได้");
  };

  return (
    <div className="studio-shell">
      {mobileMenu && (
        <button
          className="mobile-scrim"
          aria-label="ปิดเมนู"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <a href="/" className="brand" aria-label="Supersix Studio หน้าหลัก">
          <span className="brand-mark">
            s<span>6</span>
            <i />
          </span>
          <span className="brand-name">
            supersix<span className="brand-label">STUDIO</span>
          </span>
        </a>
        <div className="sidebar-section-label">พื้นที่ของฉัน</div>
        <button
          className={`nav-button ${!archived ? "active" : ""}`}
          onClick={() => {
            setArchived(false);
            setMobileMenu(false);
          }}
        >
          <PanelsTopLeft size={18} />
          <span>งานของฉัน</span>
          <span className="nav-key">N</span>
        </button>
        <button
          className={`nav-button ${archived ? "active" : ""}`}
          onClick={() => {
            setArchived(true);
            resetFilters();
            setMobileMenu(false);
          }}
        >
          <Archive size={18} />
          <span>คลังงาน</span>
        </button>
        <button
          className="nav-button"
          onClick={() => {
            setShowTrash(true);
            setMobileMenu(false);
          }}
        >
          <Trash2 size={18} />
          <span>ถังพัก</span>
        </button>
        <div className="sidebar-section-label store-section-heading">
          ร้านของคุณ <span>03</span>
        </div>
        <nav className="store-nav" aria-label="เลือกร้าน">
          {STORES.map((store) => (
            <button
              key={store.id}
              className={`store-button ${shop === store.id ? "active" : ""}`}
              onClick={() => selectShop(store.id)}
            >
              <span
                className={`store-avatar ${store.id}`}
                style={{ "--store-color": store.color } as React.CSSProperties}
              >
                {store.initial}
              </span>
              <span className="store-copy">
                {store.name}
                {store.id === "supersix" && <small>ร้านหลัก</small>}
              </span>
              <span className="store-count">
                {
                  allJobs.filter(
                    (j) => j.store === store.id && !j.archived && j.workStatus !== "done",
                  ).length
                }
              </span>
            </button>
          ))}
          <button
            className={`store-button all-stores ${shop === "all" ? "active" : ""}`}
            onClick={() => selectShop("all")}
          >
            <span className="store-avatar neutral">
              <LayoutGrid size={17} />
            </span>
            <span className="store-copy">รวมทุกร้าน</span>
            <ChevronRight size={14} />
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="reel-side-card">
            <span className="reel-side-label">
              <Film size={15} /> REEL ROUTINE
            </span>
            <strong>
              {settings.reelEnabled && settings.reelAnchor
                ? activeReel
                  ? "วันนี้เป็นวันทำ Reel"
                  : `รอบถัดไป ${prettyDate(nextReel)}`
                : "ทำ Reel วันเว้นวัน"}
            </strong>
            <p>
              {settings.reelAnchor
                ? "Supersix Shop · ตามแผนของคุณ"
                : "เลือกวันเริ่ม แล้วดูรอบงานได้ที่นี่"}
            </p>
            <button onClick={() => setShowSettings(true)}>
              ตั้งค่ารอบงาน <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="help-link" onClick={() => setShowStorage(true)}>
            <HardDrive size={15} /> {hosted ? "จัดเก็บไฟล์" : "โฟลเดอร์ในเครื่อง"}{" "}
            <FolderOpen size={14} />
          </button>
          <button className="help-link" onClick={() => setShowHelp(true)}>
            <Sparkles size={15} /> วิธีใช้แบบสั้น ๆ <ArrowUpRight size={14} />
          </button>
          <div className="profile-row">
            <span className="profile-avatar">S6</span>
            <div>
              <strong>Super6</strong>
              <small>พื้นที่ส่วนตัว</small>
            </div>
            <button
              className="icon-button"
              aria-label="ตั้งค่า"
              onClick={() => setShowSettings(true)}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu-toggle"
              aria-label="เปิดเมนูร้าน"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span>พื้นที่ของฉัน</span>
            <ChevronRight size={13} />
            <strong>{archived ? "คลังงาน" : currentShop?.name || "รวมทุกร้าน"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="private-indicator">
              <span />
              {demoMode ? "โหมดตัวอย่าง" : hosted ? "พื้นที่ส่วนตัว" : "บันทึกในเครื่อง"}
            </span>
            <button
              className="icon-button"
              aria-label="ส่งออกข้อมูล CSV"
              title="ส่งออก CSV สำหรับ Google Sheets"
              onClick={exportCsv}
            >
              <Download size={18} />
            </button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div className="heading-copy">
              <div className="eyebrow">YOUR CREATIVE SPACE</div>
              <h1>
                {archived ? "คลังงานของฉัน" : "งานของฉัน"}
                <span className="heading-dot" />
              </h1>
              <p>
                {archived
                  ? "งานที่เก็บไว้ เปิดกลับมาดูได้เสมอ"
                  : "เก็บทุกงานไว้ด้วยกัน แล้วค่อย ๆ ทำให้เสร็จ"}
              </p>
            </div>
            <div className="heading-actions">
              <span className="today-label">
                <CalendarDays size={15} />
                {dateHeading}
              </span>
              <button
                className="btn btn-primary add-job-button"
                onClick={() => setForm({ type: "image" })}
              >
                <Plus size={19} /> เพิ่มงานใหม่ <kbd>N</kbd>
              </button>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button onClick={() => void load()}>ลองอีกครั้ง</button>
            </div>
          )}
          {demoMode && (
            <div className="demo-banner">
              <span className="demo-label">ตัวอย่าง</span>
              <p>ลองดูรูปแบบการจัดงานก่อนเริ่ม ข้อมูลนี้ยังไม่ใช่งานจริงของคุณ</p>
              <button onClick={exitDemo}>
                เริ่มใช้จริง <ArrowRight size={14} />
              </button>
            </div>
          )}
          <section className="stats-grid" aria-label="ภาพรวมงานของร้านที่เลือก">
            <button
              className={`stat-card ${tab === "pending" ? "selected" : ""}`}
              onClick={() => setTab("pending")}
            >
              <span className="stat-icon pending">
                <Clock3 size={20} />
              </span>
              <span className="stat-copy">
                <span className="stat-label">งานที่ต้องทำ</span>
                <strong className="stat-value">
                  {loading ? "—" : counts.pending}
                  <small>งาน</small>
                </strong>
              </span>
              <ArrowUpRight className="stat-arrow" size={16} />
            </button>
            <button
              className={`stat-card ${tab === "ready" ? "selected" : ""}`}
              onClick={() => setTab("ready")}
            >
              <span className="stat-icon ready">
                <CheckCheck size={20} />
              </span>
              <span className="stat-copy">
                <span className="stat-label">เสร็จแล้ว รอโพสต์</span>
                <strong className="stat-value">
                  {loading ? "—" : counts.ready}
                  <small>งาน</small>
                </strong>
              </span>
              <ArrowUpRight className="stat-arrow" size={16} />
            </button>
            <button
              className={`stat-card ${tab === "posted" ? "selected" : ""}`}
              onClick={() => setTab("posted")}
            >
              <span className="stat-icon posted">
                <Facebook size={20} />
              </span>
              <span className="stat-copy">
                <span className="stat-label">โพสต์เรียบร้อย</span>
                <strong className="stat-value">
                  {loading ? "—" : counts.posted}
                  <small>งาน</small>
                </strong>
              </span>
              <ArrowUpRight className="stat-arrow" size={16} />
            </button>
          </section>
          {(shop === "supersix" || shop === "all") && settings.reelEnabled && !archived && (
            <section className={`reel-banner ${activeReel ? "is-reel-day" : ""}`}>
              <span className="reel-banner-icon">
                <Film size={21} />
              </span>
              <div className="reel-banner-copy">
                <strong>
                  {settings.reelAnchor
                    ? activeReel
                      ? "วันนี้มีรอบทำ Reel"
                      : "รอบทำ Reel ถัดไป " + prettyDate(nextReel)
                    : "เว้นหนึ่งวัน แล้วกลับมาสร้าง Reel"}
                </strong>
                <span>
                  {settings.reelAnchor
                    ? "Supersix Shop · เพิ่มหัวข้อคลิปตามที่คุณวางแผนไว้"
                    : "Supersix Shop · ตั้งวันเริ่มรอบได้ ไม่จำกัดจำนวนคลิปต่อวัน"}
                </span>
              </div>
              <div className="reel-week" aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((day) => (
                  <span
                    key={day}
                    className={`${day === today ? "current" : ""} ${isReelDay(day, settings.reelAnchor) ? "reel-day" : ""}`}
                  >
                    <small>
                      {new Intl.DateTimeFormat("th-TH", { weekday: "narrow" }).format(
                        new Date(day + "T12:00:00"),
                      )}
                    </small>
                    <b>{Number(day.slice(-2))}</b>
                    <i />
                  </span>
                ))}
              </div>
              <button
                className="btn btn-small btn-secondary"
                onClick={() =>
                  settings.reelAnchor ? setForm({ type: "reel" }) : setShowSettings(true)
                }
              >
                {settings.reelAnchor ? (
                  <>
                    <Plus size={15} /> เพิ่ม Reel
                  </>
                ) : (
                  <>
                    ตั้งรอบงาน <ArrowRight size={14} />
                  </>
                )}
              </button>
            </section>
          )}
          <section className="work-section" aria-label="รายการงาน">
            <div className="section-heading">
              <h2>
                {archived ? "งานที่เก็บไว้" : "คิวงานของคุณ"} <span>{inStore.length}</span>
              </h2>
              <label className="search-box">
                <Search size={17} />
                <input
                  ref={searchRef}
                  aria-label="ค้นหางาน ผู้สั่ง หรือบรีฟ"
                  placeholder="ค้นหางาน ผู้สั่ง หรือบรีฟ..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query ? (
                  <button aria-label="ล้างคำค้น" onClick={() => setQuery("")}>
                    <X size={14} />
                  </button>
                ) : (
                  <kbd>/</kbd>
                )}
              </label>
            </div>
            <div className="toolbar">
              <div className="filter-tabs" aria-label="กรองสถานะงาน">
                {(
                  [
                    ["all", "ทั้งหมด"],
                    ["pending", "งานค้าง"],
                    ["ready", "พร้อมโพสต์"],
                    ["posted", "โพสต์แล้ว"],
                  ] as [Tab, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={`filter-tab ${tab === id ? "active" : ""}`}
                    onClick={() => setTab(id)}
                  >
                    {label}
                    <span>{counts[id]}</span>
                  </button>
                ))}
              </div>
              <div className="toolbar-actions">
                <button
                  className={`icon-button ${view === "large" ? "active" : ""}`}
                  aria-label="แสดงภาพใหญ่"
                  title="แสดงภาพใหญ่"
                  onClick={() => {
                    setView("large");
                    localStorage.setItem("supersix-view", "large");
                  }}
                >
                  <PanelsTopLeft size={18} />
                </button>
                <button
                  className={`icon-button ${view === "compact" ? "active" : ""}`}
                  aria-label="แสดงรายการย่อ"
                  title="แสดงรายการย่อ"
                  onClick={() => {
                    setView("compact");
                    localStorage.setItem("supersix-view", "compact");
                  }}
                >
                  <List size={19} />
                </button>
              </div>
            </div>
            <div className="task-filters">
              <label className="select-wrap">
                <CalendarDays size={14} />
                <select
                  aria-label="กรองวันที่"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                >
                  <option value="all">ทุกวันที่</option>
                  <option value="today">งานวันนี้</option>
                  <option value="overdue">เกินกำหนด</option>
                  <option value="date">เลือกวันที่...</option>
                </select>
                <ChevronDown size={12} />
              </label>
              {dateFilter === "date" && (
                <input
                  aria-label="วันที่ต้องการดู"
                  className="date-filter"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              )}
              <label className="select-wrap">
                <SlidersHorizontal size={14} />
                <select
                  aria-label="กรองประเภทงาน"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="all">ทุกประเภทงาน</option>
                  <option value="image">รูปภาพ</option>
                  <option value="reel">Reel</option>
                </select>
                <ChevronDown size={12} />
              </label>
              <label className="select-wrap sort-select">
                <select
                  aria-label="เรียงลำดับงาน"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="due">กำหนดส่งใกล้สุด</option>
                  <option value="newest">เพิ่มล่าสุด</option>
                </select>
                <ChevronDown size={12} />
              </label>
              <span className="result-count">{visibleJobs.length} งาน</span>
            </div>
            {loading ? (
              <div className="loading-state">
                <Loader2 className="spin" size={26} />
                <span>กำลังเปิดพื้นที่ของคุณ...</span>
              </div>
            ) : visibleJobs.length === 0 ? (
              <div className="empty-state">
                <span className="empty-illustration">
                  <Inbox size={36} />
                  <span>
                    <Plus size={15} />
                  </span>
                </span>
                <h3>
                  {inStore.length
                    ? "ไม่พบงานในมุมมองนี้"
                    : archived
                      ? "ยังไม่มีงานในคลัง"
                      : "เริ่มต้นจากงานแรกของคุณ"}
                </h3>
                <p>
                  {inStore.length
                    ? "ลองเปลี่ยนตัวกรอง หรือค้นหาด้วยคำอื่น"
                    : archived
                      ? "เก็บงานที่จบแล้วไว้ที่นี่ เพื่อย้อนกลับมาดูเมื่อไหร่ก็ได้"
                      : "มีใครฝากให้ทำอะไร จดไว้ตรงนี้ได้เลย"}
                </p>
                {inStore.length ? (
                  <button className="btn btn-secondary" onClick={resetFilters}>
                    ล้างตัวกรอง
                  </button>
                ) : (
                  !archived && (
                    <button className="btn btn-primary" onClick={() => setForm({ type: "image" })}>
                      <Plus size={17} /> เพิ่มงานแรก
                    </button>
                  )
                )}
                {!demoMode && jobs.length === 0 && !archived && (
                  <button
                    className="btn btn-quiet"
                    onClick={() => {
                      setDemoMode(true);
                      setDemoJobs(getDemoJobs(today));
                    }}
                  >
                    ดูตัวอย่างการใช้งาน <ArrowRight size={14} />
                  </button>
                )}
              </div>
            ) : (
              <div className={`jobs-grid view-${view}`}>
                {visibleJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    today={today}
                    checkDate={dateFilter === "date" ? selectedDate : today}
                    busy={
                      busyId === job.id ||
                      busyJobs.includes(job.id) ||
                      uploadProgress?.jobId === job.id
                    }
                    uploading={uploadProgress?.jobId === job.id ? uploadProgress.text : ""}
                    onFiles={(files) => void uploadFiles(job, files)}
                    onStart={() => void updateJob(job, { workStatus: "doing" }).catch(() => {})}
                    onStatus={() =>
                      void updateJob(job, {
                        workStatus: job.workStatus === "done" ? "doing" : "done",
                      }).catch(() => {})
                    }
                    onPost={() => setPostJob(job)}
                    onEdit={() => setForm({ job, type: job.type })}
                    onArchive={() =>
                      void updateJob(job, { archived: !job.archived }).catch(() => {})
                    }
                    onDelete={() => setConfirm({ job })}
                    onRemoveAsset={(asset) => setConfirm({ job, asset })}
                    onOpenFolder={() => void openFolder(job)}
                    canOpenFolder={storage?.canOpenFolder === true}
                    maxUploadBytes={maxUploadBytes}
                    menuOpen={menuId === job.id}
                    onMenu={(e) => {
                      e.stopPropagation();
                      setMenuId(menuId === job.id ? null : job.id);
                    }}
                  />
                ))}
              </div>
            )}
          </section>
          <footer className="workspace-footer">
            <span>
              supersix studio <span>·</span> พื้นที่เล็ก ๆ สำหรับงานของคุณ
            </span>
            <span>
              {demoMode ? (
                "ข้อมูลตัวอย่าง"
              ) : loading ? (
                "กำลังโหลด..."
              ) : error ? (
                "เชื่อมต่อไม่สำเร็จ"
              ) : (
                <>
                  <HardDrive size={14} />{" "}
                  {hosted ? "บันทึกบนเซิร์ฟเวอร์ส่วนตัว" : "บันทึกในเครื่องของคุณ"}
                </>
              )}
            </span>
          </footer>
        </div>
      </main>
      {form && (
        <JobForm
          initial={
            form.job ??
            newInput(
              form.type === "reel" ? "supersix" : shop === "all" ? "supersix" : shop,
              form.type,
              today,
            )
          }
          editing={form.job}
          onClose={() => setForm(null)}
          onSave={saveForm}
          maxUploadBytes={maxUploadBytes}
        />
      )}
      {postJob && (
        <PostDialog
          job={postJob}
          today={today}
          onClose={() => setPostJob(null)}
          onSave={async (patch) => {
            await updateJob(postJob, patch);
            setPostJob(null);
          }}
        />
      )}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          today={today}
          onClose={() => setShowSettings(false)}
          onSave={async (value) => {
            const data = await api<{ settings: StudioSettings }>("/api/settings", "PATCH", value);
            setSettings(data.settings);
            setShowSettings(false);
            notify("บันทึกรอบทำ Reel แล้ว");
          }}
        />
      )}
      {showStorage && <StorageDialog storage={storage} onClose={() => setShowStorage(false)} />}
      {showTrash && (
        <TrashDialog
          onClose={() => setShowTrash(false)}
          onRestored={() => {
            exitDemo();
            return load();
          }}
        />
      )}
      {showHelp && (
        <Modal title="เริ่มใช้งานใน 3 ขั้นตอน" onClose={() => setShowHelp(false)}>
          <div className="help-content">
            <div>
              <span>01</span>
              <h3>รับงานแล้วจดไว้</h3>
              <p>เลือกร้าน กดเพิ่มงาน ใส่ชื่องานและผู้สั่ง รายละเอียดอื่นเติมทีหลังได้</p>
            </div>
            <div>
              <span>02</span>
              <h3>ทำงาน แล้วแนบไฟล์</h3>
              <p>
                อัปโหลดรูปหรือคลิปหลายไฟล์ได้ ภาพจะแสดงขนาดใหญ่ให้ทันที เมื่อพร้อมใช้ กด
                “ทำเสร็จแล้ว”
              </p>
            </div>
            <div>
              <span>03</span>
              <h3>โพสต์แล้วค่อยบันทึก</h3>
              <p>
                กด “บันทึกการโพสต์” หลังโพสต์ Facebook พร้อมแนบลิงก์ไว้ได้
                ระบบนี้ติดตามสถานะที่คุณบันทึก
              </p>
            </div>
            <p className="field-hint">
              {hosted
                ? "งานและไฟล์บันทึกบนเซิร์ฟเวอร์ Render"
                : "งานและไฟล์บันทึกในโฟลเดอร์บนเครื่องคุณ"}{" "}
              · ข้อมูลตัวอย่างสำหรับทดลองดูหน้าตาเท่านั้น · ส่งออก CSV เพื่อนำเข้า Google Sheets
              ได้จากปุ่มด้านบน
            </p>
          </div>
          <div className="dialog-footer">
            <button className="btn btn-primary" onClick={() => setShowHelp(false)}>
              พร้อมเริ่มแล้ว <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={confirm.asset ? "ย้ายไฟล์ไปถังพัก?" : "ย้ายงานไปถังพัก?"}
          onClose={() => {
            if (!busyId) setConfirm(null);
          }}
        >
          <div className="confirm-content">
            <p>{confirm.asset ? confirm.asset.name : confirm.job.title}</p>
            <p className="field-hint">
              {confirm.asset
                ? "ไฟล์จะหายจากงานชั่วคราว คุณกู้คืนได้จากถังพัก ไฟล์จริงยังอยู่ในพื้นที่จัดเก็บ"
                : "งานจะถูกเก็บในถังพักพร้อมไฟล์แนบ กู้คืนกลับมาได้เสมอ หากแค่จบงานแล้ว เลือก “เก็บเข้าคลัง” ได้"}
            </p>
          </div>
          <div className="dialog-footer">
            <button
              className="btn btn-secondary"
              disabled={!!busyId}
              onClick={() => setConfirm(null)}
            >
              ยกเลิก
            </button>
            <button
              className="btn btn-danger"
              disabled={!!busyId}
              onClick={() => void deleteConfirmed()}
            >
              {busyId ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />} ย้ายไปถังพัก
            </button>
          </div>
        </Modal>
      )}
      {notice && (
        <div
          className={`toast ${notice.error ? "toast-error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
          <span>{notice.text}</span>
          {notice.action && (
            <button
              className="toast-action"
              onClick={() => {
                notice.action?.();
                setNotice(null);
              }}
            >
              {notice.label}
            </button>
          )}
          <button
            className="icon-button"
            aria-label="ปิดข้อความแจ้งเตือน"
            onClick={() => setNotice(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
