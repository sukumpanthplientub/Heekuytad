export type StoreId = "supersix" | "fern" | "gstation";
export type WorkStatus = "todo" | "doing" | "done";
export type PostStatus = "unposted" | "scheduled" | "partial" | "posted";
export type JobType = "image" | "reel";
export interface Asset {
  id: string;
  jobId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "video";
  url: string;
  createdAt: string;
}
export interface Job {
  id: string;
  store: StoreId;
  title: string;
  requester: string;
  brief: string;
  type: JobType;
  plannedDate: string;
  dueDate: string;
  priority: "normal" | "high";
  quantity: number | null;
  workStatus: WorkStatus;
  postStatus: PostStatus;
  postUrl: string;
  postDate: string;
  postNote: string;
  referenceUrl: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archived: boolean;
  assets: Asset[];
}
export interface StudioSettings {
  reelAnchor: string;
  reelEnabled: boolean;
}
export interface StorageInfo {
  mode: "hosted" | "local";
  canOpenFolder: boolean;
  rootPath: string;
  uploadsPath: string;
  databaseProvider: "postgresql";
  maxUploadBytes: number;
}
export interface StudioData {
  jobs: Job[];
  settings: StudioSettings;
  storage: StorageInfo;
}
export interface TrashData {
  jobs: (Job & { deletedAt?: string })[];
  assets: (Asset & { deletedAt?: string; jobTitle?: string })[];
}
export type JobInput = Pick<
  Job,
  | "store"
  | "title"
  | "requester"
  | "brief"
  | "type"
  | "plannedDate"
  | "dueDate"
  | "priority"
  | "quantity"
  | "referenceUrl"
>;

export const STORES = [
  {
    id: "supersix" as const,
    name: "Supersix Shop",
    initial: "S6",
    color: "#c1d5ad",
    short: "Supersix",
  },
  {
    id: "fern" as const,
    name: "เติมเกมกับเฟิร์น",
    initial: "F",
    color: "#ccb4e9",
    short: "เฟิร์น",
  },
  {
    id: "gstation" as const,
    name: "G-station",
    initial: "G",
    color: "#9ec6e8",
    short: "G-station",
  },
];
export const WORK_LABELS: Record<WorkStatus, string> = {
  todo: "ยังไม่เริ่ม",
  doing: "กำลังทำ",
  done: "เสร็จแล้ว",
};
export const POST_LABELS: Record<PostStatus, string> = {
  unposted: "ยังไม่โพสต์",
  scheduled: "ตั้งเวลาแล้ว",
  partial: "โพสต์บางส่วน",
  posted: "โพสต์แล้ว",
};
export function thaiDateKey(value: Date | string = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function addDays(day: string, amount: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function isReelDay(day: string, anchor: string): boolean {
  if (!anchor || !day) return false;
  const diff = Math.round(
    (Date.parse(day + "T00:00:00Z") - Date.parse(anchor + "T00:00:00Z")) / 86400000,
  );
  return diff >= 0 && diff % 2 === 0;
}
export function prettyDate(day: string, withYear = false): string {
  if (!day) return "ยังไม่กำหนด";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "Asia/Bangkok",
  }).format(new Date(day.length === 10 ? day + "T12:00:00+07:00" : day));
}
export function isUpdatedOn(job: Job, day: string): boolean {
  return job.assets.some((asset) => thaiDateKey(asset.createdAt) === day);
}
